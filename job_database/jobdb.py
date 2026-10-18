"""Local WaterlooWorks database tools; Python standard library only."""
import argparse
import hashlib
import json
import re
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_DB = HERE / 'applications.sqlite3'
STATES = ('unknown', 'planned', 'submitted', 'interview', 'offer', 'rejected', 'withdrawn', 'skipped')
EXPORT_SCHEMA = json.loads((HERE / 'job-export.schema.json').read_text(encoding='utf-8-sig'))
JOB_FIELDS = EXPORT_SCHEMA['$defs']['job']['properties']


def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def encode(value):
    return json.dumps(value, ensure_ascii=False, indent=2)


def read_source(path):
    path = Path(path).resolve()
    raw = path.read_bytes()
    return str(path), hashlib.sha256(raw).hexdigest(), raw.decode('utf-8-sig')


def connect(path=DEFAULT_DB):
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    return conn


def initialize(conn):
    version = conn.execute('PRAGMA user_version').fetchone()[0]
    if version not in (0, 1, 2):
        raise ValueError(f'Unsupported database version: {version}')
    migration = ''
    if version == 1:
        # The real v1 database contains user data; migrate it once, in place.
        migration = '''ALTER TABLE batches ADD COLUMN base_batch_name TEXT REFERENCES batches(name);
            ALTER TABLE job_snapshots ADD COLUMN effective_json TEXT NOT NULL DEFAULT '{}'
                CHECK (json_valid(effective_json));
            UPDATE job_snapshots SET effective_json = raw_json;'''
    columns = ',\n'.join(f'json_extract(effective_json, \'$.{field}\') AS "{field}"' for field in JOB_FIELDS)
    view = f'CREATE VIEW IF NOT EXISTS job_export_fields AS SELECT batch_name, {columns} FROM job_snapshots;'
    try:
        conn.executescript('BEGIN IMMEDIATE;\n' + migration + '\n' +
                           (HERE / 'schema.sql').read_text(encoding='utf-8') + '\n' + view + '\nCOMMIT;')
    except sqlite3.Error:
        conn.rollback()
        raise


def require(conn, table, name):
    # Table names are internal constants, never user input.
    row = conn.execute(f'SELECT * FROM {table} WHERE name = ?', (name,)).fetchone()
    if row is None:
        raise ValueError(f'Unknown {table} name: {name}')
    return row


def existing(conn, table, name, digest):
    row = conn.execute(f'SELECT * FROM {table} WHERE name = ?', (name,)).fetchone()
    if row is not None and row['source_sha256'] != digest:
        raise ValueError(f'{name} already contains another source. Use a new name for a new version.')
    return row


def posting_id(value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f'Posting ID must be a nonempty string: {value!r}')
    return value


def integer(value):
    # Only a derived SQLite integer; display strings remain unchanged in JSON.
    text = str(value).strip()
    if not re.fullmatch(r'[0-9]+', text):
        return None
    digits = text.lstrip('0') or '0'
    if len(digits) > 19:
        return None
    number = int(digits)
    return number if number <= 9223372036854775807 else None


def timestamp(value):
    if value is not None:
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None:
            raise ValueError('A timestamp must include its UTC offset, e.g. 2026-10-14T15:00:00-04:00.')
    return value


