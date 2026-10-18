const assert = require("node:assert/strict");
const test = require("node:test");

const { normalizeFolderPlan } = require("./folder-plan.js");

test("normalizes the documented folder-assignment format", () => {
  const result = normalizeFolderPlan({
    folders: {
      Interested: ["488545", "488373"],
      Consider: ["488336"]
    }
  });

  assert.equal(result.totalAssignments, 3);
  assert.deepEqual(result.folders, [
    { name: "Interested", postingIds: ["488545", "488373"] },
    { name: "Consider", postingIds: ["488336"] }
  ]);
});

test("rejects a posting assigned to more than one folder", () => {
  assert.throws(
    () => normalizeFolderPlan({
      folders: {
        Interested: ["488545"],
        Consider: ["488545"]
      }
    }),
    /appears in both/
  );
});

test("rejects numeric JSON values instead of posting ID strings", () => {
  assert.throws(
    () => normalizeFolderPlan({ folders: { Interested: [488545] } }),
    /positive integer strings/
  );
});

test("rejects unexpected top-level fields", () => {
  assert.throws(
    () => normalizeFolderPlan({ folders: { Interested: ["488545"] }, note: "extra" }),
    /must contain only/
  );
});
