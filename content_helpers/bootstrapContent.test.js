const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

function loadHelpers(globals = {}) {
  const context = vm.createContext(globals);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../export-fields.js"), "utf8"), context);
  const source = fs.readFileSync(path.join(__dirname, "bootstrapContent.js"), "utf8")
    .replace("  chrome.runtime.onMessage.addListener", `
      globalThis.helpers = { selectExportFields, getExtraFieldsFromOverviewHtml, exportFilteredJobs };
      return;
      chrome.runtime.onMessage.addListener`);
  vm.runInContext(`${source}\nbootstrapContentScript();`, context);
  return context;
}

test("each section option exports its own field alongside the mandatory posting ID", () => {
  const { helpers, WWExportFields: fields } = loadHelpers();
  const job = { posting_id: "123", title: "Test role", hiring_history: {} };
  for (const { field, group } of fields) {
    if (group === "Hiring history") job.hiring_history[field] = { rows: [[field, 10]] };
    else job[field] = field === "service_team" ? [["EEM", "Test contact"]] : `Value for ${field}`;
  }
  for (const { option, field, group } of fields) {
    const [result] = helpers.selectExportFields([job], { [option]: true });
    assert.deepEqual(Object.keys(result), ["posting_id", field], option);
    assert.equal(result.posting_id, "123");
    assert.equal(result[field], group === "Hiring history" ? job.hiring_history[field] : job[field]);
  }
});

function prepareExport(responses, { history = false, postingToken = true, overviewToken = true, ids = Object.keys(responses), appliedIds = [], titleReady = true } = {}) {
  const requests = [];
  const rows = ids.map((id) => ({
    querySelector: (selector) => selector.includes("dataViewerSelection") ? { value: id } : null,
    querySelectorAll: () => [{
      innerText: `Job ${id}`,
      querySelector: () => titleReady ? {
        parentElement: { querySelectorAll: () => appliedIds.includes(id) ? [{ textContent: "check_circle" }] : [] }
      } : null
    }]
  }));
  const table = { querySelectorAll: (selector) => selector === "thead th"
    ? [{ innerText: "ID" }, { innerText: "Job Title" }] : rows };
  const { helpers } = loadHelpers({
    URLSearchParams,
    setTimeout: (resolve) => resolve(),
    document: {
      documentElement: { innerHTML: [
        overviewToken ? "getPostingOverview() { action: 'overview' }" : "",
        postingToken ? "getPostingData() { action: 'posting' }" : "",
        "getWorkTermRatingReportJson() { action: 'report' }"
      ].join("\n") },
      scripts: [],
      querySelector: (selector) => selector.includes("table.data-viewer-table") ? table : null,
      querySelectorAll: () => []
    },
    fetch: async (_url, options) => {
      const request = Object.fromEntries(new URLSearchParams(options.body));
      requests.push(request);
      const data = responses[request.postingId];
      if (request.action === "posting" && data instanceof Error) throw data;
      return {
        ok: data?.httpError !== true,
        text: async () => "",
        json: async () => {
          if (data?.invalidJson) throw new Error("not JSON");
          return request.action === "report" ? { sections: [] } : data;
        }
      };
    }
  });
  return {
    requests,
    run: (skipAppliedJobs = true) => helpers.exportFilteredJobs({
      includeCurrentPageOnly: true, includeHiresByFaculty: history, skipAppliedJobs
    })
  };
}

test("skip-applied filters jobs and posting IDs, without fetching details of applied jobs", async () => {
  const fixture = prepareExport({
    "123": { id: "123", applicationData: { hasApplication: true } },
    "456": { id: "456", applicationData: { hasApplication: false } }
  }, { appliedIds: ["123"] });
  const result = await fixture.run();
  assert.deepEqual(Array.from(result.jobs, (job) => job.posting_id), ["456"]);
  assert.deepEqual(Array.from(result.postingIds), ["456"]);
  assert.deepEqual(fixture.requests.filter((request) => request.action === "overview").map((request) => request.postingId), ["456"]);
  assert.equal("has_applied" in result.jobs[0], false);
  assert.equal("has_application" in result.jobs[0], false);
});

test("turning skip-applied off keeps every job and adds no status requests", async () => {
  const fixture = prepareExport({
    "123": { id: "123", applicationData: { hasApplication: true } },
    "456": { id: "456", applicationData: { hasApplication: false } }
  });
  const result = await fixture.run(false);
  assert.deepEqual(Array.from(result.postingIds), ["123", "456"]);
  assert.equal(result.jobs.length, 2);
  assert.equal(fixture.requests.filter((request) => request.action === "posting").length, 0);
});

