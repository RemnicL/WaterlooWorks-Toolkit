const planFileInput = document.querySelector("#planFile");
const runButton = document.querySelector("#runButton");
const removeButton = document.querySelector("#removeButton");
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
  removeButton.disabled = busy || !selectedPlan;
  removeAppliedButton.disabled = busy;
  clearAllFoldersButton.disabled = busy;
  planFileInput.disabled = busy;
}

function describeSkippedPostings(postingIds) {
  if (!postingIds?.length) return "跳过：0";
  return `跳过：${postingIds.length}\n跳过的工作 ID（HTTP 200 非 JSON 响应，岗位可能已下架）：\n${postingIds.join("\n")}`;
}

function describePlan(plan, fileName) {
  const lines = [
    `文件：${fileName}`,
    `文件夹：${plan.folders.length}`,
    `工作分配：${plan.totalAssignments}`,
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
    throw new Error("请先打开 WaterlooWorks 页面。");
  }
  return tab;
}

async function sendToContentScript(message) {
  const tab = await getActiveWaterlooWorksTab();

  try {
    const response = await chrome.tabs.sendMessage(tab.id, message);
    if (response !== undefined) return response;
    throw new Error("当前页面尚未加载导入器脚本。");
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
  removeButton.disabled = true;

  const file = planFileInput.files?.[0];
  if (!file) {
    showOutput("等待操作。");
    return;
  }

  try {
    const parsed = JSON.parse(await file.text());
    selectedPlan = WWFolderPlan.normalizeFolderPlan(parsed);
    selectedInput = parsed;
    runButton.disabled = false;
    removeButton.disabled = false;
    showOutput(describePlan(selectedPlan, file.name));
  } catch (error) {
    showOutput(error?.message || String(error), "error");
  }
});

runButton.addEventListener("click", async () => {
  if (!selectedPlan) return;

  setBusy(true);
  showOutput(
    `正在读取文件夹映射并执行 ${selectedPlan.totalAssignments} 个分配……`
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
        `${response?.error || "批量分配失败。"}\n已完成：${completed}/${total}\n\n` +
        describeSkippedPostings(response?.skippedPostingIds)
      );
    }

    const mappings = response.folders
      .map((folder) => `${folder.name} -> ${folder.id}`)
      .join("\n");

    showOutput(
      `处理完成，成功放入：${response.completedAssignments}/${response.totalAssignments}\n\n` +
      `${describeSkippedPostings(response.skippedPostingIds)}\n\n` +
      `文件夹映射：\n${mappings}`,
      "success"
    );
  } catch (error) {
    showOutput(error?.message || String(error), "error");
  } finally {
    setBusy(false);
  }
});

removeButton.addEventListener("click", async () => {
  if (!selectedPlan || !selectedInput) return;

  setBusy(true);
  showOutput(
    `正在将 JSON 中的 ${selectedPlan.totalAssignments} 个工作移出当前文件夹……`
  );

  try {
    const response = await sendToContentScript({
      action: "WW_REMOVE_FOLDER_ASSIGNMENTS",
      plan: selectedInput
    });

    if (!response?.success) {
      const completed = response?.completedAssignments ?? 0;
      const total = response?.totalAssignments ?? selectedPlan.totalAssignments;
      throw new Error(
        `${response?.error || "批量移出失败。"}\n已完成：${completed}/${total}`
      );
    }

    showOutput(
      `已移出：${response.completedAssignments}/${response.totalAssignments}`,
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
  showOutput("正在检查所有文件夹中的岗位，并移出已申请岗位……");

  try {
    const response = await sendToContentScript({ action: "WW_REMOVE_APPLIED_POSTINGS" });
    if (!response) throw new Error("未收到清理结果，请刷新 WaterlooWorks 页面后重试。");

    const lines = [
      response.success ? "清理完成。" : `清理中止：${response.error}`,
      `文件夹内岗位：${response.totalFolderPostings}`,
      `已确认申请：${response.totalAssignments}`,
      `成功移出：${response.completedAssignments}`,
      "",
      "已移出的岗位 ID：",
      response.removedPostingIds.join("\n") || "无"
    ];
    if (response.uncheckedPostingIds.length > 0) {
      lines.push("", "无法确认申请状态，已保留的岗位 ID：", response.uncheckedPostingIds.join("\n"));
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
  showOutput("正在读取所有分类文件夹，并移出其中的全部岗位……");

  try {
    const response = await sendToContentScript({ action: "WW_CLEAR_ALL_FOLDER_POSTINGS" });
    if (!response) throw new Error("未收到清空结果，请刷新 WaterlooWorks 页面后重试。");

    const lines = [
      response.success ? "处理完成。" : `处理中止：${response.error}`,
      `成功移出：${response.completedAssignments}/${response.totalAssignments}`,
      "",
      describeSkippedPostings(response.skippedPostingIds),
      "",
      "已移出的岗位 ID：",
      response.removedPostingIds.join("\n") || "无"
    ];
    if (response.failedPostingId) {
      lines.push("", `失败的岗位 ID：${response.failedPostingId}`);
    }
    showOutput(lines.join("\n"), response.success ? "success" : "error");
  } catch (error) {
    showOutput(error?.message || String(error), "error");
  } finally {
    setBusy(false);
  }
});
