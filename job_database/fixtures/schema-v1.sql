PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS jobs (
    posting_id TEXT PRIMARY KEY CHECK (length(posting_id) > 0)
);

-- Each import is an immutable snapshot, not a claim about live WaterlooWorks data.
CREATE TABLE IF NOT EXISTS batches (
    name TEXT PRIMARY KEY,
    role TEXT NOT NULL CHECK (role IN ('all', 'major', 'candidate', 'unknown')),
    source_path TEXT NOT NULL,
    source_sha256 TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    observed_at TEXT,
    raw_json TEXT NOT NULL CHECK (json_valid(raw_json))
);

CREATE TABLE IF NOT EXISTS job_snapshots (
    batch_name TEXT NOT NULL REFERENCES batches(name),
    posting_id TEXT NOT NULL REFERENCES jobs(posting_id),
    title TEXT,
    organization TEXT,
    division TEXT,
    city TEXT,
    level TEXT,
    apps INTEGER CHECK (apps >= 0),
    openings INTEGER CHECK (openings >= 0),
    deadline_text TEXT,
    work_term_duration TEXT,
    required_skills TEXT,
    job_responsibilities TEXT,
    job_summary TEXT,
    special_job_requirements TEXT,
    raw_json TEXT NOT NULL CHECK (json_valid(raw_json)),
    PRIMARY KEY (batch_name, posting_id)
);

CREATE TABLE IF NOT EXISTS selections (
    name TEXT PRIMARY KEY,
    batch_name TEXT REFERENCES batches(name),
    kind TEXT NOT NULL CHECK (kind IN ('classification', 'major', 'screened')),
    source_path TEXT NOT NULL,
    source_sha256 TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    raw_json TEXT NOT NULL CHECK (json_valid(raw_json))
);

CREATE TABLE IF NOT EXISTS selection_items (
    selection_name TEXT NOT NULL REFERENCES selections(name),
    posting_id TEXT NOT NULL REFERENCES jobs(posting_id),
    category TEXT,
    position INTEGER NOT NULL CHECK (position > 0),
    PRIMARY KEY (selection_name, posting_id)
);

CREATE TABLE IF NOT EXISTS facts_versions (
    name TEXT PRIMARY KEY,
    source_path TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    saved_at TEXT NOT NULL,
    content TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analyses (
    name TEXT PRIMARY KEY,
    batch_name TEXT NOT NULL REFERENCES batches(name),
    source_path TEXT NOT NULL,
    source_sha256 TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    facts_source_path TEXT,
    facts_version TEXT REFERENCES facts_versions(name),
    source_text TEXT NOT NULL,
    UNIQUE (name, batch_name)
);

CREATE TABLE IF NOT EXISTS assessments (
    analysis_name TEXT NOT NULL,
    batch_name TEXT NOT NULL,
    posting_id TEXT NOT NULL,
    rank INTEGER NOT NULL CHECK (rank > 0),
    opportunity_score REAL CHECK (opportunity_score BETWEEN 0 AND 100),
    fit_score REAL CHECK (fit_score BETWEEN 0 AND 5),
    recommendation TEXT NOT NULL,
    reason TEXT NOT NULL,
    document_code TEXT NOT NULL,
    document_advice TEXT NOT NULL,
    source_block TEXT NOT NULL,
    PRIMARY KEY (analysis_name, posting_id),
    UNIQUE (analysis_name, rank),
    FOREIGN KEY (analysis_name, batch_name) REFERENCES analyses(name, batch_name),
    FOREIGN KEY (batch_name, posting_id) REFERENCES job_snapshots(batch_name, posting_id)
);

-- No row means unknown. A classification or a generated letter is not a submission.
CREATE TABLE IF NOT EXISTS applications (
    batch_name TEXT NOT NULL,
    posting_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN
        ('unknown', 'planned', 'submitted', 'interview', 'offer', 'rejected', 'withdrawn', 'skipped')),
    submitted_at TEXT,
    resume_path TEXT,
    cover_letter_path TEXT,
    notes TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (batch_name, posting_id),
    FOREIGN KEY (batch_name, posting_id) REFERENCES job_snapshots(batch_name, posting_id)
);

CREATE INDEX IF NOT EXISTS snapshots_by_job ON job_snapshots(posting_id);
CREATE INDEX IF NOT EXISTS selections_by_job ON selection_items(posting_id);

CREATE VIEW IF NOT EXISTS ranked_jobs AS
SELECT a.analysis_name, s.*, a.rank, a.opportunity_score, a.fit_score,
       a.recommendation, a.reason, a.document_code, a.document_advice,
       COALESCE(p.state, 'unknown') AS application_state,
       p.submitted_at, p.resume_path, p.cover_letter_path, p.notes
FROM assessments a
JOIN job_snapshots s USING (batch_name, posting_id)
LEFT JOIN applications p USING (batch_name, posting_id);

PRAGMA user_version = 1;
