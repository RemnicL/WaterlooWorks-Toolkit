# WaterlooWorks JSON Exporter

Minimal Chrome extension extracted from the larger Enghacks project.

## What it does

- Reads the currently open WaterlooWorks jobs page
- Keeps your current filter selection
- Walks every result page
- Offers `跳过已申请岗位` (off by default) to exclude postings using the search list's applied marker (`check_circle` next to the job title, rendered from `JobTitle.applied`). Ineligible postings remain exportable: their overview response may legitimately omit `hasApplication`. No extra status requests are needed, and excluded jobs are not fetched for further detail. The Job Title column must be visible and loaded so its marker can be read. When every job is excluded, no file is downloaded.
- Exports one JSON file with independently selectable content:
  - Posting ID (always included)
  - Search-result row information (`搜索结果列表信息`): title, organization, division, openings, city, level, applications, deadline, and raw row text
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
4. Select `E:\Projects\WaterlooWorks-JSON-Exporter`

## Use

1. Open WaterlooWorks jobs page
2. Apply your desired filter
3. Open the extension popup
4. Choose which job information to include. Select `Export jobs from the current page only` to skip all other result pages, and `跳过已申请岗位` to omit jobs already applied to by the signed-in user.
5. Click `Download Current Filter as JSON`

## Database import contract

See [JSON export handoff](docs/json-export-contract.md) for the current contract, including the mandatory Posting ID, changes introduced by `157e7f2`, missing/empty-value semantics, and importer considerations. A [JSON Schema](docs/job-export.schema.json) and [synthetic examples](docs/examples/all-sections.json) are included for other processes.

## Tests

Run `node --test options.test.js content_helpers/bootstrapContent.test.js json-tool/splitter-core.test.js folder-debug-extension/content.test.js folder-debug-extension/folder-plan.test.js`.