def validate_export(data):
    """Validate the types in the bundled exporter schema and import identities.

    This is specific to the 40-field contract, not a general JSON Schema engine.
    Hiring-history interiors deliberately have no fixed schema.
    """
    if not isinstance(data, dict):
        raise ValueError('Expected a WaterlooWorks JSON object.')
    missing = set(EXPORT_SCHEMA['required']) - data.keys()
    unknown = data.keys() - EXPORT_SCHEMA['properties'].keys()
    if missing or unknown:
        raise ValueError(f'Export properties: missing={sorted(missing)}, unknown={sorted(unknown)}.')
    if type(data['total_jobs']) is not int or data['total_jobs'] < 0:
        raise ValueError('total_jobs must be a nonnegative integer.')
    if not isinstance(data['jobs'], list) or not isinstance(data['posting_ids'], list):
        raise ValueError('jobs and posting_ids must be arrays.')
    ids = []
    seen = set()
    for index, job in enumerate(data['jobs']):
        if not isinstance(job, dict) or 'posting_id' not in job:
            raise ValueError(f'jobs[{index}] needs a posting_id; no positional ID inference is allowed.')
        pid = posting_id(job['posting_id'])
        if pid in seen:
            raise ValueError(f'Duplicate posting ID {pid!r} in jobs; resolve conflicting records before importing.')
        seen.add(pid)
        ids.append(pid)
        for field, value in job.items():
            if field not in JOB_FIELDS:
                raise ValueError(f'jobs[{index}].{field} is unknown; update the export contract before importing.')
            spec = JOB_FIELDS[field]
            if spec.get('type') == 'string':
                valid = isinstance(value, str)
            elif spec.get('$ref') == '#/$defs/serviceTeam':
                valid = isinstance(value, list) and all(
                    isinstance(row, list) and len(row) >= 1 and all(isinstance(cell, str) for cell in row)
                    for row in value)
            elif spec.get('$ref') == '#/$defs/hiringHistory':
                valid = value is None or isinstance(value, dict)
            else:
                raise ValueError(f'Unsupported contract type for {field}; update the importer.')
            if not valid:
                raise ValueError(f'jobs[{index}].{field} does not match the export schema.')
    if data['total_jobs'] != len(data['jobs']):
        raise ValueError('total_jobs does not match jobs length.')
    listed = [posting_id(value) for value in data['posting_ids']]
    if len(listed) != len(set(listed)):
        raise ValueError('posting_ids must contain unique IDs.')
    # The two arrays need not be in the same order. Duplicate records are rejected above.
    if set(listed) != set(ids):
        raise ValueError('posting_ids does not match the IDs in job records.')


def field_state(job, field):
    if job is None or field not in job:
        return 'missing'
    value = job[field]
    if value is None:
        return 'null'
    if value == '':
        return 'empty_string'
    if value == []:
        return 'empty_array'
    return 'value'


def merge_job(previous, incoming):
    merged = dict(previous)
    for field, value in incoming.items():
        # The exporter cannot distinguish missing content from a failed scrape.
        # Keep the observation in raw_json without interpreting it as deletion.
        if field_state(incoming, field) in ('empty_string', 'empty_array', 'null') and field in previous:
            continue
        merged[field] = value
    return merged


