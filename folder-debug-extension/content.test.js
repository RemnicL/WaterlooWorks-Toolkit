const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { normalizeFolderPlan } = require("./folder-plan.js");

async function importWithResponses(responses) {
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
      documentElement: { innerHTML: "saveForm() { action: 'test-action' }" },
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
  const response = await new Promise((resolve) => listener({
    action: "WW_IMPORT_FOLDER_ASSIGNMENTS",
    plan: { folders: { SW: ["490170", "490378", "492430"] } }
  }, {}, resolve));
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
    { text: "<html>Login</html>", redirected: true },
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
