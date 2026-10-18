const planFileInput = document.querySelector("#planFile");
const runButton = document.querySelector("#runButton");
const removeAppliedButton = document.querySelector("#removeAppliedButton");
const clearAllFoldersButton = document.querySelector("#clearAllFoldersButton");
const output = document.querySelector("#output");

let selectedPlan = null;
let selectedInput = null;

function showOutput(text, kind = "") {
  output.textContent = text;
  output.className = kind;
}

function setBusy(busy) {
  runButton.disabled = busy || !selectedPlan;
  removeAppliedButton.disabled = busy;
  clearAllFoldersButton.disabled = busy;
  planFileInput.disabled = busy;
}

function describeSkippedPostings(postingIds) {
  if (!postingIds?.length) return "Skipped: 0";
  return `Skipped: ${postingIds.length}\nSkipped job IDs (non-JSON HTTP 200 response; jobs may be unavailable):\n${postingIds.join("\n")}`;
}

function describePlan(plan, fileName) {
  const lines = [
    `File: ${fileName}`,
    `Folders: ${plan.folders.length}`,
    `Assignments: ${plan.totalAssignments}`,
    ""
  ];

  for (const folder of plan.folders) {
    lines.push(`${folder.name}: ${folder.postingIds.length}`);
  }

  return lines.join("\n");
}

async function getActiveWaterlooWorksTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.startsWith("https://waterlooworks.uwaterloo.ca/")) {
    throw new Error("Open a WaterlooWorks page first.");
  }
  return tab;
}

async function sendToContentScript(message) {
  const tab = await getActiveWaterlooWorksTab();

  try {
    const response = await chrome.tabs.sendMessage(tab.id, message);
    if (response !== undefined) return response;
    throw new Error("The importer script is not loaded on this page.");
  } catch (_firstError) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["folder-plan.js", "content.js"]
    });
    return chrome.tabs.sendMessage(tab.id, message);
  }
}

planFileInput.addEventListener("change", async () => {
  selectedPlan = null;
  selectedInput = null;
  runButton.disabled = true;

  const file = planFileInput.files?.[0];
  if (!file) {
    showOutput("Ready.");
    return;
  }

  try {
    const parsed = JSON.parse(await file.text());
    selectedPlan = WWFolderPlan.normalizeFolderPlan(parsed);
    selectedInput = parsed;
    runButton.disabled = false;
    showOutput(describePlan(selectedPlan, file.name));
  } catch (error) {
    showOutput(error?.message || String(error), "error");
  }
});

runButton.addEventListener("click", async () => {
  if (!selectedPlan) return;

  setBusy(true);
  showOutput(
    `Reading folder mappings and processing ${selectedPlan.totalAssignments} assignments...`
  );

  try {
    const response = await sendToContentScript({
      action: "WW_IMPORT_FOLDER_ASSIGNMENTS",
      plan: selectedInput
    });

    if (!response?.success) {
      const completed = response?.completedAssignments ?? 0;
      const total = response?.totalAssignments ?? selectedPlan.totalAssignments;
      throw new Error(
        `${response?.error || "Folder assignment failed."}\nCompleted: ${completed}/${total}\n\n` +
        describeSkippedPostings(response?.skippedPostingIds)
      );
    }

    const mappings = response.folders
      .map((folder) => `${folder.name} -> ${folder.id}`)
      .join("\n");

    showOutput(
      `Finished. Assigned: ${response.completedAssignments}/${response.totalAssignments}\n\n` +
      `${describeSkippedPostings(response.skippedPostingIds)}\n\n` +
      `Folder mappings:\n${mappings}`,
      "success"
    );
  } catch (error) {
    showOutput(error?.message || String(error), "error");
  } finally {
    setBusy(false);
  }
});

removeAppliedButton.addEventListener("click", async () => {
  setBusy(true);
  showOutput("Checking jobs in all folders and removing applied jobs...");

  try {
    const response = await sendToContentScript({ action: "WW_REMOVE_APPLIED_POSTINGS" });
    if (!response) throw new Error("No cleanup result received. Refresh the WaterlooWorks page and try again.");

    const lines = [
      response.success ? "Cleanup complete." : `Cleanup stopped: ${response.error}`,
      `Jobs in folders: ${response.totalFolderPostings}`,
      `Confirmed applied: ${response.totalAssignments}`,
      `Removed: ${response.completedAssignments}`,
      "",
      "Removed job IDs:",
      response.removedPostingIds.join("\n") || "None"
    ];
    if (response.uncheckedPostingIds.length > 0) {
      lines.push("", "Job IDs kept because application status could not be confirmed:", response.uncheckedPostingIds.join("\n"));
    }
    showOutput(lines.join("\n"), response.success ? "success" : "error");
  } catch (error) {
    showOutput(error?.message || String(error), "error");
  } finally {
    setBusy(false);
  }
});

clearAllFoldersButton.addEventListener("click", async () => {
  setBusy(true);
  showOutput("Reading all classification folders and removing their jobs...");

  try {
    const response = await sendToContentScript({ action: "WW_CLEAR_ALL_FOLDER_POSTINGS" });
    if (!response) throw new Error("No result received. Refresh the WaterlooWorks page and try again.");

    const lines = [
      response.success ? "Finished." : `Stopped: ${response.error}`,
      `Removed: ${response.completedAssignments}/${response.totalAssignments}`,
      "",
      describeSkippedPostings(response.skippedPostingIds),
      "",
      "Removed job IDs:",
      response.removedPostingIds.join("\n") || "None"
    ];
    if (response.failedPostingId) {
      lines.push("", `Failed job ID: ${response.failedPostingId}`);
    }
    showOutput(lines.join("\n"), response.success ? "success" : "error");
  } catch (error) {
    showOutput(error?.message || String(error), "error");
  } finally {
    setBusy(false);
  }
});
