(function () {
  "use strict";

  const core = globalThis.WaterlooWorksJson;
  const fileInput = document.getElementById("json-file");
  const chunkSizeInput = document.getElementById("chunk-size");
  const splitButton = document.getElementById("split-button");
  const fileName = document.getElementById("file-name");
  const jobCount = document.getElementById("job-count");
  const partCount = document.getElementById("part-count");
  const status = document.getElementById("status");
  const mergeFilesInput = document.getElementById("merge-files");
  const mergeButton = document.getElementById("merge-button");
  const mergeFileCount = document.getElementById("merge-file-count");
  const mergeInputCount = document.getElementById("merge-input-count");
  const mergeOutputCount = document.getElementById("merge-output-count");
  const mergeStatus = document.getElementById("merge-status");
  const deleteFileInput = document.getElementById("delete-file");
  const deleteFieldInput = document.getElementById("delete-field");
  const deleteQueryInput = document.getElementById("delete-query");
  const deleteButton = document.getElementById("delete-button");
  const deleteInputCount = document.getElementById("delete-input-count");
  const deleteMatchCount = document.getElementById("delete-match-count");
  const deleteOutputCount = document.getElementById("delete-output-count");
  const deleteStatus = document.getElementById("delete-status");
  const compareReferenceFileInput = document.getElementById("compare-reference-file");
  const compareTargetFileInput = document.getElementById("compare-target-file");
  const compareButton = document.getElementById("compare-button");
  const compareReferenceCount = document.getElementById("compare-reference-count");
  const compareTargetCount = document.getElementById("compare-target-count");
  const compareDuplicateCount = document.getElementById("compare-duplicate-count");
  const compareOutputCount = document.getElementById("compare-output-count");
  const compareStatus = document.getElementById("compare-status");
  const keepFileInput = document.getElementById("keep-file");
  const keepIdsInput = document.getElementById("keep-ids");
  const keepButton = document.getElementById("keep-button");
  const keepInputCount = document.getElementById("keep-input-count");
  const keepRequestedCount = document.getElementById("keep-requested-count");
  const keepOutputCount = document.getElementById("keep-output-count");
  const keepStatus = document.getElementById("keep-status");
  let loaded = null;
  let merged = null;
  let deleteLoaded = null;
  let deleteResult = null;
  let compareResult = null;
  let compareTargetName = "";
  let keepLoaded = null;
  let keepResult = null;

  function setStatus(message, isError) {
    status.textContent = message;
    status.classList.toggle("error", Boolean(isError));
  }

  function updateSummary() {
    if (!loaded) {
      partCount.textContent = "—";
      splitButton.disabled = true;
      return;
    }

    try {
      const size = core.normalizeChunkSize(chunkSizeInput.value);
      partCount.textContent = String(Math.ceil(loaded.data.jobs.length / size));
      splitButton.disabled = loaded.data.jobs.length === 0;
      setStatus(loaded.data.jobs.length === 0 ? "文件中没有可分割的工作。" : "");
    } catch (error) {
      partCount.textContent = "—";
      splitButton.disabled = true;
      setStatus(error.message, true);
    }
  }

  function downloadJson(data, name) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function setMergeStatus(message, isError) {
    mergeStatus.textContent = message;
    mergeStatus.classList.toggle("error", Boolean(isError));
  }

  function setDeleteStatus(message, isError) {
    deleteStatus.textContent = message;
    deleteStatus.classList.toggle("error", Boolean(isError));
  }

  function updateDeletePreview() {
    deleteResult = null;
    deleteButton.disabled = true;
    deleteMatchCount.textContent = "—";
    deleteOutputCount.textContent = "—";
    if (!deleteLoaded) return;

    const query = deleteQueryInput.value.trim();
    if (!query) {
      setDeleteStatus("输入文本后将显示匹配数量。");
      return;
    }

    try {
      deleteResult = core.deleteMatchingJobs(deleteLoaded.data, deleteFieldInput.value, query);
      deleteMatchCount.textContent = String(deleteResult.deletedCount);
      deleteOutputCount.textContent = String(deleteResult.data.jobs.length);
      deleteButton.disabled = deleteResult.deletedCount === 0;
      setDeleteStatus(deleteResult.deletedCount
        ? `找到 ${deleteResult.deletedCount} 个匹配项。`
        : "没有找到匹配项。"
      );
    } catch (error) {
      setDeleteStatus(`无法筛选：${error.message}`, true);
    }
  }

  function setCompareStatus(message, isError) {
    compareStatus.textContent = message;
    compareStatus.classList.toggle("error", Boolean(isError));
  }

  async function updateComparisonPreview() {
    compareResult = null;
    compareTargetName = "";
    compareButton.disabled = true;
    compareReferenceCount.textContent = "—";
    compareTargetCount.textContent = "—";
    compareDuplicateCount.textContent = "—";
    compareOutputCount.textContent = "—";
    setCompareStatus("");

    const referenceFile = compareReferenceFileInput.files?.[0];
    const targetFile = compareTargetFileInput.files?.[0];
    if (!referenceFile || !targetFile) {
      setCompareStatus("请选择基准文件和待清理文件。");
      return;
    }

    try {
      const [reference, target] = await Promise.all([
        referenceFile.text().then((text) => core.validateExport(JSON.parse(text))),
        targetFile.text().then((text) => core.validateExport(JSON.parse(text)))
      ]);
      compareReferenceCount.textContent = String(reference.jobs.length);
      compareTargetCount.textContent = String(target.jobs.length);
      compareResult = core.removeJobsFoundInReference(reference, target);
      compareTargetName = targetFile.name;
      compareDuplicateCount.textContent = String(compareResult.duplicateCount);
      compareOutputCount.textContent = String(compareResult.data.jobs.length);
      compareButton.disabled = compareResult.duplicateCount === 0;
      setCompareStatus(compareResult.duplicateCount
        ? `找到 ${compareResult.duplicateCount} 个重复工作。`
        : "两个文件之间没有重复工作。"
      );
    } catch (error) {
      setCompareStatus(`无法比较：${error.message}`, true);
    }
  }

  function setKeepStatus(message, isError) {
    keepStatus.textContent = message;
    keepStatus.classList.toggle("error", Boolean(isError));
  }

  function updateKeepPreview() {
    keepResult = null;
    keepButton.disabled = true;
    keepRequestedCount.textContent = "—";
    keepOutputCount.textContent = "—";
    if (!keepLoaded) return;

    if (!keepIdsInput.value.trim()) {
      setKeepStatus("输入工作 ID 后将显示匹配数量。");
      return;
    }

    try {
      keepResult = core.keepJobsByIds(keepLoaded.data, keepIdsInput.value);
      keepRequestedCount.textContent = String(keepResult.requestedCount);
      keepOutputCount.textContent = String(keepResult.matchedCount);
      keepButton.disabled = keepResult.matchedCount === 0;
      setKeepStatus(keepResult.missingIds.length
        ? `匹配 ${keepResult.matchedCount} 个工作；${keepResult.missingIds.length} 个 ID 未找到。`
        : `已匹配全部 ${keepResult.matchedCount} 个工作。`
      );
    } catch (error) {
      setKeepStatus(`无法筛选：${error.message}`, true);
    }
  }

  fileInput.addEventListener("change", async () => {
    loaded = null;
    const file = fileInput.files && fileInput.files[0];
    fileName.textContent = file ? file.name : "尚未选择";
    jobCount.textContent = "—";
    setStatus("");

    if (!file) {
      updateSummary();
      return;
    }

    try {
      const data = core.validateExport(JSON.parse(await file.text()));
      loaded = { data, name: file.name };
      jobCount.textContent = String(data.jobs.length);
      updateSummary();
    } catch (error) {
      updateSummary();
      setStatus(`无法读取文件：${error.message}`, true);
    }
  });

  chunkSizeInput.addEventListener("input", updateSummary);

  splitButton.addEventListener("click", () => {
    if (!loaded) return;

    try {
      const parts = core.splitExportData(loaded.data, chunkSizeInput.value);
      parts.forEach((part, index) => {
        downloadJson(part, core.partFilename(loaded.name, index, parts.length));
      });
      setStatus(`已生成 ${parts.length} 个文件。若浏览器询问，请允许下载多个文件。`);
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  mergeFilesInput.addEventListener("change", async () => {
    merged = null;
    mergeButton.disabled = true;
    mergeOutputCount.textContent = "—";
    setMergeStatus("");

    const files = Array.from(mergeFilesInput.files || []);
    mergeFileCount.textContent = files.length ? String(files.length) : "—";
    mergeInputCount.textContent = "—";
    if (!files.length) return;

    try {
      const sources = await Promise.all(files.map(async (file) => {
        try {
          return core.validateExport(JSON.parse(await file.text()));
        } catch (error) {
          throw new Error(`${file.name}：${error.message}`);
        }
      }));
      mergeInputCount.textContent = String(sources.reduce((sum, source) => sum + source.jobs.length, 0));
      merged = core.mergeExportData(sources);
      mergeOutputCount.textContent = String(merged.data.jobs.length);
      mergeButton.disabled = false;
      setMergeStatus(merged.duplicateCount
        ? `发现 ${merged.duplicateCount} 个重复 ID，将保留第一次出现的工作。`
        : "文件可以合并。"
      );
    } catch (error) {
      setMergeStatus(`无法合并：${error.message}`, true);
    }
  });

  mergeButton.addEventListener("click", () => {
    if (!merged) return;
    downloadJson(merged.data, "waterlooworks_jobs_merged.json");
    setMergeStatus(`已下载 ${merged.data.jobs.length} 个工作的合并文件。`);
  });

  deleteFileInput.addEventListener("change", async () => {
    deleteLoaded = null;
    deleteResult = null;
    deleteButton.disabled = true;
    deleteInputCount.textContent = "—";
    deleteMatchCount.textContent = "—";
    deleteOutputCount.textContent = "—";
    setDeleteStatus("");

    const file = deleteFileInput.files && deleteFileInput.files[0];
    if (!file) return;

    try {
      const data = core.validateExport(JSON.parse(await file.text()));
      deleteLoaded = { data, name: file.name };
      deleteInputCount.textContent = String(data.jobs.length);
      updateDeletePreview();
    } catch (error) {
      setDeleteStatus(`无法读取文件：${error.message}`, true);
    }
  });

  deleteFieldInput.addEventListener("change", updateDeletePreview);
  deleteQueryInput.addEventListener("input", updateDeletePreview);

  deleteButton.addEventListener("click", () => {
    if (!deleteLoaded || !deleteResult) return;
    const baseName = deleteLoaded.name.replace(/\.json$/i, "");
    downloadJson(deleteResult.data, `${baseName}_filtered.json`);
    setDeleteStatus(`已删除 ${deleteResult.deletedCount} 个匹配项并下载新文件。`);
  });

  compareReferenceFileInput.addEventListener("change", updateComparisonPreview);
  compareTargetFileInput.addEventListener("change", updateComparisonPreview);

  compareButton.addEventListener("click", () => {
    if (!compareResult) return;
    const baseName = compareTargetName.replace(/\.json$/i, "");
    downloadJson(compareResult.data, `${baseName}_deduplicated.json`);
    setCompareStatus(`已删除 ${compareResult.duplicateCount} 个重复工作并下载新文件。`);
  });

  keepFileInput.addEventListener("change", async () => {
    keepLoaded = null;
    keepResult = null;
    keepButton.disabled = true;
    keepInputCount.textContent = "—";
    keepRequestedCount.textContent = "—";
    keepOutputCount.textContent = "—";
    setKeepStatus("");

    const file = keepFileInput.files?.[0];
    if (!file) return;

    try {
      const data = core.validateExport(JSON.parse(await file.text()));
      keepLoaded = { data, name: file.name };
      keepInputCount.textContent = String(data.jobs.length);
      updateKeepPreview();
    } catch (error) {
      setKeepStatus(`无法读取文件：${error.message}`, true);
    }
  });

  keepIdsInput.addEventListener("input", updateKeepPreview);

  keepButton.addEventListener("click", () => {
    if (!keepLoaded || !keepResult) return;
    const baseName = keepLoaded.name.replace(/\.json$/i, "");
    downloadJson(keepResult.data, `${baseName}_selected.json`);
    setKeepStatus(`已保留 ${keepResult.matchedCount} 个工作并下载新文件。`);
  });
})();
