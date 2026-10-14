if (!globalThis.__wwFolderImporterV3Loaded) {
  globalThis.__wwFolderImporterV3Loaded = true;

  function cleanText(value) {
    return (value || "").toString().replace(/\s+/g, " ").trim();
  }

  function requireNumericId(value, label) {
    const normalized = cleanText(value);
    if (!/^\d+$/.test(normalized)) {
      throw new Error(`${label} 必须是数字。`);
    }
    return normalized;
  }

  function extractActionToken(sourceText, functionName) {
    if (!sourceText) return "";

    const patterns = [
      new RegExp(`function\\s+${functionName}\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?action\\s*:\\s*['\"]([^'\"]+)['\"]`, "i"),
      new RegExp(`${functionName}\\s*[:=]\\s*function\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?action\\s*:\\s*['\"]([^'\"]+)['\"]`, "i"),
      new RegExp(`${functionName}\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?action\\s*:\\s*['\"]([^'\"]+)['\"]`, "i")
    ];

    for (const pattern of patterns) {
      const match = sourceText.match(pattern);
      if (match?.[1]) return match[1];
    }

    return "";
  }

  function getSaveFormActionToken() {
    const sources = [
      document.documentElement?.innerHTML || "",
      ...Array.from(document.scripts).map((script) => script.textContent || "")
    ];

    for (const source of sources) {
      const token = extractActionToken(source, "saveForm");
      if (token) return token;
    }

    throw new Error("没有在当前页面找到 saveForm action；请确认已打开 Jobs 列表页面。");
  }

  async function saveJobFolder(postingIdValue, folderIdValue, action) {
    const postingId = requireNumericId(postingIdValue, "工作 ID");
    const folderId = folderIdValue === ""
      ? ""
      : requireNumericId(folderIdValue, "文件夹 ID");

    const body = new URLSearchParams({
      action,
      postingIds: postingId,
      newFolder: "false",
      nameInput: "",
      selectedFolder: folderId,
      blacklist: "false"
    });

    const response = await fetch("/myAccount/co-op/full/jobs.htm", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
      },
      body: body.toString()
    });

    const responseText = await response.text();
    let result;

    try {
      result = JSON.parse(responseText);
    } catch (_error) {
      const error = new Error(`工作 ${postingId}：服务器没有返回 JSON（HTTP ${response.status}）。`);
      error.code = "NON_JSON_RESPONSE";
      error.status = response.status;
      error.redirected = response.redirected;
      throw error;
    }

    if (!response.ok || result?.success !== true) {
      throw new Error(`保存失败（HTTP ${response.status}）：${responseText}`);
    }

    return result;
  }

  function isVisible(element) {
    return !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
  }

  function findFolderButton() {
    const labels = ["Save to My Jobs Folder", "Change My Jobs Folder"];

    return Array.from(document.querySelectorAll("button[aria-label]"))
      .find((button) => (
        labels.includes(cleanText(button.getAttribute("aria-label"))) && isVisible(button)
      )) || null;
  }

  function readFolderPanel() {
    const viewers = Array.from(document.querySelectorAll(".doc-viewer"));

    for (const viewer of viewers) {
      if (!isVisible(viewer)) continue;

      const folders = Array.from(
        viewer.querySelectorAll('label.toggle--single input[type="checkbox"][id]')
      ).flatMap((input) => {
        if (!/^\d+$/.test(input.id)) return [];

        const label = input.closest("label");
        const name = cleanText(label?.querySelector("p.label")?.textContent);
        if (!name) return [];

        return [{
          id: input.id,
          name,
          selected: input.checked
        }];
      });

      if (folders.length > 0) {
        return { viewer, folders };
      }
    }

    return null;
  }

  function closeFolderPanel(viewer) {
    const sidebar = viewer.closest(".sidebar--action");
    const closeButton = sidebar?.querySelector(".modal__btn--close-posting");

    if (!closeButton) {
      throw new Error("已读取文件夹，但没有找到弹窗关闭按钮。");
    }

    closeButton.click();
  }

  function waitForFolderPanel(openPanel) {
    return new Promise((resolve, reject) => {
      let finished = false;

      const finish = (result, error) => {
        if (finished) return;
        finished = true;
        observer.disconnect();
        clearTimeout(timeoutId);
        if (error) reject(error);
        else resolve(result);
      };

      const inspect = () => {
        const panel = readFolderPanel();
        if (panel) finish(panel, null);
      };

      const observer = new MutationObserver(inspect);
      observer.observe(document.body, { childList: true, subtree: true });

      const timeoutId = setTimeout(() => {
        finish(null, new Error("打开弹窗后没有读取到文件夹列表。"));
      }, 8000);

      openPanel();
      inspect();
    });
  }

  async function discoverFolders() {
    const button = findFolderButton();
    if (!button) {
      throw new Error("没有找到职位行；请先打开包含职位结果的 Jobs 列表。");
    }

    const { viewer, folders } = await waitForFolderPanel(() => button.click());
    closeFolderPanel(viewer);

    console.group("WaterlooWorks Folder Importer: folder mapping");
    console.table(folders);
    console.groupEnd();

    return folders;
  }

  async function importFolderAssignments(inputPlan) {
    const plan = WWFolderPlan.normalizeFolderPlan(inputPlan);
    const folders = await discoverFolders();
    const foldersByName = new Map();

    for (const folder of folders) {
      if (foldersByName.has(folder.name)) {
        throw new Error(`WaterlooWorks 中存在重复文件夹名称："${folder.name}"。`);
      }
      foldersByName.set(folder.name, folder);
    }

    const missingNames = plan.folders
      .map((folder) => folder.name)
      .filter((name) => !foldersByName.has(name));
    if (missingNames.length > 0) {
      throw new Error(`找不到以下 WaterlooWorks 文件夹：${missingNames.join(", ")}`);
    }

    const action = getSaveFormActionToken();
    const completed = [];
    const skippedPostingIds = [];

    try {
      for (const plannedFolder of plan.folders) {
        const folder = foldersByName.get(plannedFolder.name);

        for (const postingId of plannedFolder.postingIds) {
          try {
            await saveJobFolder(postingId, folder.id, action);
          } catch (error) {
            if (error.code === "NON_JSON_RESPONSE" && error.status === 200 && !error.redirected) {
              skippedPostingIds.push(postingId);
              continue;
            }
            throw error;
          }
          completed.push({
            postingId,
            folderId: folder.id,
            folderName: folder.name
          });
        }
      }
    } catch (error) {
      error.completedAssignments = completed.length;
      error.skippedPostingIds = skippedPostingIds;
      throw error;
    }

    console.group("WaterlooWorks Folder Importer: completed assignments");
    console.table(completed);
    console.table(skippedPostingIds.map((postingId) => ({ postingId, reason: "HTTP 200 非 JSON 响应" })));
    console.groupEnd();

    return {
      folders: plan.folders.map((plannedFolder) => {
        const folder = foldersByName.get(plannedFolder.name);
        return { id: folder.id, name: folder.name };
      }),
      completedAssignments: completed.length,
      skippedPostingIds,
      totalAssignments: plan.totalAssignments
    };
  }

  async function removeFolderAssignments(inputPlan) {
    const plan = WWFolderPlan.normalizeFolderPlan(inputPlan);
    const action = getSaveFormActionToken();
    const postingIds = plan.folders.flatMap((folder) => folder.postingIds);
    const completed = [];

    try {
      for (const postingId of postingIds) {
        await saveJobFolder(postingId, "", action);
        completed.push(postingId);
      }
    } catch (error) {
      error.completedAssignments = completed.length;
      throw error;
    }

    console.group("WaterlooWorks Folder Importer: removed assignments");
    console.table(completed.map((postingId) => ({ postingId })));
    console.groupEnd();

    return {
      completedAssignments: completed.length,
      totalAssignments: plan.totalAssignments
    };
  }

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === "WW_IMPORT_FOLDER_ASSIGNMENTS") {
      let normalizedPlan;

      try {
        normalizedPlan = WWFolderPlan.normalizeFolderPlan(request.plan);
      } catch (error) {
        sendResponse({ success: false, error: error?.message || String(error) });
        return false;
      }

      importFolderAssignments(request.plan)
        .then((result) => sendResponse({ success: true, ...result }))
        .catch((error) => sendResponse({
          success: false,
          error: error?.message || String(error),
          completedAssignments: error?.completedAssignments || 0,
          skippedPostingIds: error?.skippedPostingIds || [],
          totalAssignments: normalizedPlan.totalAssignments
        }));
      return true;
    }

    if (request.action === "WW_REMOVE_FOLDER_ASSIGNMENTS") {
      let normalizedPlan;

      try {
        normalizedPlan = WWFolderPlan.normalizeFolderPlan(request.plan);
      } catch (error) {
        sendResponse({ success: false, error: error?.message || String(error) });
        return false;
      }

      removeFolderAssignments(request.plan)
        .then((result) => sendResponse({ success: true, ...result }))
        .catch((error) => sendResponse({
          success: false,
          error: error?.message || String(error),
          completedAssignments: error?.completedAssignments || 0,
          totalAssignments: normalizedPlan.totalAssignments
        }));
      return true;
    }

    return false;
  });
}