test("skip-applied only requests hiring data for retained jobs", async () => {
  const fixture = prepareExport({
    "123": { id: "123", applicationData: { hasApplication: true }, divId: "company" },
    "456": { id: "456", applicationData: { hasApplication: false }, divId: "company" }
  }, { history: true, appliedIds: ["123"] });
  const result = await fixture.run();
  assert.equal(result.jobs.length, 1);
  assert.equal(fixture.requests.filter((request) => request.action === "posting").length, 1);
  assert.equal(fixture.requests.filter((request) => request.action === "report").length, 1);
});

test("skip-applied also works without an overview token and returns empty results when all have applied", async () => {
  const fixture = prepareExport({
    "123": { id: "123", applicationData: { hasApplication: true } }
  }, { overviewToken: false, appliedIds: ["123"] });
  const result = await fixture.run();
  assert.equal(result.jobs.length, 0);
  assert.equal(result.postingIds.length, 0);
  assert.equal(fixture.requests.length, 0);
});

test("493499's valid ineligible response does not interrupt export or exclude the unapplied job", async () => {
  const restricted = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/restricted-posting.json"), "utf8"));
  const fixture = prepareExport({
    "493499": restricted,
    "489570": { id: 489570, applicationData: { hasApplication: true } }
  }, { history: true, appliedIds: ["489570"] });
  const result = await fixture.run();
  assert.deepEqual(Array.from(result.postingIds), ["493499"]);
  assert.deepEqual(Array.from(result.jobs, (job) => job.posting_id), ["493499"]);
  assert.equal(fixture.requests.filter((request) => request.action === "posting").length, 1);
});

test("skip-applied works without a posting-data action when hiring history is off", async () => {
  const fixture = prepareExport({ "493499": {} }, { postingToken: false });
  const result = await fixture.run();
  assert.deepEqual(Array.from(result.postingIds), ["493499"]);
  assert.equal(fixture.requests.filter((request) => request.action === "posting").length, 0);
});

test("skip-applied stops if the title's application marker cannot be read", async () => {
  await assert.rejects(prepareExport({ "123": {} }, { titleReady: false }).run(), /application status/i);
  await assert.rejects(prepareExport({ "": {} }).run(), /posting ID/i);
});

test("unchecking every option retains only the posting ID", () => {
  const { helpers } = loadHelpers();
  const [result] = helpers.selectExportFields([{ posting_id: "123", work_term_duration: "4 months" }], {});
  assert.deepEqual(Object.keys(result), ["posting_id"]);
  assert.equal(result.posting_id, "123");
  const [missingId] = helpers.selectExportFields([{}], {});
  assert.equal(JSON.stringify(missingId), '{"posting_id":""}');
});

test("basic row information remains separate from detail sections", () => {
  const { helpers } = loadHelpers();
  const [result] = helpers.selectExportFields([{
    posting_id: "123", title: "Test role", work_term_duration: "4 months", compensation_and_benefits: "$25/hour"
  }], { includeBasicInfo: true });
  assert.equal(result.posting_id, "123");
  assert.equal(result.title, "Test role");
  assert.ok(!("work_term_duration" in result));
  assert.ok(!("compensation_and_benefits" in result));
});

test("selected but absent sections have explicit empty values", () => {
  const { helpers, WWExportFields: fields } = loadHelpers();
  const options = Object.fromEntries(fields.map(({ option }) => [option, true]));
  const [result] = helpers.selectExportFields([{}], options);
  for (const { field, group } of fields) {
    if (field === "service_team") assert.equal(result[field].length, 0);
    else assert.equal(result[field], group === "Hiring history" ? null : "", field);
  }
  assert.equal(Object.keys(helpers.getExtraFieldsFromOverviewHtml("")).length,
    fields.filter(({ group }) => group !== "Hiring history").length);
});

