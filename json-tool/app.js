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
  let loaded = null;
  let merged = null;
  let deleteLoaded = null;
  let deleteResult = null;

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
})();