def import_jobs(conn, path, name, role='unknown', observed_at=None, base_batch=None):
    source, digest, text = read_source(path)
    data = json.loads(text)
    validate_export(data)
    rows = data['jobs']
    timestamp(observed_at)
    if base_batch:
        require(conn, 'batches', base_batch)
    prior = existing(conn, 'batches', name, digest)
    if prior is not None:
        if (prior['role'] != role or prior['observed_at'] != observed_at
                or prior['base_batch_name'] != base_batch):
            raise ValueError('Existing import metadata differs; use a new batch name.')
        return len(rows)
    incoming = {job['posting_id']: job for job in rows}
    effective = {}
    if base_batch:
        effective = {row['posting_id']: json.loads(row['effective_json']) for row in conn.execute(
            'SELECT posting_id, effective_json FROM job_snapshots WHERE batch_name = ? ORDER BY rowid', (base_batch,))}
    for pid, job in incoming.items():
        effective[pid] = merge_job(effective.get(pid, {}), job)
    fields = ('title', 'organization', 'division', 'city', 'level', 'work_term_duration',
              'required_skills', 'job_responsibilities', 'job_summary', 'special_job_requirements')
    with conn:
        conn.execute('''INSERT INTO batches
            (name, role, source_path, source_sha256, imported_at, observed_at, raw_json, base_batch_name)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)''',
                     (name, role, source, digest, now(), observed_at, text, base_batch))
        for pid, job in effective.items():
            conn.execute('INSERT OR IGNORE INTO jobs VALUES (?)', (pid,))
            conn.execute('''INSERT INTO job_snapshots
                (batch_name, posting_id, title, organization, division, city, level,
                 work_term_duration, required_skills, job_responsibilities, job_summary,
                 special_job_requirements, apps, openings, deadline_text, raw_json, effective_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
                         (name, pid, *(job.get(f) for f in fields), integer(job.get('apps')),
                          integer(job.get('openings')), job.get('app_deadline'),
                          encode(incoming.get(pid)), encode(job)))
    return len(rows)


def import_selection(conn, path, name, batch=None, kind='classification'):
    source, digest, text = read_source(path)
    data = json.loads(text)
    if batch:
        require(conn, 'batches', batch)
    items = []
    if isinstance(data, dict) and isinstance(data.get('folders'), dict):
        for category, ids in data['folders'].items():
            if not isinstance(ids, list):
                raise ValueError('Each folder must contain an array of posting IDs.')
            items.extend((posting_id(pid), category, n) for n, pid in enumerate(ids, 1))
    else:
        if isinstance(data, dict) and isinstance(data.get('jobs'), list):
            ids = [job['posting_id'] for job in data['jobs']]
        elif isinstance(data, dict) and isinstance(data.get('posting_ids'), list):
            ids = data['posting_ids']
        elif isinstance(data, list):
            ids = data
        else:
            raise ValueError('Expected folders, jobs, posting_ids, or an array of posting IDs.')
        items = [(posting_id(pid), None, n) for n, pid in enumerate(ids, 1)]
    if kind == 'classification' and any(category is None for _, category, _ in items):
        raise ValueError('A classification selection needs the folders format.')
    if len(items) != len({pid for pid, _, _ in items}):
        raise ValueError('A posting ID occurs more than once in this selection.')
    prior = existing(conn, 'selections', name, digest)
    if prior:
        if prior['batch_name'] != batch or prior['kind'] != kind:
            raise ValueError('Existing selection metadata differs; use a new name.')
        return len(items)
    if batch:
        known = {row[0] for row in conn.execute(
            'SELECT posting_id FROM job_snapshots WHERE batch_name = ?', (batch,))}
        missing = {pid for pid, _, _ in items} - known
        if missing:
            raise ValueError(f'Selection IDs missing from batch {batch}: {sorted(missing)}')
    with conn:
        conn.execute('INSERT INTO selections VALUES (?, ?, ?, ?, ?, ?, ?)',
                     (name, batch, kind, source, digest, now(), text))
        for pid, category, position in items:
            conn.execute('INSERT OR IGNORE INTO jobs VALUES (?)', (pid,))
            conn.execute('INSERT INTO selection_items VALUES (?, ?, ?, ?)',
                         (name, pid, category, position))
    return len(items)


def save_facts(conn, path, name):
    source, digest, text = read_source(path)
    row = conn.execute('SELECT sha256 FROM facts_versions WHERE name = ?', (name,)).fetchone()
    if row is not None:
        if row[0] != digest:
            raise ValueError('This facts version already exists; save changes under a new version name.')
        return digest
    with conn:
        conn.execute('INSERT INTO facts_versions VALUES (?, ?, ?, ?, ?)',
                     (name, source, digest, now(), text))
    return digest


def parse_ranking(text):
    pattern = r'^(\d+)\. Job ID (.+?) \| ([^\r\n]+)'
    headings = list(re.finditer(pattern, text, re.M))
    if not headings:
        raise ValueError('No ranking entries found.')
    result = []
    for index, heading in enumerate(headings):
        block = text[heading.start():headings[index + 1].start() if index + 1 < len(headings) else len(text)]
        lines = block.splitlines()
        def line(prefix):
            matches = [s[len(prefix):].strip() for s in lines if s.startswith(prefix)]
            if len(matches) != 1:
                raise ValueError(f'Expected one {prefix} line for {heading[2]}.')
            return matches[0]
        advice = line('建议：')
        match = re.fullmatch(r'(.+?) \| 机会优先分：(.+?) \| 匹配度：([0-9.]+)/5', advice)
        if match is None:
            raise ValueError(f'Unrecognized advice for {heading[2]}: {advice}')
        score = re.fullmatch(r'([0-9.]+)/100（非概率）', match[2])
        if score is None and match[2] != '不适用':
            raise ValueError(f'Unrecognized opportunity score: {match[2]}')
        document = line('建议文书：')
        code = re.match(r'([0-9]{2})\s', document)
        if code is None:
            raise ValueError(f'Missing document code for {heading[2]}.')
        reason = line('原因：')
        # Keep only the actual entry, excluding trailing section headers/footer.
        end = next(i for i, s in enumerate(lines) if s.startswith('建议文书：'))
        result.append(dict(rank=int(heading[1]), posting_id=posting_id(heading[2]),
                           opportunity_score=float(score[1]) if score else None,
                           fit_score=float(match[3]), recommendation=match[1], reason=reason,
                           document_code=code[1], document_advice=document,
                           source_block='\n'.join(lines[:end + 1])))
    ids = [row['posting_id'] for row in result]
    if len(ids) != len(set(ids)) or sorted(row['rank'] for row in result) != list(range(1, len(result) + 1)):
        raise ValueError('Rankings must have unique IDs and consecutive ranks starting at 1.')
    return result


def import_ranking(conn, path, name, batch, facts_version=None):
    require(conn, 'batches', batch)
    if facts_version:
        require(conn, 'facts_versions', facts_version)
    source, digest, text = read_source(path)
    entries = parse_ranking(text)
    prior = existing(conn, 'analyses', name, digest)
    if prior:
        if prior['batch_name'] != batch or prior['facts_version'] != facts_version:
            raise ValueError('Existing analysis metadata differs; use a new name.')
        return len(entries)
    known = {row[0] for row in conn.execute(
        'SELECT posting_id FROM job_snapshots WHERE batch_name = ?', (batch,))}
    missing = {row['posting_id'] for row in entries} - known
    if missing:
        raise ValueError(f'Ranked IDs missing from batch: {sorted(missing)}')
    facts_path = re.search(r'^个人资料：(.+?)；', text, re.M)
    with conn:
        conn.execute('INSERT INTO analyses VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                     (name, batch, source, digest, now(), facts_path[1] if facts_path else None,
                      facts_version, text))
        for row in entries:
            conn.execute('INSERT INTO assessments VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                         (name, batch, row['posting_id'], row['rank'], row['opportunity_score'],
                          row['fit_score'], row['recommendation'], row['reason'], row['document_code'],
                          row['document_advice'], row['source_block']))
    return len(entries)


def selection_ids(conn, name, batch):
    selection = require(conn, 'selections', name)
    if selection['batch_name'] != batch:
        raise ValueError(f'Selection {name} is not explicitly linked to batch {batch}.')
    return {row[0] for row in conn.execute(
        'SELECT posting_id FROM selection_items WHERE selection_name = ?', (name,))}


def export_jobs(conn, batch, include=(), exclude=(), raw=False):
    source = json.loads(require(conn, 'batches', batch)['raw_json'])
    if raw and not include and not exclude:
        return source
    allowed = None
    for name in include:
        ids = selection_ids(conn, name, batch)
        allowed = ids if allowed is None else allowed | ids
    blocked = set()
    for name in exclude:
        blocked |= selection_ids(conn, name, batch)
    source_jobs = source['jobs'] if raw else [json.loads(row[0]) for row in conn.execute(
        'SELECT effective_json FROM job_snapshots WHERE batch_name = ? ORDER BY rowid', (batch,))]
    jobs = [j for j in source_jobs
            if (allowed is None or j['posting_id'] in allowed) and j['posting_id'] not in blocked]
    return {**source, 'total_jobs': len(jobs), 'posting_ids': [j['posting_id'] for j in jobs], 'jobs': jobs}


def export_classification(conn, name):
    selection = require(conn, 'selections', name)
    if selection['kind'] != 'classification':
        raise ValueError('This selection is not a classification.')
    # Category key order and empty folders are part of the existing plugin format.
    folders = {key: [] for key in json.loads(selection['raw_json'])['folders']}
    for row in conn.execute('SELECT * FROM selection_items WHERE selection_name = ? ORDER BY position', (name,)):
        folders[row['category']].append(row['posting_id'])
    return {'folders': folders}


def set_status(conn, batch, pid, state, submitted_at=None, resume=None, cover_letter=None, notes=None):
    if conn.execute('SELECT 1 FROM job_snapshots WHERE batch_name = ? AND posting_id = ?', (batch, pid)).fetchone() is None:
        raise ValueError(f'No job {pid} in batch {batch}.')
    timestamp(submitted_at)
    paths = []
    for path in (resume, cover_letter):
        if path is not None and not Path(path).is_file():
            raise ValueError(f'Material file does not exist: {path}')
        paths.append(str(Path(path).resolve()) if path is not None else None)
    with conn:
        conn.execute('''INSERT INTO applications VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(batch_name, posting_id) DO UPDATE SET state = excluded.state,
            submitted_at = COALESCE(excluded.submitted_at, applications.submitted_at),
            resume_path = COALESCE(excluded.resume_path, applications.resume_path),
            cover_letter_path = COALESCE(excluded.cover_letter_path, applications.cover_letter_path),
            notes = COALESCE(excluded.notes, applications.notes), updated_at = excluded.updated_at''',
                     (batch, pid, state, submitted_at, *paths, notes, now()))


def job_context(conn, batch, pid, facts_path=None):
    snapshot = conn.execute('SELECT raw_json, effective_json FROM job_snapshots WHERE batch_name = ? AND posting_id = ?',
                            (batch, pid)).fetchone()
    if snapshot is None:
        raise ValueError(f'No job {pid} in batch {batch}.')
    source = require(conn, 'batches', batch)
    status = conn.execute('SELECT * FROM applications WHERE batch_name = ? AND posting_id = ?', (batch, pid)).fetchone()
    source_job = json.loads(snapshot['raw_json'])
    result = dict(batch=batch, source_path=source['source_path'], source_sha256=source['source_sha256'],
                  observed_at=source['observed_at'], base_batch=source['base_batch_name'],
                  job=json.loads(snapshot['effective_json']), source_job=source_job,
                  source_field_states={field: field_state(source_job, field) for field in JOB_FIELDS},
                  assessments=[dict(row) for row in conn.execute(
                      'SELECT * FROM assessments WHERE batch_name = ? AND posting_id = ?', (batch, pid))],
                  selections=[dict(row) for row in conn.execute('''SELECT s.name, s.kind, i.category
                      FROM selection_items i JOIN selections s ON s.name = i.selection_name
                      WHERE s.batch_name = ? AND i.posting_id = ?''', (batch, pid))],
                  application=dict(status) if status else {'state': 'unknown'})
    if facts_path:
        source, digest, text = read_source(facts_path)
        result['resume_facts'] = {'source_path': source, 'sha256': digest, 'content': text}
    return result


def list_jobs(conn, batch, analysis=None, selection=None, category=None, state=None, limit=100):
    require(conn, 'batches', batch)
    if analysis:
        if require(conn, 'analyses', analysis)['batch_name'] != batch:
            raise ValueError('Analysis belongs to another batch.')
    if selection:
        selection_ids(conn, selection, batch)
    if category and not selection:
        raise ValueError('--category requires --selection.')
    sql = '''SELECT s.posting_id, s.title, s.organization, s.city, a.rank,
        a.opportunity_score, a.fit_score, a.recommendation, a.document_code,
        COALESCE(p.state, 'unknown') AS application_state
        FROM job_snapshots s
        LEFT JOIN assessments a ON a.batch_name = s.batch_name AND a.posting_id = s.posting_id
            AND a.analysis_name = ?
        LEFT JOIN applications p ON p.batch_name = s.batch_name AND p.posting_id = s.posting_id
        WHERE s.batch_name = ?'''
    params = [analysis, batch]
    if selection:
        sql += ''' AND EXISTS (SELECT 1 FROM selection_items i
            WHERE i.posting_id = s.posting_id AND i.selection_name = ?'''
        params.append(selection)
        if category:
            sql += ' AND i.category = ?'
            params.append(category)
        sql += ')'
    if state:
        sql += " AND COALESCE(p.state, 'unknown') = ?"
        params.append(state)
    sql += ' ORDER BY a.rank IS NULL, a.rank, s.posting_id LIMIT ?'
    params.append(limit)
    return [dict(row) for row in conn.execute(sql, params)]


def stats(conn):
    return dict(
        jobs=conn.execute('SELECT COUNT(*) FROM jobs').fetchone()[0],
        snapshots=conn.execute('SELECT COUNT(*) FROM job_snapshots').fetchone()[0],
        batches=[dict(r) for r in conn.execute('''SELECT b.name, b.role, b.observed_at,
            b.base_batch_name, COUNT(s.posting_id) AS jobs FROM batches b LEFT JOIN job_snapshots s
            ON b.name = s.batch_name GROUP BY b.name ORDER BY b.name''')],
        selections=[dict(r) for r in conn.execute('''SELECT s.name, s.batch_name, s.kind,
            COUNT(i.posting_id) AS jobs FROM selections s LEFT JOIN selection_items i
            ON s.name = i.selection_name GROUP BY s.name ORDER BY s.name''')],
        analyses=[dict(r) for r in conn.execute('''SELECT a.name, a.batch_name, a.facts_version,
            COUNT(r.posting_id) AS jobs FROM analyses a LEFT JOIN assessments r
            ON a.name = r.analysis_name GROUP BY a.name ORDER BY a.name''')],
        applications=conn.execute('SELECT COUNT(*) FROM applications').fetchone()[0],
        integrity=conn.execute('PRAGMA integrity_check').fetchone()[0],
        foreign_key_errors=[list(row) for row in conn.execute('PRAGMA foreign_key_check')])


def write_json(value, output=None):
    text = encode(value)
    if output:
        path = Path(output).resolve()
        # Outputs must be new files; never overwrite the user's source JSON or references.
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open('x', encoding='utf-8') as file:
            file.write(text + '\n')
        return str(path)
    print(text)


def parser():
    p = argparse.ArgumentParser(description='WaterlooWorks SQLite database')
    p.add_argument('--db', type=Path, default=DEFAULT_DB)
    commands = p.add_subparsers(dest='command', required=True)
    commands.add_parser('init')
    commands.add_parser('stats')
    c = commands.add_parser('import-jobs')
    c.add_argument('file'); c.add_argument('--name', required=True)
    c.add_argument('--role', choices=('all', 'major', 'candidate', 'unknown'), default='unknown')
    c.add_argument('--observed-at')
    c.add_argument('--base-batch', help='Preserve an existing batch and enrich a new one using these partial fields.')
    c = commands.add_parser('import-selection')
    c.add_argument('file'); c.add_argument('--name', required=True); c.add_argument('--batch')
    c.add_argument('--kind', choices=('classification', 'major', 'screened'), default='classification')
    c = commands.add_parser('import-ranking')
    c.add_argument('file'); c.add_argument('--name', required=True); c.add_argument('--batch', required=True)
    c.add_argument('--facts-version')
    c = commands.add_parser('save-facts')
    c.add_argument('file'); c.add_argument('--name', required=True)
    c = commands.add_parser('list')
    c.add_argument('--batch', required=True); c.add_argument('--analysis'); c.add_argument('--selection')
    c.add_argument('--category'); c.add_argument('--state', choices=STATES)
    c.add_argument('--limit', type=int, default=100)
    c = commands.add_parser('show')
    c.add_argument('job_id'); c.add_argument('--batch', required=True)
    c.add_argument('--facts'); c.add_argument('--output')
    c = commands.add_parser('export-jobs')
    c.add_argument('--batch', required=True); c.add_argument('--include-selection', action='append', default=[])
    c.add_argument('--exclude-selection', action='append', default=[]); c.add_argument('--output', required=True)
    c.add_argument('--raw', action='store_true', help='Export the original incoming data instead of merged values.')
    c = commands.add_parser('export-classification')
    c.add_argument('--selection', required=True); c.add_argument('--output', required=True)
    c = commands.add_parser('status')
    c.add_argument('job_id'); c.add_argument('--batch', required=True); c.add_argument('--state', choices=STATES, required=True)
    c.add_argument('--submitted-at'); c.add_argument('--resume'); c.add_argument('--cover-letter'); c.add_argument('--notes')
    return p


def main():
    args = parser().parse_args()
    if args.command != 'init' and not args.db.is_file():
        raise ValueError('Database does not exist. Run init first.')
    if args.command == 'init':
        args.db.parent.mkdir(parents=True, exist_ok=True)
    conn = connect(args.db)
    try:
        if args.command == 'init':
            initialize(conn); result = {'database': str(args.db.resolve())}
        elif args.command == 'stats':
            result = stats(conn)
        elif args.command == 'import-jobs':
            result = {'imported': import_jobs(conn, args.file, args.name, args.role, args.observed_at, args.base_batch),
                      'snapshot_jobs': conn.execute('SELECT COUNT(*) FROM job_snapshots WHERE batch_name = ?',
                                                    (args.name,)).fetchone()[0]}
        elif args.command == 'import-selection':
            result = {'imported': import_selection(conn, args.file, args.name, args.batch, args.kind)}
        elif args.command == 'import-ranking':
            result = {'imported': import_ranking(conn, args.file, args.name, args.batch, args.facts_version)}
        elif args.command == 'save-facts':
            result = {'sha256': save_facts(conn, args.file, args.name)}
        elif args.command == 'list':
            if args.limit <= 0:
                raise ValueError('--limit must be greater than zero.')
            result = list_jobs(conn, args.batch, args.analysis, args.selection, args.category, args.state, args.limit)
        elif args.command == 'show':
            result = job_context(conn, args.batch, posting_id(args.job_id), args.facts)
            if args.output:
                result = {'output': write_json(result, args.output)}
        elif args.command == 'export-jobs':
            result = {'output': write_json(export_jobs(conn, args.batch, args.include_selection, args.exclude_selection, args.raw), args.output)}
        elif args.command == 'export-classification':
            result = {'output': write_json(export_classification(conn, args.selection), args.output)}
        elif args.command == 'status':
            set_status(conn, args.batch, posting_id(args.job_id), args.state, args.submitted_at,
                       args.resume, args.cover_letter, args.notes)
            result = {'job_id': args.job_id, 'state': args.state}
        write_json(result)
    finally:
        conn.close()


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    try:
        main()
    except (ValueError, KeyError, OSError, sqlite3.Error) as error:
        print(f'Error: {error}', file=sys.stderr)
        sys.exit(1)
