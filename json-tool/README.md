# WaterlooWorks JSON Utilities

Browser-based tools for processing WaterlooWorks JSON exports. Files are processed locally in your browser and are not uploaded.

## Features

- Split an export into smaller files with a chosen number of jobs per file.
- Merge multiple exports in `posting_ids` order and remove duplicate IDs.
- Find and delete jobs by posting ID, title, organization, division, city, raw text, or all job content.
- Remove jobs from a target file when their IDs also appear in a reference file.
- Keep only jobs matching a list of IDs separated by commas, spaces, or line breaks.

## Open the tool

Open `index.html` directly in a browser. No server or installation is required. All interface labels, status messages, and validation errors are in English.

## Split an export

1. In the first section, select a JSON export created by JSON Exporter.
2. Set the number of jobs per output file and review the expected file count.
3. Click the split-and-download button. Allow multiple downloads if your browser prompts you.

Each output file preserves the other top-level properties, limits `jobs` to its own slice, and updates `total_jobs`. It also slices `posting_ids`; if the original list cannot be aligned by position, IDs are rebuilt from each job's `posting_id`.

## Merge exports

Select at least two exports in the merge section, review the input and output counts, and click the merge-and-download button.

Each file's `posting_ids` must align with `jobs` by position. Results follow the selected file order and each file's ID order. When an ID occurs more than once, the first job is kept. Other top-level metadata comes from the first file.

## Delete matching jobs

Select an export, choose the field to search, and enter the search text. Review the matching and remaining counts, then download the filtered file.

Search uses case-insensitive substring matching. The download updates `jobs`, `posting_ids`, and `total_jobs` together and does not overwrite the original file.

## Remove duplicates using a reference file

Select the reference file first and the target file second. Review the duplicate count, then download the cleaned target file.

Only the downloaded target data is changed. Both inputs must have `posting_ids` arrays aligned with `jobs` by position.

## Keep specific IDs

Select an export and enter the IDs to keep, separated by commas, spaces, or line breaks. Review the matched count and download the result.

Matching is exact. Jobs retain their original order, and the tool reports how many requested IDs were not found.

## Development

`splitter-core.js` contains the data-processing functions and has no UI dependencies. The interface handles file reads, user input, and downloads.

## Tests

With Node.js installed, run this command from the `json-tool` directory:

```powershell
node --test splitter-core.test.js
```
