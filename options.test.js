const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

function openPopup(stored = {}, storageOverrides = {}, response = { success: true, jobs: [{ posting_id: "123" }], postingIds: ["123"] }) {
  const elements = [];
  const requests = [];
  const storageCalls = { get: 0, set: [] };
  let initialize;
  let downloadedBlob;
  class Element {
    constructor() {
      this.listeners = {};
      this.style = {};
      this.classList = { toggle() {} };
      elements.push(this);
    }
    append() {}
    addEventListener(event, listener) { this.listeners[event] = listener; }
    async fire(event) { await this.listeners[event]?.(); }
  }
  const add = (id, checked = false) => Object.assign(new Element(), { id, checked, disabled: true });
  const button = add("exportJobsBtn");
  button.textContent = "Download Current Filter as JSON";
  add("exportStatus");
  add("sectionExportOptions");
  add("includeBasicInfo", true);
  add("includeCurrentPageOnly", false);
  add("skipAppliedJobs", false);
  const context = vm.createContext({
    document: {
      addEventListener: (_event, listener) => { initialize = listener; },
      getElementById: (id) => elements.find((element) => element.id === id),
      createElement: () => new Element()
    },
    chrome: {
      storage: { local: {
        get: async (keys) => {
          storageCalls.get += 1;
          return Object.fromEntries(keys.filter((key) => key in stored).map((key) => [key, stored[key]]));
        },
        set: async (values) => {
          storageCalls.set.push(JSON.parse(JSON.stringify(values)));
          Object.assign(stored, values);
        },
        ...storageOverrides
      } },
      tabs: {
        query: async () => [{ id: 1, url: "https://waterlooworks.uwaterloo.ca/myAccount/co-op/full/jobs.htm" }],
        update: async () => {},
        get: async () => ({ status: "complete" }),
        sendMessage: async (_id, message) => {
          requests.push(JSON.parse(JSON.stringify(message)));
          return response;
        }
      },
      downloads: { download: async () => 1 }
    },
    Blob,
    URL: { createObjectURL: (blob) => { downloadedBlob = blob; return "blob:test"; }, revokeObjectURL() {} }
  });
  for (const file of ["export-fields.js", "options.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, file), "utf8"), context);
  }
  const ready = initialize();
  return { ready, input: (id) => elements.find((element) => element.id === id),
    requests, storageCalls, blob: () => downloadedBlob };
}

test("saved false values and current-page scope are restored; unsaved choices keep their defaults", async () => {
  const popup = openPopup({ includeBasicInfo: false, includeLevel: false, includeCurrentPageOnly: true });
  await popup.ready;
  assert.equal(popup.input("includeBasicInfo").checked, false);
  assert.equal(popup.input("includeLevel").checked, false);
  assert.equal(popup.input("includeCurrentPageOnly").checked, true);
  assert.equal(popup.input("includeJobSummary").checked, true);
  assert.equal(popup.input("exportJobsBtn").disabled, false);
  assert.equal(popup.storageCalls.get, 1);
  assert.equal(popup.storageCalls.set.length, 0);
});

test("controls stay disabled until saved choices have been read", async () => {
  let finishRead;
  const popup = openPopup({}, { get: () => new Promise((resolve) => { finishRead = resolve; }) });
  assert.equal(popup.input("exportJobsBtn").disabled, true);
  assert.equal(popup.input("includeBasicInfo").disabled, true);
  assert.equal(popup.input("includeJobSummary").disabled, true);
  finishRead({ includeJobSummary: false });
  await popup.ready;
  assert.equal(popup.input("includeJobSummary").disabled, false);
  assert.equal(popup.input("includeJobSummary").checked, false);
});

test("checkbox changes persist individually and survive reopening without exporting", async () => {
  const stored = {};
  const popup = openPopup(stored);
  await popup.ready;
  for (const id of ["includeBasicInfo", "includeCompensationBenefits", "includeServiceTeam"]) {
    popup.input(id).checked = false;
    await popup.input(id).fire("change");
  }
  popup.input("includeCurrentPageOnly").checked = true;
  await popup.input("includeCurrentPageOnly").fire("change");
  assert.equal(popup.requests.length, 0);
  assert.deepEqual(popup.storageCalls.set, [
    { includeBasicInfo: false }, { includeCompensationBenefits: false },
    { includeServiceTeam: false }, { includeCurrentPageOnly: true }
  ]);
  const reopened = openPopup(stored);
  await reopened.ready;
  assert.equal(reopened.input("includeBasicInfo").checked, false);
  assert.equal(reopened.input("includeCompensationBenefits").checked, false);
  assert.equal(reopened.input("includeServiceTeam").checked, false);
  assert.equal(reopened.input("includeCurrentPageOnly").checked, true);
});

test("export uses restored selections without any further storage reads or writes", async () => {
  const popup = openPopup({ includeBasicInfo: false, includeRegion: false });
  await popup.ready;
  await popup.input("exportJobsBtn").fire("click");
  assert.equal(popup.requests[0].exportOptions.includeBasicInfo, false);
  assert.equal(popup.requests[0].exportOptions.includeRegion, false);
  assert.equal(popup.storageCalls.get, 1);
  assert.equal(popup.storageCalls.set.length, 0);
  assert.deepEqual(JSON.parse(await popup.blob().text()), {
    total_jobs: 1, posting_ids: ["123"], jobs: [{ posting_id: "123" }]
  });
});

test("skip-applied is opt-in, persists across popup opens, and is sent to the exporter", async () => {
  const stored = {};
  const popup = openPopup(stored);
  await popup.ready;
  assert.equal(popup.input("skipAppliedJobs").checked, false);
  popup.input("skipAppliedJobs").checked = true;
  await popup.input("skipAppliedJobs").fire("change");
  const reopened = openPopup(stored);
  await reopened.ready;
  assert.equal(reopened.input("skipAppliedJobs").checked, true);
  await reopened.input("exportJobsBtn").fire("click");
  assert.equal(reopened.requests[0].exportOptions.skipAppliedJobs, true);
});

test("filtering out every job or failing to read status produces a message without a download", async () => {
  for (const [response, expected] of [
    [{ success: true, jobs: [], postingIds: [] }, /No unapplied jobs remain/],
    [{ success: false, error: "Could not determine application status for posting 123. Export stopped." }, /application status/]
  ]) {
    const popup = openPopup({ skipAppliedJobs: true }, {}, response);
    await popup.ready;
    await popup.input("exportJobsBtn").fire("click");
    assert.match(popup.input("exportStatus").textContent, expected);
    assert.equal(popup.blob(), undefined);
    assert.equal(popup.input("exportJobsBtn").disabled, false);
  }
});

test("storage errors are visible and leave the current popup usable", async () => {
  const popup = openPopup({}, {
    get: async () => { throw new Error("read denied"); },
    set: async () => { throw new Error("write denied"); }
  });
  await popup.ready;
  assert.match(popup.input("exportStatus").textContent, /read denied/);
  assert.equal(popup.input("exportJobsBtn").disabled, false);
  popup.input("includeRegion").checked = false;
  await popup.input("includeRegion").fire("change");
  assert.match(popup.input("exportStatus").textContent, /write denied/);
  assert.equal(popup.input("includeRegion").checked, false);
});

test("popup names the search-result fields explicitly and declares the storage permission", () => {
  const html = fs.readFileSync(path.join(__dirname, "options.html"), "utf8");
  assert.ok(html.includes("Search-result list information"));
  assert.ok(!html.includes("Basic job information"));
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "manifest.json"), "utf8"));
  assert.ok(manifest.permissions.includes("storage"));
});
