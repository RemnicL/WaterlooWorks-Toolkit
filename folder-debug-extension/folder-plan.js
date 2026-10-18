(function exposeFolderPlan(scope) {
  function normalizeFolderPlan(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new Error("The top-level JSON value must be an object.");
    }

    const topLevelKeys = Object.keys(input);
    if (topLevelKeys.length !== 1 || topLevelKeys[0] !== "folders") {
      throw new Error('The top-level JSON object must contain only "folders".');
    }

    if (!input.folders || typeof input.folders !== "object" || Array.isArray(input.folders)) {
      throw new Error('"folders" must be an object keyed by folder name.');
    }

    const seenPostingIds = new Map();
    const folders = Object.entries(input.folders).map(([name, postingIds]) => {
      if (!name || name !== name.trim()) {
        throw new Error("Folder names must not be empty or have leading or trailing spaces.");
      }
      if (!Array.isArray(postingIds)) {
        throw new Error(`Folder "${name}" must contain an array of job IDs.`);
      }

      const seenInFolder = new Set();
      const normalizedIds = postingIds.map((postingId) => {
        if (typeof postingId !== "string" || !/^[1-9]\d*$/.test(postingId)) {
          throw new Error(`Folder "${name}" contains an invalid job ID; IDs must be positive integer strings.`);
        }
        if (seenInFolder.has(postingId)) {
          throw new Error(`Job ID ${postingId} is duplicated in folder "${name}".`);
        }
        seenInFolder.add(postingId);

        const previousFolder = seenPostingIds.get(postingId);
        if (previousFolder) {
          throw new Error(
            `Job ID ${postingId} appears in both "${previousFolder}" and "${name}".`
          );
        }
        seenPostingIds.set(postingId, name);
        return postingId;
      });

      return { name, postingIds: normalizedIds };
    });

    if (folders.length === 0) {
      throw new Error('"folders" must contain at least one folder.');
    }

    const totalAssignments = folders.reduce(
      (total, folder) => total + folder.postingIds.length,
      0
    );
    if (totalAssignments === 0) {
      throw new Error("The JSON file contains no job IDs.");
    }

    return { folders, totalAssignments };
  }

  const api = { normalizeFolderPlan };
  scope.WWFolderPlan = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(globalThis);
