"""Workflow checks using temporary databases; never change the real application records."""
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

import jobdb


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.conn = jobdb.connect(self.root / 'test.sqlite3')
        jobdb.initialize(self.conn)

    def tearDown(self):
        self.conn.close()
        self.temp.cleanup()

    def source(self, name, value):
        path = self.root / name
        path.write_text(jobdb.encode(value), encoding='utf-8')
        return path

    def jobs(self, name='all.json', apps='4', ids=('1', '2', '3')):
        return self.source(name, {'total_jobs': len(ids), 'posting_ids': list(ids), 'jobs': [
            {'posting_id': pid, 'title': '测试岗位 ' + pid, 'organization': 'Company',
             'apps': apps, 'openings': '1', 'app_deadline': 'Oct 21, 2026 9:00 AM',
             'required_skills': 'Python', 'hires_by_faculty': {'nested': [1, 2]}} for pid in ids]})

    def test_major_difference_and_screened_union_round_trip(self):
        original = self.jobs()
        jobdb.import_jobs(self.conn, original, 'all', 'all')
        major = self.jobs('major.json', ids=('1',))
        jobdb.import_selection(self.conn, major, 'major', 'all', 'major')
        remaining = jobdb.export_jobs(self.conn, 'all', exclude=['major'])
        self.assertEqual(remaining['posting_ids'], ['2', '3'])
        screened = self.source('screened.json', {'posting_ids': ['2']})
        jobdb.import_selection(self.conn, screened, 'screened', 'all', 'screened')
        candidates = jobdb.export_jobs(self.conn, 'all', include=['major', 'screened'])
        self.assertEqual(candidates['posting_ids'], ['1', '2'])
        self.assertEqual(candidates['total_jobs'], 2)
        self.assertEqual(candidates['jobs'][0]['hires_by_faculty'], {'nested': [1, 2]})
        self.assertEqual(jobdb.export_jobs(self.conn, 'all'), json.loads(original.read_text(encoding='utf-8')))

    def test_snapshot_versions_and_idempotent_import(self):
        first = self.jobs()
        second = self.jobs('next.json', apps='8')
        jobdb.import_jobs(self.conn, first, 'day1')
        jobdb.import_jobs(self.conn, first, 'day1')
        jobdb.import_jobs(self.conn, second, 'day2')
        self.assertEqual(jobdb.stats(self.conn)['snapshots'], 6)
        self.assertEqual(jobdb.stats(self.conn)['jobs'], 3)
        self.assertEqual(jobdb.job_context(self.conn, 'day1', '1')['job']['apps'], '4')
        self.assertEqual(jobdb.job_context(self.conn, 'day2', '1')['job']['apps'], '8')
        with self.assertRaises(ValueError):
            jobdb.import_jobs(self.conn, second, 'day1')
        self.assertIsNone(jobdb.require(self.conn, 'batches', 'day1')['observed_at'])

    def test_bad_selection_and_duplicate_jobs_leave_no_partial_import(self):
        jobdb.import_jobs(self.conn, self.jobs(), 'all')
        wrong = self.source('wrong.json', {'folders': {'HW': ['1', '99']}})
        with self.assertRaises(ValueError):
            jobdb.import_selection(self.conn, wrong, 'bad', 'all')
        duplicate = self.jobs('duplicates.json', ids=('1', '1'))
        with self.assertRaises(ValueError):
            jobdb.import_jobs(self.conn, duplicate, 'bad')
        self.assertEqual(self.conn.execute('SELECT COUNT(*) FROM selections').fetchone()[0], 0)
        self.assertEqual(jobdb.stats(self.conn)['snapshots'], 3)

    def test_classification_exact_shape_order_and_empty_folders(self):
        jobdb.import_jobs(self.conn, self.jobs(), 'all')
        original = {'folders': {'SW': ['2', '1'], 'HW': ['3'], 'IT': []}}
        path = self.source('categories.json', original)
        jobdb.import_selection(self.conn, path, 'categories', 'all')
        self.assertEqual(jobdb.export_classification(self.conn, 'categories'), original)
        self.assertEqual(list(jobdb.export_classification(self.conn, 'categories')['folders']), ['SW', 'HW', 'IT'])
        self.assertEqual(len(jobdb.list_jobs(self.conn, 'all', selection='categories', category='SW')), 2)
        jobdb.import_jobs(self.conn, self.jobs('other.json'), 'other')
        with self.assertRaises(ValueError):
            jobdb.export_jobs(self.conn, 'other', include=['categories'])

    def ranking(self):
        text = '''个人资料：C:\\reference\\RESUME_FACTS.md；背景说明。
001. Job ID 2 | 测试岗位 2 | Company
建议：先核实硬性资格再决定申请 | 机会优先分：不适用 | 匹配度：3.2/5
原因：资格待确认。
建议文书：05 电子硬件（简历＋求职信）

002. Job ID 1 | 测试岗位 1 | Company
建议：建议申请 | 机会优先分：80/100（非概率） | 匹配度：4.1/5
原因：Python经验匹配。
建议文书：02 前端（简历＋求职信）

资格核对来源
尾注保留于source_text，不能进入最后一个岗位的文书建议。
'''
        path = self.root / 'ranking.txt'
        path.write_text(text, encoding='utf-8')
        return path

    def test_ranking_unknown_facts_and_no_inferred_submissions(self):
        jobdb.import_jobs(self.conn, self.jobs(), 'all')
        jobdb.import_ranking(self.conn, self.ranking(), 'rank', 'all')
        rows = jobdb.list_jobs(self.conn, 'all', analysis='rank')
        self.assertEqual([r['posting_id'] for r in rows], ['2', '1', '3'])
        self.assertIsNone(rows[0]['opportunity_score'])
        self.assertEqual(rows[0]['recommendation'], '先核实硬性资格再决定申请')
        self.assertTrue(all(r['application_state'] == 'unknown' for r in rows))
        self.assertIsNone(jobdb.require(self.conn, 'analyses', 'rank')['facts_version'])
        self.assertEqual(jobdb.stats(self.conn)['applications'], 0)
        self.assertNotIn('尾注', jobdb.job_context(self.conn, 'all', '1')['assessments'][0]['source_block'])

    def test_status_materials_are_explicit_and_survive_reimport(self):
        source = self.jobs()
        jobdb.import_jobs(self.conn, source, 'all')
        resume = self.root / 'resume.pdf'
        resume.write_bytes(b'test file')
        jobdb.set_status(self.conn, 'all', '1', 'submitted', '2026-10-14T13:00:00-04:00', str(resume), notes='手动投递')
        jobdb.import_jobs(self.conn, source, 'all')
        jobdb.set_status(self.conn, 'all', '1', 'interview')
        state = jobdb.job_context(self.conn, 'all', '1')['application']
        self.assertEqual(state['state'], 'interview')
        self.assertEqual(state['submitted_at'], '2026-10-14T13:00:00-04:00')
        self.assertEqual(state['resume_path'], str(resume.resolve()))
        self.assertEqual(state['notes'], '手动投递')
        self.assertEqual(len(jobdb.list_jobs(self.conn, 'all', state='interview')), 1)
        with self.assertRaises(ValueError):
            jobdb.set_status(self.conn, 'all', '99', 'submitted')
        with self.assertRaises(ValueError):
            jobdb.set_status(self.conn, 'all', '2', 'submitted', submitted_at='2026-10-14T13:00:00')

    def test_facts_context_reads_current_file_and_versions_remain_immutable(self):
        jobdb.import_jobs(self.conn, self.jobs(), 'all')
        facts = self.root / 'RESUME_FACTS.md'
        facts.write_text('已确认的经历', encoding='utf-8')
        jobdb.save_facts(self.conn, facts, 'v1')
        facts.write_text('已更新的经历', encoding='utf-8')
        self.assertEqual(jobdb.job_context(self.conn, 'all', '1', facts)['resume_facts']['content'], '已更新的经历')
        with self.assertRaises(ValueError):
            jobdb.save_facts(self.conn, facts, 'v1')
        jobdb.save_facts(self.conn, facts, 'v2')

    def test_foreign_keys_and_failed_transaction(self):
        source = self.jobs(apps='unknown')
        jobdb.import_jobs(self.conn, source, 'all')
        self.assertIsNone(self.conn.execute('SELECT apps FROM job_snapshots LIMIT 1').fetchone()[0])
        with self.assertRaises(sqlite3.IntegrityError):
            jobdb.set_status(self.conn, 'all', '1', 'invalid')
        self.assertEqual(jobdb.stats(self.conn)['applications'], 0)
        self.assertEqual(jobdb.stats(self.conn)['foreign_key_errors'], [])

    def test_export_does_not_overwrite_source(self):
        source = self.jobs()
        before = source.read_bytes()
        with self.assertRaises(FileExistsError):
            jobdb.write_json({'jobs': []}, source)
        self.assertEqual(source.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
