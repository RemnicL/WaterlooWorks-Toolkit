import argparse
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from job_database import jobdb
from wwjobs import __main__ as wwjobs


class SyncTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.args = argparse.Namespace(db=self.root / 'jobs.sqlite3', scope='winter')

    def sync_capture(self, index, jobs, *, complete=True, observations=None, failures=None, error=None):
        directory = self.root / str(index)
        directory.mkdir()
        report = {
            'started_at': f'2026-11-{index:02d}T12:00:00+00:00',
            'status': 'failed' if error else ('partial' if not complete or failures else 'complete'),
            'list_complete': complete,
            'detail_failures': failures or {},
            'detail_observed_fields': observations or {},
        }
        if error:
            report['error'] = error
        if jobs is not None:
            jobdb.write_json({
                'total_jobs': len(jobs), 'posting_ids': [job['posting_id'] for job in jobs], 'jobs': jobs,
            }, directory / 'jobs.json')
        jobdb.write_json(report, directory / 'report.json')
        with patch.object(wwjobs, 'collect', return_value=(directory, report)):
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                return wwjobs.sync(self.args, None)

    def status(self):
        with contextlib.redirect_stdout(io.StringIO()) as stdout:
            self.assertEqual(wwjobs.status(self.args), 0)
        return json.loads(stdout.getvalue())

    def current_jobs(self):
        with contextlib.closing(jobdb.connect(self.args.db)) as conn:
            return jobdb.current_jobs(conn, self.args.scope)['jobs']

    def test_sync_advances_current_only_when_list_is_complete(self):
        job = {'posting_id': '001', 'required_skills': 'Python'}
        self.assertIsNone(self.status()['last_attempt'])
        self.assertFalse(self.args.db.exists())
        self.assertEqual(self.sync_capture(1, [job], observations={'001': ['required_skills']}), 0)
        first = self.status()['last_update']
        self.assertEqual(self.sync_capture(2, [], complete=False), 2)
        self.assertEqual(self.status()['last_update'], first)
        self.assertEqual(self.sync_capture(3, None, complete=False, error='login_required'), 1)
        latest = self.status()
        self.assertEqual(latest['last_attempt']['error'], 'login_required')
        self.assertEqual(latest['last_update'], first)
        self.assertEqual(self.current_jobs()[0]['job'], job)

        partial = {'posting_id': '001', 'required_skills': ''}
        self.assertEqual(self.sync_capture(4, [partial], failures={'001': 'http_500'}), 2)
        self.assertEqual(self.status()['last_update']['detail_failures'], 1)
        self.assertEqual(self.current_jobs()[0]['job'], job)
        self.assertEqual(self.sync_capture(5, []), 0)
        self.assertEqual(self.current_jobs(), [])

    def test_sync_records_an_import_rejection_without_advancing_current(self):
        job = {'posting_id': '001', 'job_title': 'Original'}
        self.assertEqual(self.sync_capture(1, [job], observations={'001': ['job_title']}), 0)
        first = self.status()['last_update']
        with self.assertRaisesRegex(ValueError, 'detail IDs'):
            self.sync_capture(2, [job], observations={'999': ['job_title']})
        latest = self.status()
        self.assertEqual(latest['last_attempt']['error'], 'import_failed')
        self.assertEqual(latest['last_attempt']['status'], 'failed')
        self.assertEqual(latest['last_update'], first)
        self.assertEqual(self.current_jobs()[0]['job'], job)
