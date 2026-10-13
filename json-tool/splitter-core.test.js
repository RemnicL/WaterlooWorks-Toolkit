const test = require("node:test");
const assert = require("node:assert/strict");
const {
  splitExportData,
  mergeExportData,
  deleteMatchingJobs,
  removeJobsFoundInReference,
  validateExport,
  partFilename
} = require("./splitter-core.js");

test("splits jobs and aligned posting IDs while preserving metadata", () => {
  const input = {
    source: "test",
    total_jobs: 5,
    posting_ids: [101, 102, 103, 104, 105],
    jobs: [101, 102, 103, 104, 105].map((posting_id) => ({ posting_id }))
  };

  const parts = splitExportData(input, 2);

  assert.equal(parts.length, 3);
  assert.deepEqual(parts.map((part) => part.total_jobs), [2, 2, 1]);
  assert.deepEqual(parts.map((part) => part.posting_ids), [[101, 102], [103, 104], [105]]);
  assert.equal(parts[0].source, "test");
  assert.equal(input.total_jobs, 5);
});

test("derives posting IDs from jobs when the source list is absent", () => {
  const parts = splitExportData({ jobs: [{ posting_id: "a" }, { posting_id: "b" }] }, 1);
  assert.deepEqual(parts.map((part) => part.posting_ids), [["a"], ["b"]]);
});

test("rejects unsupported data and invalid chunk sizes", () => {
  assert.throws(() => validateExport([]), /顶层必须是对象/);
  assert.throws(() => splitExportData({ jobs: [] }, 0), /大于 0 的整数/);
  assert.throws(() => splitExportData({ jobs: [] }, 1.5), /大于 0 的整数/);
});

test("creates stable numbered filenames", () => {
  assert.equal(partFilename("jobs.JSON", 0, 12), "jobs_part_01_of_12.json");
});

test("merges by posting ID order and keeps the first duplicate", () => {
  const first = {
    source: "first",
    total_jobs: 2,
    posting_ids: [101, 102],
    jobs: [{ title: "A" }, { title: "B" }]
  };
  const second = {
    source: "second",
    total_jobs: 2,
    posting_ids: [102, 103],
    jobs: [{ title: "changed B" }, { title: "C" }]
  };

  const result = mergeExportData([first, second]);

  assert.deepEqual(result.data.posting_ids, [101, 102, 103]);
  assert.deepEqual(result.data.jobs.map((job) => job.title), ["A", "B", "C"]);
  assert.equal(result.data.total_jobs, 3);
  assert.equal(result.data.source, "first");
  assert.equal(result.duplicateCount, 1);
});

test("rejects files whose ID list cannot be aligned with jobs", () => {
  assert.throws(
    () => mergeExportData([
      { posting_ids: [1], jobs: [{}, {}] },
      { posting_ids: [2], jobs: [{}] }
    ]),
    /数量不一致/
  );
});

test("deletes case-insensitive text matches and keeps IDs aligned", () => {
  const input = {
    source: "test",
    total_jobs: 3,
    posting_ids: [101, 102, 103],
    jobs: [
      { title: "Developer", city: "Toronto" },
      { title: "Designer", city: "Waterloo" },
      { title: "Developer", city: "Vancouver" }
    ]
  };

  const result = deleteMatchingJobs(input, "title", "developer");

  assert.equal(result.deletedCount, 2);
  assert.equal(result.data.total_jobs, 1);
  assert.deepEqual(result.data.posting_ids, [102]);
  assert.deepEqual(result.data.jobs, [{ title: "Designer", city: "Waterloo" }]);
  assert.equal(result.data.source, "test");
});

test("searches nested job content and posting IDs when using all fields", () => {
  const input = {
    posting_ids: [101, 202],
    jobs: [
      { title: "Developer", details: { skills: ["JavaScript"] } },
      { title: "Designer", details: { skills: ["Figma"] } }
    ]
  };

  assert.equal(deleteMatchingJobs(input, "all", "javascript").deletedCount, 1);
  assert.equal(deleteMatchingJobs(input, "all", "202").deletedCount, 1);
});

test("rejects empty searches and unaligned ID lists during deletion", () => {
  assert.throws(() => deleteMatchingJobs({ jobs: [] }, "all", "  "), /请输入/);
  assert.throws(
    () => deleteMatchingJobs({ posting_ids: [1], jobs: [{}, {}] }, "all", "x"),
    /数量不一致/
  );
});

test("removes target jobs whose IDs exist in a reference file", () => {
  const reference = {
    posting_ids: [101, "102"],
    jobs: [{ title: "Old A" }, { title: "Old B" }]
  };
  const target = {
    source: "target",
    total_jobs: 3,
    posting_ids: [102, 103, 104],
    jobs: [{ title: "New B" }, { title: "C" }, { title: "D" }]
  };

  const result = removeJobsFoundInReference(reference, target);

  assert.equal(result.duplicateCount, 1);
  assert.equal(result.data.total_jobs, 2);
  assert.deepEqual(result.data.posting_ids, [103, 104]);
  assert.deepEqual(result.data.jobs, [{ title: "C" }, { title: "D" }]);
  assert.equal(result.data.source, "target");
});

test("rejects comparison files with missing or unaligned ID lists", () => {
  assert.throws(
    () => removeJobsFoundInReference({ jobs: [{}] }, { posting_ids: [2], jobs: [{}] }),
    /基准文件缺少/
  );
  assert.throws(
    () => removeJobsFoundInReference(
      { posting_ids: [1], jobs: [{}] },
      { posting_ids: [2], jobs: [{}, {}] }
    ),
    /待清理文件.*数量不一致/
  );
});
