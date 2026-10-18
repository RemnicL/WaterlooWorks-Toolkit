# WaterlooWorks Job Database

Store job snapshots, screening and classification selections, ranking analyses, personal-facts versions, and application statuses in SQLite. Requires Python 3.10 or later and uses only the standard library; no database server or third-party packages are needed.

This directory contains the tool source, schema, tests, and synthetic fixtures extracted from the original local database project. Actual databases, personal rankings, screening reports, and the personal-data-dependent `bootstrap.py` script are not included. Initialize a database and import your own data before use. Run all commands below from the repository root.

## Initialize and import

```powershell
python job_database/jobdb.py init
python job_database/jobdb.py import-jobs jobs.json --name first-export --role all
python job_database/jobdb.py stats
python job_database/jobdb.py list --batch first-export
python job_database/jobdb.py show 900000001 --batch first-export
```

The default database is `job_database/applications.sqlite3`, which is ignored by Git. To use a different file, place `--db PATH` before the subcommand, for example `python job_database/jobdb.py --db other.sqlite3 init`. Initialization does not import sample data. Replace example IDs in these commands with IDs from your own export.

See the [export contract](../docs/json-export-contract.md), [schema](job-export.schema.json), and [synthetic example](fixtures/all-sections.json) for the job format. Jobs are identified by each record's nonempty string `posting_id`, preserving leading zeros; the top-level arrays are not paired by position. Invalid types, duplicate IDs, unknown fields, and inconsistent counts are rejected.

Each export is stored as a separately named batch. Reimporting the same source under the same name does not add records; changes to source content or metadata require a new name. Without an explicit base batch, imports do not merge other batches or delete earlier records.

## Enrich a batch with partial fields

```powershell
python job_database/jobdb.py import-jobs selected_sections.json --name enriched --base-batch first-export --role candidate
python job_database/jobdb.py show 900000001 --batch enriched
```

This creates a new batch containing every job from the base batch, then enriches existing jobs or adds new ones from the input. Missing properties, empty strings, empty arrays, and null do not clear existing values; nonempty values update their fields. Original observations remain available through `source_job`, `source_field_states`, and `base_batch`. Rankings, classifications, and application records are not automatically copied to the derived batch.

```powershell
python job_database/jobdb.py export-jobs --batch enriched --output enriched.json
python job_database/jobdb.py export-jobs --batch enriched --raw --output enrichment_input.json
```

The default export contains merged fields. `--raw` exports the original incoming data. Output paths must not already exist.

## Screening and folder classification

```powershell
python job_database/jobdb.py import-selection major_ids.json --name major --batch first-export --kind major
python job_database/jobdb.py export-jobs --batch first-export --exclude-selection major --output nonmajor.json
python job_database/jobdb.py import-selection selected_ids.json --name screened --batch first-export --kind screened
python job_database/jobdb.py export-jobs --batch first-export --include-selection major --include-selection screened --output candidates.json
```

Selection inputs accept job exports, `{"posting_ids": ["900000001"]}`, or ID arrays. Selection members must exist in the associated batch. Repeating `--include-selection` takes the union and removes duplicates.

Folder classification uses the format `{"folders": {"SW": ["900000001"], "HW": []}}`:

```powershell
python job_database/jobdb.py import-selection categories.json --name folders --batch first-export --kind classification
python job_database/jobdb.py export-classification --selection folders --output folders.json
```

The export preserves category order and ID order within each category and can be loaded into [Folder Importer](../folder-debug-extension/README.md). The extension requires existing folders with exactly matching names, positive integer posting IDs represented as strings, and each posting appearing only once.

## Rankings, personal facts, and application statuses

```powershell
python job_database/jobdb.py save-facts RESUME_FACTS.md --name facts-v1
python job_database/jobdb.py import-ranking ranking.txt --name ranking-v1 --batch first-export --facts-version facts-v1
python job_database/jobdb.py list --batch first-export --analysis ranking-v1 --selection folders --category SW
python job_database/jobdb.py show 900000001 --batch first-export --facts RESUME_FACTS.md
```

Specify `--facts-version` only when the analysis actually used that facts version. Ranks must be consecutive starting at 1, IDs must be unique, and every ID must exist in the associated batch. Scores are comparative measures, not hiring probabilities.

The ranking importer currently reads the original structured TXT format with fixed Chinese field labels. It does not accept an English translation of those labels. Each entry starts with `001. Job ID 900000001 | Example role | Example company`, followed by recommendation, opportunity score, fit score, reason, and document-advice fields. See [`parse_ranking` in jobdb.py](jobdb.py#L277) for the exact input grammar before preparing a ranking file. This format restriction concerns imported data; the commands and instructions here are in English.

Record `submitted` only after confirming that an application was actually submitted. Importing jobs, classifications, or rankings does not automatically create application records:

```powershell
python job_database/jobdb.py status 900000001 --batch first-export --state submitted --resume resume.pdf --notes "Submitted manually"
```

Available states are `unknown`, `planned`, `submitted`, `interview`, `offer`, `rejected`, `withdrawn`, and `skipped`. The default `unknown` does not mean not submitted. Use `--submitted-at` for a known submission time including its UTC offset. When updating a status, omitted submission times, document paths, and notes are preserved.

## Tests and backups

```powershell
python -m unittest discover -s job_database -p "test_*.py" -v
python job_database/jobdb.py --help
```

Tests use temporary databases and synthetic data. The current schema version is 2; run `init` on an existing v1 database to migrate it. Before backing up, close programs writing to the database and copy the SQLite file. Back up linked resumes and cover letters separately.
