const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { normalizeFolderPlan } = require("./folder-plan.js");

async function importWithResponses(responses, action = "WW_IMPORT_FOLDER_ASSIGNMENTS") {
  const requests = [];
  let listener;
  let panelOpen = false;
  const viewer = {
    offsetWidth: 100,
    querySelectorAll: () => [{
      id: "49626",
      checked: false,
      closest: () => ({ querySelector: () => ({ textContent: "SW" }) })
    }],
    closest: () => ({ querySelector: () => ({ click: () => { panelOpen = false; } }) })
  };
  const folderButton = {
    offsetWidth: 100,
    getAttribute: () => "Save to My Jobs Folder",
    click: () => { panelOpen = true; }
  };
  const context = vm.createContext({
    WWFolderPlan: { normalizeFolderPlan },
    chrome: { runtime: { onMessage: { addListener: (value) => { listener = value; } } } },
    document: {
      documentElement: { innerHTML: [
        "saveForm() { action: 'test-action' }",
        "getPostingsInFolders() { action: 'folder-action' }",
        "getPostingData() { action: 'posting-action' }"
      ].join("\n") },
      scripts: [],
      body: {},
      querySelectorAll: (selector) => selector === ".doc-viewer"
        ? (panelOpen ? [viewer] : [])
        : [folderButton]
    },
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout,
    clearTimeout,
    URLSearchParams,
    console: { group() {}, table() {}, groupEnd() {} },
    fetch: async (_url, options) => {
      requests.push(Object.fromEntries(new URLSearchParams(options.body)));
      const response = responses[requests.length - 1];
      if (response instanceof Error) throw response;
      const status = response.status ?? 200;
      return {
        status,
        ok: status >= 200 && status < 300,
        redirected: response.redirected ?? false,
        text: async () => response.text
      };
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "content.js"), "utf8"), context);
  const message = { action };
  if (action === "WW_IMPORT_FOLDER_ASSIGNMENTS") {
    message.plan = { folders: { SW: ["490170", "490378", "492430"] } };
  }
  const response = await new Promise((resolve) => listener(message, {}, resolve));
  return { response, requests };
}

test("continues after an unavailable posting's HTTP 200 non-JSON response", async () => {
  const { response, requests } = await importWithResponses([
    { text: '{"success":true}' },
    { text: "<html>Posting unavailable</html>" },
    { text: '{"success":true}' }
  ]);
  assert.equal(response.success, true);
  assert.equal(response.completedAssignments, 2);
  assert.equal(response.totalAssignments, 3);
  assert.deepEqual(Array.from(response.skippedPostingIds), ["490378"]);
  assert.deepEqual(requests.map((request) => request.postingIds), ["490170", "490378", "492430"]);
  assert.ok(requests.every((request) => request.selectedFolder === "49626"));
});

test("continues when an unavailable posting redirects to an HTTP 200 HTML page", async () => {
  const { response, requests } = await importWithResponses([
    { text: '{"success":true}' },
    { text: "<html>Posting unavailable</html>", redirected: true },
    { text: '{"success":true}' }
  ]);
  assert.equal(response.success, true);
  assert.equal(response.completedAssignments, 2);
  assert.deepEqual(Array.from(response.skippedPostingIds), ["490378"]);
  assert.equal(requests.length, 3);
});

test("stops on HTTP errors and retains IDs already skipped", async () => {
  const { response, requests } = await importWithResponses([
    { text: "<html>Posting unavailable</html>" },
    { status: 500, text: "<html>Server error</html>" },
    { text: '{"success":true}' }
  ]);
  assert.equal(response.success, false);
  assert.equal(response.completedAssignments, 0);
  assert.deepEqual(Array.from(response.skippedPostingIds), ["490170"]);
  assert.equal(requests.length, 2);
});

test("does not skip JSON failures or network failures", async () => {
  for (const failure of [
    { text: '{"success":false}' },
    { status: 401, text: "<html>Login required</html>" },
    new Error("Network unavailable")
  ]) {
    const { response, requests } = await importWithResponses([
      { text: '{"success":true}' },
      failure,
      { text: '{"success":true}' }
    ]);
    assert.equal(response.success, false);
    assert.equal(response.completedAssignments, 1);
    assert.equal(requests.length, 2);
  }
});

test("returns an empty skipped list when every posting succeeds", async () => {
  const { response } = await importWithResponses([
    { text: '{"success":true}' },
    { text: '{"success":true}' },
    { text: '{"success":true}' }
  ]);
  assert.equal(response.success, true);
  assert.equal(response.completedAssignments, 3);
  assert.deepEqual(Array.from(response.skippedPostingIds), []);
});

function jsonResponse(value) {
  return { text: JSON.stringify(value) };
}

function postingResponse(id, hasApplication) {
  return jsonResponse({ id, applicationData: { hasApplication } });
}

test("cleanup removes only applied postings across all folders without a JSON plan", async () => {
  const { response, requests } = await importWithResponses([
    jsonResponse({ "490170": [1], "490378": [2], "492430": [], "499999": [2, 3] }),
    postingResponse("490170", true),
    postingResponse("490378", false),
    postingResponse("499999", true),
    jsonResponse({ success: true }),
    jsonResponse({ success: true })
  ], "WW_REMOVE_APPLIED_POSTINGS");

  assert.equal(response.success, true);
  assert.equal(response.totalFolderPostings, 3);
  assert.equal(response.totalAssignments, 2);
  assert.deepEqual(Array.from(response.removedPostingIds), ["490170", "499999"]);
  const removals = requests.filter((request) => request.action === "test-action");
  assert.deepEqual(removals.map((request) => request.postingIds), ["490170", "499999"]);
  assert.ok(removals.every((request) => request.selectedFolder === "" && request.blacklist === "false"));
  assert.deepEqual(requests.map((request) => request.action), [
    "folder-action", "posting-action", "posting-action", "posting-action", "test-action", "test-action"
  ]);
});

