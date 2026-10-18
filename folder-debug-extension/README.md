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

During assignment, a posting returning a non-JSON HTTP 200 response is skipped, including responses reached through a redirect, and the remaining postings continue. This matches the reported behavior of an unavailable posting, but does not by itself prove the posting no longer exists: other HTTP 200 HTML pages are also reported as skipped. The result lists every skipped posting ID separately from successful assignments. Network errors, other HTTP statuses, and JSON failure responses still stop the batch; IDs already skipped are retained in the failure report.

After updating the extension, reload it in `chrome://extensions` and refresh the WaterlooWorks page so the current content script is used.

The remove operation uses the same observed `saveForm` request with an empty `selectedFolder`. It does not delete any folder and does not affect postings absent from the JSON. Errors during removal stop the batch and report how many requests succeeded.

The extension extracts the current `saveForm` action token from the live page. It does not store authentication data or hard-code action tokens.

## Remove applied postings

Open the Full-Cycle WaterlooWorks Jobs page and click **从文件夹移出已申请岗位**. No JSON file is needed. The extension reads all saved posting IDs using `getPostingsInFolders`, checks each with `getPostingData`, and removes only postings whose matching `id` has `applicationData.hasApplication === true`. This scans all folders independently of the visible page or search filters. It uses `saveForm` with an empty `selectedFolder` and never invokes cancellation of an application.

The result lists removed IDs and IDs whose application status could not be confirmed. Unreadable postings are retained. A network/HTTP error during scanning stops before any removals; a removal error stops with the successful removal IDs reported. Refresh the WaterlooWorks page after completion to update the displayed folder counts and rows.

## Clear all classification folders

Click **移出所有分类文件夹中的岗位** on the Full-Cycle Jobs page. No JSON is needed. This reads all posting-to-folder memberships from `getPostingsInFolders` and clears each saved posting using `saveForm` with an empty `selectedFolder`. A posting in multiple folders is processed once. It covers all custom My Jobs folders regardless of the current filters or page, retains the folders themselves, and does not cancel applications or add postings to Removed From Search.

The result lists removed IDs and skipped IDs. HTTP 200 non-JSON responses are skipped as in JSON import; other errors stop with the successful count, skipped IDs, and failed posting ID reported. Refresh the page afterward to see updated folder contents.

## Batch-assignment JSON format

See `example-folder-assignments.json` for the reference format that a job-selection task should produce.

- `folders` is required.
- Each key inside `folders` must exactly match an existing WaterlooWorks folder name.
- Each value is an array of WaterlooWorks posting IDs represented as strings.
- A posting ID may appear only once in the entire file.
- Output valid JSON without comments or Markdown code fences.
