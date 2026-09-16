(function exposeFolderPlan(scope) {
  function normalizeFolderPlan(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new Error("JSON 顶层必须是对象。");
    }

    const topLevelKeys = Object.keys(input);
    if (topLevelKeys.length !== 1 || topLevelKeys[0] !== "folders") {
      throw new Error('JSON 顶层只能包含 "folders"。');
    }

    if (!input.folders || typeof input.folders !== "object" || Array.isArray(input.folders)) {
      throw new Error('"folders" 必须是以文件夹名称为键的对象。');
    }

    const seenPostingIds = new Map();
    const folders = Object.entries(input.folders).map(([name, postingIds]) => {
      if (!name || name !== name.trim()) {
        throw new Error("文件夹名称不能为空，也不能包含首尾空格。");
      }
      if (!Array.isArray(postingIds)) {
        throw new Error(`文件夹 "${name}" 的值必须是工作 ID 数组。`);
      }

      const seenInFolder = new Set();
      const normalizedIds = postingIds.map((postingId) => {
        if (typeof postingId !== "string" || !/^[1-9]\d*$/.test(postingId)) {
          throw new Error(`文件夹 "${name}" 包含无效工作 ID；ID 必须是正整数字符串。`);
        }
        if (seenInFolder.has(postingId)) {
          throw new Error(`工作 ID ${postingId} 在文件夹 "${name}" 中重复。`);
        }
        seenInFolder.add(postingId);

        const previousFolder = seenPostingIds.get(postingId);
        if (previousFolder) {
          throw new Error(
            `工作 ID ${postingId} 同时出现在 "${previousFolder}" 和 "${name}" 中。`
          );
        }
        seenPostingIds.set(postingId, name);
        return postingId;
      });

      return { name, postingIds: normalizedIds };
    });

    if (folders.length === 0) {
      throw new Error('"folders" 至少需要包含一个文件夹。');
    }

    const totalAssignments = folders.reduce(
      (total, folder) => total + folder.postingIds.length,
      0
    );
    if (totalAssignments === 0) {
      throw new Error("JSON 中没有任何工作 ID。");
    }

    return { folders, totalAssignments };
  }

  const api = { normalizeFolderPlan };
  scope.WWFolderPlan = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(globalThis);