test("cleanup keeps postings whose application status cannot be established", async () => {
  const { response, requests } = await importWithResponses([
    jsonResponse({ "490170": [1], "490378": [2], "492430": [3], "499999": [1] }),
    { text: "<html>Posting unavailable</html>" },
    jsonResponse({ id: "490378" }),
    postingResponse("wrong-id", true),
    postingResponse("499999", "true")
  ], "WW_REMOVE_APPLIED_POSTINGS");

  assert.equal(response.success, true);
  assert.equal(response.completedAssignments, 0);
  assert.deepEqual(Array.from(response.uncheckedPostingIds), ["490170", "490378", "492430", "499999"]);
  assert.equal(requests.filter((request) => request.action === "test-action").length, 0);
});

test("cleanup performs no removals when scanning encounters a network error", async () => {
  const { response, requests } = await importWithResponses([
    jsonResponse({ "490170": [1], "490378": [2] }),
    postingResponse("490170", true),
    new Error("Network unavailable")
  ], "WW_REMOVE_APPLIED_POSTINGS");

  assert.equal(response.success, false);
  assert.equal(response.completedAssignments, 0);
  assert.match(response.error, /Network unavailable/);
  assert.equal(requests.filter((request) => request.action === "test-action").length, 0);
});

test("cleanup reports successful removals if a later save fails", async () => {
  const { response, requests } = await importWithResponses([
    jsonResponse({ "490170": [1], "490378": [2] }),
    postingResponse("490170", true),
    postingResponse("490378", true),
    jsonResponse({ success: true }),
    jsonResponse({ success: false })
  ], "WW_REMOVE_APPLIED_POSTINGS");

  assert.equal(response.success, false);
  assert.equal(response.completedAssignments, 1);
  assert.equal(response.totalAssignments, 2);
  assert.deepEqual(Array.from(response.removedPostingIds), ["490170"]);
  assert.equal(requests.length, 5);
});

test("cleanup handles empty folders and rejects malformed folder lists without writes", async () => {
  for (const folderMap of [{}, []]) {
    const { response, requests } = await importWithResponses([
      jsonResponse(folderMap)
    ], "WW_REMOVE_APPLIED_POSTINGS");
    assert.equal(response.success, !Array.isArray(folderMap));
    assert.equal(response.completedAssignments, 0);
    assert.equal(requests.length, 1);
  }
});

test("clear-all removes each saved posting once across every folder without a JSON plan", async () => {
  const { response, requests } = await importWithResponses([
    jsonResponse({ "490170": [1], "490378": [2, 3], "492430": [] }),
    jsonResponse({ success: true }),
    jsonResponse({ success: true })
  ], "WW_CLEAR_ALL_FOLDER_POSTINGS");

  assert.equal(response.success, true);
  assert.equal(response.totalAssignments, 2);
  assert.equal(response.completedAssignments, 2);
  assert.deepEqual(Array.from(response.removedPostingIds), ["490170", "490378"]);
  assert.deepEqual(requests.map((request) => request.action), ["folder-action", "test-action", "test-action"]);
  assert.deepEqual(requests.slice(1).map((request) => request.postingIds), ["490170", "490378"]);
  assert.ok(requests.slice(1).every((request) => request.selectedFolder === "" && request.blacklist === "false"));
});

test("clear-all skips unavailable responses and continues with the remaining postings", async () => {
  const { response, requests } = await importWithResponses([
    jsonResponse({ "490170": [1], "490378": [2], "492430": [3] }),
    jsonResponse({ success: true }),
    { text: "<html>Posting unavailable</html>", redirected: true },
    jsonResponse({ success: true })
  ], "WW_CLEAR_ALL_FOLDER_POSTINGS");

  assert.equal(response.success, true);
  assert.equal(response.completedAssignments, 2);
  assert.deepEqual(Array.from(response.skippedPostingIds), ["490378"]);
  assert.deepEqual(Array.from(response.removedPostingIds), ["490170", "492430"]);
  assert.equal(requests.length, 4);
});

test("clear-all reports partial results and the failed ID on a server error", async () => {
  const { response, requests } = await importWithResponses([
    jsonResponse({ "490170": [1], "490378": [2], "492430": [3], "499999": [3] }),
    jsonResponse({ success: true }),
    { text: "<html>Posting unavailable</html>" },
    { status: 500, text: "<html>Server error</html>" }
  ], "WW_CLEAR_ALL_FOLDER_POSTINGS");

  assert.equal(response.success, false);
  assert.equal(response.completedAssignments, 1);
  assert.equal(response.totalAssignments, 4);
  assert.deepEqual(Array.from(response.removedPostingIds), ["490170"]);
  assert.deepEqual(Array.from(response.skippedPostingIds), ["490378"]);
  assert.equal(response.failedPostingId, "492430");
  assert.equal(requests.length, 4);
});

test("clear-all handles empty folders and rejects invalid responses before writes", async () => {
  for (const folderMap of [{}, [], { invalid: [1] }, { "490170": "invalid" }]) {
    const { response, requests } = await importWithResponses([
      jsonResponse(folderMap)
    ], "WW_CLEAR_ALL_FOLDER_POSTINGS");
    assert.equal(response.success, !Array.isArray(folderMap) && Object.keys(folderMap).length === 0);
    assert.equal(response.completedAssignments, 0);
    assert.equal(requests.length, 1);
  }
});
