# WaterlooWorks Toolkit

A collection of tools for exporting WaterlooWorks postings, managing a local SQLite job database, assigning jobs to folders, and splitting, merging, or deduplicating JSON exports.

| Tool | Location | How to use |
| --- | --- | --- |
| JSON Exporter | Repository root | Load the root directory as an unpacked Chrome extension |
| Job database | [job_database](job_database/README.md) | Python command-line tool using only the standard library |
| Folder Importer | [folder-debug-extension](folder-debug-extension/README.md) | Load this directory as a separate Chrome extension |
| JSON utilities | [json-tool](json-tool/README.md) | Open `json-tool/index.html` in a browser |

## End-to-end workflow

1. Use JSON Exporter to download the current WaterlooWorks search results.
2. Run the following commands from the repository root to create a local database and import the postings:

   ```powershell
   python job_database/jobdb.py init
   python job_database/jobdb.py import-jobs jobs.json --name first-export --role all
   python job_database/jobdb.py list --batch first-export
   ```

3. Prepare a classification file such as `{"folders": {"SW": ["900000001"], "HW": ["900000002"]}}`, replacing the example IDs with actual posting IDs. Assign each posting to one folder only, and use names that exactly match existing WaterlooWorks folders. See the [classification example](folder-debug-extension/example-folder-assignments.json). The database can import and export this format:

   ```powershell
   python job_database/jobdb.py import-selection categories.json --name first-selection --batch first-export
   python job_database/jobdb.py export-classification --selection first-selection --output folders.json
   ```

4. Select `folders.json` in Folder Importer and run the assignment.

The database stores and queries records; it does not automatically screen jobs, generate rankings, or submit applications. This repository contains source code, tests, and examples. Actual databases, personal information, real job exports, and personal screening results are not distributed with the tools.

## Validation

Install Node.js and Python 3.10 or later, then run these commands from the repository root:

```powershell
node --test options.test.js content_helpers/bootstrapContent.test.js json-tool/splitter-core.test.js folder-debug-extension/content.test.js folder-debug-extension/folder-plan.test.js
python -m unittest discover -s job_database -p "test_*.py" -v
```

## JSON Exporter

Minimal Chrome extension extracted from the larger Enghacks project.

## What it does

- Reads the currently open WaterlooWorks jobs page
- Keeps your current filter selection
- Walks every result page
- Offers a skip-applied option (`skipAppliedJobs`, off by default) to exclude postings using the search list's applied marker (`check_circle` next to the job title, rendered from `JobTitle.applied`). Ineligible postings remain exportable: their overview response may legitimately omit `hasApplication`. No extra status requests are needed, and excluded jobs are not fetched for further detail. The Job Title column must be visible and loaded so its marker can be read. When every job is excluded, no file is downloaded.
- Exports one JSON file with independently selectable content:
  - Posting ID (always included)
  - Search-result row information (`includeBasicInfo`): applications and selected list fields. Title, organization, division, openings, city, level, and deadline also require their corresponding content checkbox. `raw_text` is rebuilt using only the selected list values and Posting ID.
  - Job posting information: work term, job type, title, openings, level, region, full address, location arrangement, duration, special requirements, summary, responsibilities, skills, compensation and benefits, and targeted degrees and disciplines
  - Application information: deadline, required documents, additional application information, and application method
  - Company information: organization and division
  - Service team (table rows, each exported as an array of cell values)
  - Individual hiring-history fields: `hires_by_faculty`, `hires_by_student_work_term_number`, and `most_frequently_hired_programs`
- Reads each overview field from its own HTML container, including full descriptions and collapsed targeted-program lists
- Restores checkbox selections from local extension storage whenever the popup opens, and saves each change immediately, including the current-page-only and skip-applied options. Storage is not read or written during job collection. Options without saved values retain their original defaults (all content selected; current-page-only and skip-applied off).
- Unchecking an option omits its optional fields from each job. Posting ID is always included, even when every option is unchecked. Selected fields absent from a posting export as empty strings, an empty array for `service_team`, or `null` for hiring history.

## What was removed

- AI resume analysis
- API key storage
- Resume upload
- Dashboard
- Open job by posting ID
- Open apply by posting ID
- Any injected side panel UI

## Load in Chrome

1. Open `chrome://extensions`
2. Turn on `Developer mode`
3. Click `Load unpacked`
4. Select the cloned repository's root directory (the directory containing `manifest.json`).

## Use

1. Open WaterlooWorks jobs page
2. Apply your desired filter
3. Open the extension popup
4. Choose which job information to include. Select `Export jobs from the current page only` to skip all other result pages, and enable the skip-applied option to omit jobs already applied to by the signed-in user.
5. Click `Download Current Filter as JSON`

## Database import contract

See [JSON export handoff](docs/json-export-contract.md) for the current contract, including the mandatory Posting ID, changes introduced by `157e7f2`, missing/empty-value semantics, and importer considerations. A [JSON Schema](docs/job-export.schema.json) and [synthetic examples](docs/examples/all-sections.json) are included for other processes.
