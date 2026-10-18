"""Exporter handoff regressions. All example jobs stay in temporary databases."""
import json
import tempfile
import unittest
from pathlib import Path

import jobdb

FIXTURES = Path(__file__).resolve().parent / 'fixtures'


class ExportContractTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.conn = jobdb.connect(self.root / 'test.sqlite3')
        jobdb.initialize(self.conn)

    def tearDown(self):
        self.conn.close()
        self.temp.cleanup()

    def fixture(self, name):
        return FIXTURES / (name + '.json')

    def payload(self, jobs, **changes):
        data = dict(total_jobs=len(jobs), posting_ids=list(dict.fromkeys(j['posting_id'] for j in jobs
                    if 'posting_id' in j)), jobs=jobs)
        data.update(changes)
        path = self.root / f'input-{len(list(self.root.glob("*.json")))}.json'
        path.write_text(jobdb.encode(data), encoding='utf-8')
        return path

    def read(self, name):
        return json.loads(self.fixture(name).read_text(encoding='utf-8-sig'))

    def test_all_three_contract_examples_and_all_40_queryable_fields(self):
        for name in ('all-sections', 'selected-sections', 'id-only'):
            jobdb.import_jobs(self.conn, self.fixture(name), name)
            expected = self.read(name)
            context = jobdb.job_context(self.conn, name, 'EXAMPLE-001')
            self.assertEqual(context['job'], expected['jobs'][0])
            self.assertEqual(context['source_job'], expected['jobs'][0])
            self.assertEqual(jobdb.export_jobs(self.conn, name, raw=True), expected)
        full = self.read('all-sections')['jobs'][0]
        row = self.conn.execute("SELECT * FROM job_export_fields WHERE batch_name='all-sections'").fetchone()
        self.assertEqual(set(row.keys()) - {'batch_name'}, set(full))
        for field, value in full.items():
            actual = json.loads(row[field]) if isinstance(value, (dict, list)) else row[field]
            self.assertEqual(actual, value, field)
        self.assertIsInstance(row['apps'], str)
        self.assertIsNone(jobdb.require(self.conn, 'batches', 'id-only')['base_batch_name'])

    def test_partial_then_id_only_keeps_prior_values_without_modifying_source(self):
        jobdb.import_jobs(self.conn, self.fixture('all-sections'), 'full')
        jobdb.import_jobs(self.conn, self.fixture('selected-sections'), 'partial', base_batch='full')
        jobdb.import_jobs(self.conn, self.fixture('id-only'), 'ids', base_batch='partial')
        full = self.read('all-sections')['jobs'][0]
        self.assertEqual(jobdb.job_context(self.conn, 'ids', 'EXAMPLE-001')['job'], full)
        partial = jobdb.job_context(self.conn, 'partial', 'EXAMPLE-001')
        self.assertEqual(partial['source_field_states']['required_skills'], 'missing')
        self.assertNotIn('required_skills', partial['source_job'])
        self.assertEqual(jobdb.export_jobs(self.conn, 'partial', raw=True), self.read('selected-sections'))
        self.assertEqual(jobdb.export_jobs(self.conn, 'ids')['jobs'][0], full)
        self.assertEqual(jobdb.job_context(self.conn, 'full', 'EXAMPLE-001')['job'], full)

    def test_missing_empty_string_empty_array_and_null_are_distinct(self):
        base = {'posting_id': '001', 'required_skills': 'Python', 'job_summary': 'Long summary',
                'service_team': [['EEM', 'A', 'Phone']], 'hires_by_faculty': {'data': [3]}}
        jobdb.import_jobs(self.conn, self.payload([base]), 'base')
        update = {'posting_id': '001', 'job_summary': '', 'service_team': [], 'hires_by_faculty': None}
        jobdb.import_jobs(self.conn, self.payload([update]), 'empty', base_batch='base')
        context = jobdb.job_context(self.conn, 'empty', '001')
        self.assertEqual(context['job'], base)
        self.assertEqual(context['source_job'], update)
        for key, state in [('required_skills', 'missing'), ('job_summary', 'empty_string'),
                           ('service_team', 'empty_array'), ('hires_by_faculty', 'null')]:
            self.assertEqual(context['source_field_states'][key], state)
        row = self.conn.execute('''SELECT json_type(raw_json, '$.required_skills'),
            json_extract(raw_json, '$.job_summary'), json_extract(raw_json, '$.service_team'),
            json_type(raw_json, '$.hires_by_faculty') FROM job_snapshots WHERE batch_name='empty' ''').fetchone()
        self.assertEqual(tuple(row), (None, '', '[]', 'null'))
        # With no prior value, record exactly the explicit empty values; never invent zero hires.
        jobdb.import_jobs(self.conn, self.payload([update]), 'empty-alone')
        self.assertEqual(jobdb.job_context(self.conn, 'empty-alone', '001')['job'], update)

    def test_new_values_replace_whole_structures_and_keep_list_and_detail_separate(self):
        original = self.read('all-sections')['jobs'][0]
        jobdb.import_jobs(self.conn, self.fixture('all-sections'), 'base')
        history = {'tables': [{'columns': ['count'], 'rows': [[None, 'three', 3]]}], 'lists': [], 'text_lines': []}
        patch = {'posting_id': 'EXAMPLE-001', 'job_title': 'Different detail title',
                 'job_city': 'Detail city', 'application_deadline': 'Different display date',
                 'number_of_job_openings': 'Several', 'company_organization': 'Detail company',
                 'job_level': 'Detail level', 'company_division': 'Detail division',
                 'job_summary': '完整长文本。' * 700, 'service_team': [['Role'], ['Role', 'Name', 'Email']],
                 'hires_by_faculty': history}
        jobdb.import_jobs(self.conn, self.payload([patch]), 'update', base_batch='base')
        context = jobdb.job_context(self.conn, 'update', 'EXAMPLE-001')
        for key, value in patch.items():
            self.assertEqual(context['job'][key], value)
        for key in ('title', 'city', 'app_deadline', 'openings', 'organization', 'level', 'division'):
            self.assertEqual(context['job'][key], original[key])
        self.assertNotIn('columns', context['job']['hires_by_faculty'])
        self.assertEqual(self.conn.execute("SELECT job_summary FROM job_snapshots WHERE batch_name='update'").fetchone()[0], patch['job_summary'])

    def test_record_identity_uses_each_job_not_parallel_array_and_keeps_leading_zero(self):
        path = self.payload([{'posting_id': '001', 'title': 'A'}, {'posting_id': 'ABC-2', 'title': 'B'}],
                            posting_ids=['ABC-2', '001'])
        jobdb.import_jobs(self.conn, path, 'reordered')
        self.assertEqual(jobdb.job_context(self.conn, 'reordered', '001')['job']['title'], 'A')
        self.assertEqual(jobdb.job_context(self.conn, 'reordered', 'ABC-2')['job']['title'], 'B')
        self.assertEqual(jobdb.export_jobs(self.conn, 'reordered', raw=True), json.loads(path.read_text(encoding='utf-8')))

    def test_bad_identity_conflicts_and_top_level_inconsistency_reject_entire_file(self):
        invalid = [([{}], {}), ([{'posting_id': ''}], {}), ([{'posting_id': '  '}], {}),
                   ([{'posting_id': 1}], {}),
                   ([{'posting_id': 'same', 'title': 'A'}, {'posting_id': 'same', 'title': 'B'}], {}),
                   ([{'posting_id': 'A'}], {'posting_ids': ['B']}),
                   ([{'posting_id': 'A'}], {'posting_ids': ['A', 'A']}),
                   ([{'posting_id': 'A'}], {'total_jobs': 2})]
        for jobs, changes in invalid:
            with self.subTest(jobs=jobs, changes=changes):
                with self.assertRaises(ValueError):
                    jobdb.import_jobs(self.conn, self.payload(jobs, **changes), 'invalid')
                self.assertEqual(self.conn.execute('SELECT COUNT(*) FROM batches').fetchone()[0], 0)
                self.assertEqual(self.conn.execute('SELECT COUNT(*) FROM jobs').fetchone()[0], 0)

    def test_schema_types_and_unknown_fields_are_rejected_before_write(self):
        changes = [{'service_team': None}, {'service_team': [['valid', 1]]}, {'service_team': [[]]},
                   {'hires_by_faculty': []}, {'job_summary': None}, {'openings': 2},
                   {'new_unrecognized_field': 'needs an updated contract'}]
        for change in changes:
            with self.subTest(change=change):
                with self.assertRaises(ValueError):
                    jobdb.import_jobs(self.conn, self.payload([{'posting_id': 'A', **change}]), 'bad')
        self.assertEqual(jobdb.stats(self.conn)['snapshots'], 0)

    def test_partial_job_list_preserves_other_base_jobs_and_does_not_copy_applications(self):
        jobdb.import_jobs(self.conn, self.payload([{'posting_id': '1', 'title': 'A'},
                                                {'posting_id': '2', 'title': 'B'}]), 'base')
        jobdb.set_status(self.conn, 'base', '1', 'submitted')
        patch = self.payload([{'posting_id': '1', 'required_skills': 'Python'}, {'posting_id': '3'}])
        jobdb.import_jobs(self.conn, patch, 'enriched', base_batch='base')
        exported = jobdb.export_jobs(self.conn, 'enriched')
        self.assertEqual(exported['total_jobs'], 3)
        self.assertEqual(exported['posting_ids'], ['1', '2', '3'])
        untouched = jobdb.job_context(self.conn, 'enriched', '2')
        self.assertEqual(untouched['job']['title'], 'B')
        self.assertIsNone(untouched['source_job'])
        self.assertEqual(jobdb.job_context(self.conn, 'base', '1')['application']['state'], 'submitted')
        self.assertEqual(jobdb.job_context(self.conn, 'enriched', '1')['application']['state'], 'unknown')
        jobdb.import_jobs(self.conn, patch, 'enriched', base_batch='base')
        with self.assertRaises(ValueError):
            jobdb.import_jobs(self.conn, patch, 'enriched')

    def test_display_text_never_forces_unsafe_numbers_or_dates(self):
        for text in ('17 applicants', '1,000', '18446744073709551616', ''):
            path = self.payload([{'posting_id': text or 'empty', 'apps': text, 'openings': text,
                                  'compensation_and_benefits': '$25–30/hour',
                                  'app_deadline': 'local display date without zone'}])
            name = 'quantity-' + str(len(list(self.root.glob('*.json'))))
            jobdb.import_jobs(self.conn, path, name)
            row = self.conn.execute('SELECT apps, openings FROM job_snapshots WHERE batch_name=?', (name,)).fetchone()
            self.assertEqual(tuple(row), (None, None))
            context = jobdb.job_context(self.conn, name, text or 'empty')
            self.assertEqual(context['job']['apps'], text)
            self.assertEqual(context['job']['app_deadline'], 'local display date without zone')

    def test_v1_database_migration_preserves_every_original_value(self):
        old = jobdb.connect(self.root / 'v1.sqlite3')
        try:
            old.executescript((FIXTURES / 'schema-v1.sql').read_text(encoding='utf-8'))
            original = {'posting_id': '001', 'title': 'Original', 'hires_by_faculty': None}
            with old:
                old.execute("INSERT INTO jobs VALUES ('001')")
                old.execute('INSERT INTO batches VALUES (?, ?, ?, ?, ?, ?, ?)',
                            ('old', 'all', 'source.json', 'hash', 'time', None, jobdb.encode({'jobs': [original]})))
                old.execute('INSERT INTO job_snapshots (batch_name, posting_id, title, raw_json) VALUES (?, ?, ?, ?)',
                            ('old', '001', 'Original', jobdb.encode(original)))
                old.execute("INSERT INTO applications (batch_name,posting_id,state,notes,updated_at) VALUES ('old','001','submitted','keep','time')")
            before = {table: [tuple(r) for r in old.execute('SELECT * FROM ' + table)]
                      for table in ('jobs', 'batches', 'job_snapshots', 'applications')}
            jobdb.initialize(old)
            self.assertEqual(old.execute('PRAGMA user_version').fetchone()[0], 2)
            for table, rows in before.items():
                current = [tuple(r)[:len(rows[0])] for r in old.execute('SELECT * FROM ' + table)]
                self.assertEqual(current, rows, table)
            self.assertEqual(jobdb.job_context(old, 'old', '001')['job'], original)
            self.assertEqual(jobdb.job_context(old, 'old', '001')['application']['notes'], 'keep')
            jobdb.initialize(old)
            self.assertEqual(old.execute('PRAGMA foreign_key_check').fetchall(), [])
        finally:
            old.close()


if __name__ == '__main__':
    unittest.main()
