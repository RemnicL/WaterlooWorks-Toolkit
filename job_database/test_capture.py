import json
import tempfile
import unittest
from pathlib import Path

import jobdb


class CaptureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.conn = jobdb.connect(self.root / 'capture.sqlite3')
        self.addCleanup(self.conn.close)
        jobdb.initialize(self.conn)

    def capture(self, name, date, jobs, observed=None, failures=None, complete=True):
        directory = self.root / name
        directory.mkdir()
        report = {
            'started_at': date,
            'status': 'failed' if jobs is None else ('partial' if failures or not complete else 'complete'),
            'list_complete': complete,
            'detail_observed_fields': observed or {},
            'detail_failures': failures or {},
        }
        (directory / 'report.json').write_text(json.dumps(report), encoding='utf-8')
        if jobs is not None:
            export = {'total_jobs': len(jobs), 'posting_ids': [job['posting_id'] for job in jobs], 'jobs': jobs}
            (directory / 'jobs.json').write_text(json.dumps(export), encoding='utf-8')
        return directory

    def current(self, include_inactive=False, scope='winter'):
        result = jobdb.current_jobs(self.conn, scope, include_inactive, '2026-11-11T14:00:00+00:00')
        return {row['job']['posting_id']: row for row in result['jobs']}

    def test_current_view_preserves_history_and_updates_only_observed_fields(self):
        initial = [
            {'posting_id': '001', 'app_deadline': 'Nov 11, 2026 9:00 AM',
             'required_skills': 'Python', 'job_summary': 'Original summary', 'job_responsibilities': 'Old tasks'},
            {'posting_id': '002', 'required_skills': 'SQL'},
            {'posting_id': '003', 'title': 'Later missing', 'job_title': 'Original'},
        ]
        first = self.capture('first', '2026-11-10T13:00:00+00:00', initial, {
            '001': ['required_skills', 'job_summary', 'job_responsibilities'],
            '002': ['required_skills'], '003': ['job_title'],
        })
        jobdb.import_capture(self.conn, first, 'first', 'winter')
        self.assertNotIn('001', self.current())
        self.assertEqual(self.current(True)['001']['deadline_at'], '2026-11-11T14:00:00+00:00')
        update = [
            {'posting_id': '001', 'app_deadline': 'Nov 16, 2026 9:00 AM',
             'required_skills': '', 'job_summary': 'Unconfirmed summary', 'job_responsibilities': 'New tasks'},
            {'posting_id': '002', 'app_deadline': 'Nov 10, 2026 9:00 AM', 'required_skills': 'Unconfirmed skills'},
            {'posting_id': '004', 'app_deadline': 'Nov 12, 2026 9:00 AM',
             'application_deadline': 'Nov 13, 2026 9:00 AM'},
        ]
        second = self.capture('second', '2026-11-11T13:00:00+00:00', update, {
            '001': ['required_skills', 'job_responsibilities'], '004': ['application_deadline'],
        }, {'002': 'unrecognized_overview'})
        jobdb.import_capture(self.conn, second, 'second', 'winter')
        jobdb.import_capture(self.conn, second, 'second', 'winter')
        current = self.current()
        self.assertEqual(set(current), {'001', '004'})
        self.assertEqual(current['001']['job']['required_skills'], '')
        self.assertEqual(current['001']['job']['job_summary'], 'Original summary')
        self.assertEqual(current['001']['job']['job_responsibilities'], 'New tasks')
        self.assertEqual(current['004']['availability'], 'deadline_unknown')
        inactive = self.current(True)
        self.assertEqual(inactive['002']['availability'], 'expired')
        self.assertEqual(inactive['002']['job']['required_skills'], 'SQL')
        self.assertEqual(inactive['002']['detail_failure'], 'unrecognized_overview')
        self.assertEqual(inactive['003']['availability'], 'not_observed')
        self.assertEqual(jobdb.job_context(self.conn, 'first', '001')['job'], initial[0])
        self.assertEqual(jobdb.job_context(self.conn, 'second', '001')['source_job'], update[0])
        self.assertEqual(self.conn.execute('SELECT COUNT(*) FROM capture_runs').fetchone()[0], 2)

    def test_incomplete_and_failed_runs_leave_the_current_list_at_last_complete_capture(self):
        job = {'posting_id': '001', 'job_title': 'Original'}
        first = self.capture('first', '2026-11-10T13:00:00+00:00', [job], {'001': ['job_title']})
        jobdb.import_capture(self.conn, first, 'first', 'winter')
        incomplete = self.capture('incomplete', '2026-11-11T13:00:00+00:00', [], complete=False)
        failed = self.capture('failed', '2026-11-11T13:01:00+00:00', None, complete=False)
        self.assertIsNone(jobdb.import_capture(self.conn, incomplete, 'incomplete', 'winter')['batch'])
        self.assertIsNone(jobdb.import_capture(self.conn, failed, 'failed', 'winter')['batch'])
        self.assertEqual(self.current()['001']['job'], job)
        self.assertEqual(self.conn.execute('SELECT COUNT(*) FROM capture_runs').fetchone()[0], 3)
        other = self.capture('other', '2026-11-11T13:00:00+00:00', [], {})
        jobdb.import_capture(self.conn, other, 'other', 'another-account')
        self.assertEqual(self.current(scope='another-account'), {})
        self.assertEqual(self.current()['001']['job'], job)

    def test_mismatched_report_and_out_of_order_capture_are_rejected(self):
        job = {'posting_id': '001', 'job_title': 'Original'}
        wrong = self.capture('wrong', '2026-11-10T13:00:00+00:00', [job], {'002': ['job_title']})
        with self.assertRaisesRegex(ValueError, 'detail IDs'):
            jobdb.import_capture(self.conn, wrong, 'wrong', 'winter')
        newer = self.capture('newer', '2026-11-11T13:00:00+00:00', [job], {'001': ['job_title']})
        older = self.capture('older', '2026-11-10T13:00:00+00:00', [job], {'001': ['job_title']})
        jobdb.import_capture(self.conn, newer, 'newer', 'winter')
        with self.assertRaisesRegex(ValueError, 'observation order'):
            jobdb.import_capture(self.conn, older, 'older', 'winter')
        self.assertEqual(self.conn.execute('SELECT COUNT(*) FROM batches').fetchone()[0], 1)

    def test_v2_migration_keeps_existing_snapshot_and_classification(self):
        source = Path(jobdb.HERE / 'fixtures' / 'all-sections.json')
        data = json.loads(source.read_text(encoding='utf-8'))
        jobdb.import_jobs(self.conn, source, 'original')
        classification = {'folders': {'SW': [data['posting_ids'][0]]}}
        path = self.root / 'folders.json'
        path.write_text(json.dumps(classification), encoding='utf-8')
        jobdb.import_selection(self.conn, path, 'folders', 'original')
        with self.conn:
            self.conn.execute('DROP TABLE capture_runs')
            self.conn.execute('PRAGMA user_version = 2')
        jobdb.initialize(self.conn)
        self.assertEqual(self.conn.execute('PRAGMA user_version').fetchone()[0], 3)
        self.assertEqual(jobdb.export_jobs(self.conn, 'original'), data)
        self.assertEqual(jobdb.export_classification(self.conn, 'folders'), classification)
        self.assertEqual(self.conn.execute('PRAGMA foreign_key_check').fetchall(), [])
