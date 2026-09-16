# WaterlooWorks JSON Exporter

Minimal Chrome extension extracted from the larger Enghacks project.

## What it does

- Reads the currently open WaterlooWorks jobs page
- Keeps your current filter selection
- Walks every result page
- Exports one JSON file with:
  - basic job row fields
- `work_term_duration`
- `special_job_requirements`
- `required_skills`
- `job_responsibilities`
- `job_summary`
- individual hiring-history fields: `hires_by_faculty`, `hires_by_student_work_term_number`, and `most_frequently_hired_programs`

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
4. Choose which job information to include. Select `Export jobs from the current page only` to skip all other result pages.
5. Click `Download Current Filter as JSON`