test("overview containers keep complete text, hidden programs, and service rows without leaking labels or controls", () => {
  const text = (value) => ({ nodeType: 3, textContent: value });
  const element = (tagName, ...childNodes) => ({
    nodeType: 1, tagName, childNodes,
    get textContent() { return this.childNodes.map((node) => node.textContent).join(""); }
  });
  const question = (name, ...contents) => {
    const label = element("SPAN", text(name));
    return { childNodes: [label, ...contents], querySelector: () => label };
  };
  const longText = "Full responsibility. ".repeat(200);
  const questions = [
    question("Job Responsibilities:", element("P", text(longText)),
      text("Tasks"), element("UL", element("LI", text("First")), element("LI", text("Last")))),
    question("Required Skills:", element("P", text("Next field"))),
    question("Targeted Degrees and Disciplines:", element("BUTTON", text("View programs")),
      element("UL", element("LI", text("Computer Science")), element("LI", text("Engineering")))),
    question("Application Deadline", element("P", text("Oct 21, 2026 9:00 AM")))
  ];
  const cells = [element("TD", text("EEM")), element("TD", text("Example contact"))];
  const panel = {
    querySelector: () => element("H4", text("SERVICE TEAM")),
    querySelectorAll: () => [{ querySelectorAll: () => cells }]
  };
  const { helpers } = loadHelpers({ DOMParser: class {
    parseFromString() {
      return { querySelectorAll: (selector) => selector === ".panel" ? [panel] : questions };
    }
  } });
  const parsed = helpers.getExtraFieldsFromOverviewHtml("overview fixture");
  assert.equal(parsed.job_responsibilities, `${longText.trim()} Tasks First Last`);
  assert.equal(parsed.required_skills, "Next field");
  assert.equal(parsed.targeted_degrees_and_disciplines, "Computer Science Engineering");
  assert.equal(parsed.application_deadline, "Oct 21, 2026 9:00 AM");
  assert.equal(JSON.stringify(parsed.service_team), '[["EEM","Example contact"]]');
});

test("option and output names are unique and all actual overview groups are covered", () => {
  const { WWExportFields: fields } = loadHelpers();
  assert.equal(new Set(fields.map(({ option }) => option)).size, fields.length);
  assert.equal(new Set(fields.map(({ field }) => field)).size, fields.length);
  assert.deepEqual([...new Set(Array.from(fields, ({ group }) => group))], [
    "Job posting information", "Application information", "Company information", "Service team", "Hiring history"
  ]);
});

test("every script injection path loads the shared option definitions first", () => {
  const root = path.join(__dirname, "..");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  assert.deepEqual(manifest.content_scripts[0].js,
    ["export-fields.js", "content_helpers/bootstrapContent.js", "content.js"]);
  const popup = fs.readFileSync(path.join(root, "options.html"), "utf8");
  assert.ok(popup.indexOf('src="export-fields.js"') < popup.indexOf('src="options.js"'));
  const options = fs.readFileSync(path.join(root, "options.js"), "utf8");
  assert.ok(options.includes('files: ["export-fields.js", "content_helpers/bootstrapContent.js", "content.js"]'));
});

test("database handoff schema and examples match the actual export projection", () => {
  const { helpers, WWExportFields: fields } = loadHelpers();
  const root = path.join(__dirname, "..");
  const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
  const schema = readJson("docs/job-export.schema.json");
  const properties = schema.$defs.job.properties;
  assert.deepEqual(schema.$defs.job.required, ["posting_id"]);
  assert.equal(properties.posting_id["x-always-exported"], true);
  assert.ok(!("x-export-option" in properties.posting_id));
  const full = readJson("docs/examples/all-sections.json");
  const partial = readJson("docs/examples/selected-sections.json");
  const source = { ...full.jobs[0], hiring_history: {} };
  for (const { field, group } of fields) {
    if (group === "Hiring history") source.hiring_history[field] = source[field];
  }
  const options = { includeBasicInfo: true, ...Object.fromEntries(fields.map(({ option }) => [option, true])) };
  const [exported] = helpers.selectExportFields([source], options);
  assert.deepEqual(Object.keys(properties).sort(), Object.keys(exported).sort());
  assert.equal(Object.keys(properties).length, 40);
  assert.equal(Object.values(properties).filter((property) => property["x-change"] === "added").length, 22);
  for (const { field, option, group } of fields) {
    assert.equal(properties[field]["x-export-option"], option, field);
    assert.equal(properties[field].$ref ?? properties[field].type,
      group === "Hiring history" ? "#/$defs/hiringHistory" : field === "service_team" ? "#/$defs/serviceTeam" : "string", field);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(exported)), full.jobs[0]);
  const [selected] = helpers.selectExportFields([source], {
    includeBasicInfo: true, includeJobSummary: true, includeServiceTeam: true
  });
  assert.deepEqual(JSON.parse(JSON.stringify(selected)), partial.jobs[0]);
  const idOnly = readJson("docs/examples/id-only.json");
  assert.deepEqual(JSON.parse(JSON.stringify(helpers.selectExportFields([source], {})[0])), idOnly.jobs[0]);
  for (const example of [full, partial]) {
    assert.equal(example.total_jobs, example.jobs.length);
    assert.deepEqual(example.posting_ids, example.jobs.map((job) => job.posting_id));
  }
});
