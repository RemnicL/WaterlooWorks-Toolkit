# WaterlooWorks Folder Importer

Chrome extension for assigning WaterlooWorks postings to existing folders from a JSON file.

## Load unpacked

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click **Load unpacked**.
4. Select the `folder-debug-extension` directory.
5. Reload an open WaterlooWorks Jobs page if necessary.

## Use

1. Open a WaterlooWorks Jobs result list containing at least one posting.
2. Open the extension and select a JSON file matching `example-folder-assignments.json`.
3. Review the folder and assignment counts.
4. Choose an operation:
   - **读取映射并放入文件夹** resolves every JSON folder name to its current ID and assigns the listed postings.
   - **将所有工作移出当前文件夹** clears the current folder for every posting ID mentioned in the JSON; folder names in the file are ignored for this operation.

Before the assignment operation changes any posting, the extension opens the first visible posting's folder sidebar, reads the current folder-name-to-ID mapping, closes the sidebar, and verifies that every requested folder exists. It then submits each assignment sequentially and reports the completed count.

The remove operation uses the same observed `saveForm` request with an empty `selectedFolder`. It does not delete any folder and does not affect postings absent from the JSON. If either batch operation fails partway through, it stops and reports how many requests succeeded.

The extension extracts the current `saveForm` action token from the live page. It does not store authentication data or hard-code action tokens.

## Batch-assignment JSON format

See `example-folder-assignments.json` for the reference format that a job-selection task should produce.

- `folders` is required.
- Each key inside `folders` must exactly match an existing WaterlooWorks folder name.
- Each value is an array of WaterlooWorks posting IDs represented as strings.
- A posting ID may appear only once in the entire file.
- Output valid JSON without comments or Markdown code fences.
