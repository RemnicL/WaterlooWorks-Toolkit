document.addEventListener("DOMContentLoaded", async () => {
  const WATERLOOWORKS_JOBS_URL = "https://waterlooworks.uwaterloo.ca/myAccount/co-op/full/jobs.htm";
  const exportJobsBtn = document.getElementById("exportJobsBtn");
  const exportStatus = document.getElementById("exportStatus");
  const exportOptionInputs = {
    includeBasicInfo: document.getElementById("includeBasicInfo"),
    includeCurrentPageOnly: document.getElementById("includeCurrentPageOnly"),
    skipAppliedJobs: document.getElementById("skipAppliedJobs")
  };
  const sectionOptions = document.getElementById("sectionExportOptions");
  let currentGroup = "";
  for (const { option, label, group } of globalThis.WWExportFields) {
    if (group !== currentGroup) {
      const heading = document.createElement("h3");
      heading.textContent = group;
      sectionOptions.append(heading);
      currentGroup = group;
    }
    const optionLabel = document.createElement("label");
    optionLabel.className = "export-option";
    const input = document.createElement("input");
    input.id = option;
    input.type = "checkbox";
    input.checked = true;
    input.disabled = true;
    const text = document.createElement("span");
    text.textContent = label;
    optionLabel.append(input, text);
    sectionOptions.append(optionLabel);
    exportOptionInputs[option] = input;
  }

  function setStatus(message, isError = false) {
    if (!exportStatus) return;
    exportStatus.textContent = message;
    exportStatus.classList.toggle("error", isError);
    exportStatus.style.display = "block";
  }

  function isJobsPageUrl(url) {
    return typeof url === "string" && url.includes("/myAccount/co-op/full/jobs.htm");
  }

  function getExportOptions() {
    return Object.fromEntries(
      Object.entries(exportOptionInputs).map(([name, input]) => [name, Boolean(input?.checked)])
    );
  }

  try {
    const savedOptions = await chrome.storage.local.get(Object.keys(exportOptionInputs));
    for (const [name, input] of Object.entries(exportOptionInputs)) {
      if (typeof savedOptions[name] === "boolean") input.checked = savedOptions[name];
    }
  } catch (error) {
    setStatus(`Could not load saved selections: ${error.message}`, true);
  }
  for (const [name, input] of Object.entries(exportOptionInputs)) {
    input.disabled = false;
    input.addEventListener("change", () => {
      chrome.storage.local.set({ [name]: input.checked }).catch((error) => {
        setStatus(`Could not save selections: ${error.message}`, true);
      });
    });
  }
  exportJobsBtn.disabled = false;

  async function getWaterlooWorksTab() {
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (activeTab?.id && isJobsPageUrl(activeTab.url || "")) {
      return activeTab;
    }
    const candidates = await chrome.tabs.query({ url: "*://waterlooworks.uwaterloo.ca/*jobs.htm*" });
    return candidates[0] || null;
  }

  async function waitForTabComplete(tabId, timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const tab = await chrome.tabs.get(tabId);
      if (tab?.status === "complete") return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  async function sendMessageWithRetry(tabId, message, retries = 12, delayMs = 350) {
    let lastError = null;
    for (let i = 0; i < retries; i += 1) {
      try {
        return await chrome.tabs.sendMessage(tabId, message);
      } catch (err) {
        lastError = err;
        const errMsg = String(err?.message || "");
        if (errMsg.includes("Receiving end does not exist")) {
          try {
            await chrome.scripting.executeScript({
              target: { tabId },
              files: ["export-fields.js", "content_helpers/bootstrapContent.js", "content.js"]
            });
          } catch (_injectErr) {}
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    throw lastError || new Error("Failed to communicate with the WaterlooWorks tab.");
  }

  async function ensureWaterlooWorksTab() {
    let tab = await getWaterlooWorksTab();
    if (!tab?.id) {
      tab = await chrome.tabs.create({ url: WATERLOOWORKS_JOBS_URL, active: true });
      await waitForTabComplete(tab.id);
    } else {
      await chrome.tabs.update(tab.id, { active: true });
      await waitForTabComplete(tab.id);
    }
    return tab;
  }

  async function exportJobs(exportOptions) {
    const tab = await ensureWaterlooWorksTab();
    if (!tab?.id) {
      throw new Error("Could not open a WaterlooWorks jobs page.");
    }

    const response = await sendMessageWithRetry(tab.id, {
      action: "EXPORT_FILTERED_JOBS",
      exportOptions
    });
    if (!response?.success) {
      throw new Error(response?.error || "Export failed.");
    }

    const jobs = Array.isArray(response.jobs) ? response.jobs : [];
    if (!jobs.length) {
      throw new Error(exportOptions.skipAppliedJobs
        ? "No unapplied jobs remain under the current WaterlooWorks filter."
        : "No jobs found under the current WaterlooWorks filter.");
    }

    const exportData = {
      total_jobs: jobs.length,
      posting_ids: Array.isArray(response.postingIds) ? response.postingIds : [],
      jobs
    };

    const ts = new Date().toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15);
    const filename = `waterlooworks_jobs_${ts}.json`;
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const objectUrl = URL.createObjectURL(blob);

    try {
      await chrome.downloads.download({
        url: objectUrl,
        filename,
        saveAs: true
      });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }

    return jobs.length;
  }

  if (exportJobsBtn) {
    exportJobsBtn.addEventListener("click", async () => {
      const originalLabel = exportJobsBtn.textContent;
      exportJobsBtn.disabled = true;
      exportJobsBtn.textContent = "Exporting...";
      setStatus("Collecting jobs from the current WaterlooWorks filter...");

      try {
        const exportOptions = getExportOptions();
        const count = await exportJobs(exportOptions);
        setStatus(`Export complete. Saved ${count} jobs.`);
      } catch (error) {
        setStatus(error?.message || "Export failed.", true);
      } finally {
        exportJobsBtn.disabled = false;
        exportJobsBtn.textContent = originalLabel;
      }
    });
  }
});
