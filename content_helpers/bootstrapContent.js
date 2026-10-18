function bootstrapContentScript() {
  let isExportingJobs = false;
  const actionTokenCache = {};

  function cleanText(value) {
    return (value || "").toString().replace(/\s+/g, " ").trim();
  }

  function waitMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitUntil(fn, timeoutMs = 12000, intervalMs = 250) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (fn()) return true;
      await waitMs(intervalMs);
    }
    return false;
  }

  function findJobsTable() {
    return document.querySelector("#dataViewerPlaceholder table.data-viewer-table")
      || document.querySelector("table.data-viewer-table");
  }

  function readHeaders(table) {
    return Array.from(table.querySelectorAll("thead th")).map((th) => cleanText(th.innerText).toLowerCase());
  }

  function findHeaderIdx(headers, keys) {
    for (let i = 0; i < headers.length; i += 1) {
      const header = headers[i];
      if (keys.some((key) => header.includes(key))) return i;
    }
    return -1;
  }

  function getPageRows() {
    const table = findJobsTable();
    if (!table) return [];

    const headers = readHeaders(table);
    const idxId = findHeaderIdx(headers, ["id"]);
    const idxTitle = findHeaderIdx(headers, ["job title", "title", "position"]);
    const idxOrg = findHeaderIdx(headers, ["organization", "employer"]);
    const idxDivision = findHeaderIdx(headers, ["division"]);
    const idxOpenings = findHeaderIdx(headers, ["openings"]);
    const idxCity = findHeaderIdx(headers, ["city", "location"]);
    const idxLevel = findHeaderIdx(headers, ["level"]);
    const idxApps = findHeaderIdx(headers, ["apps"]);
    const idxDeadline = findHeaderIdx(headers, ["app deadline", "deadline"]);

    const rows = Array.from(table.querySelectorAll("tbody tr"));
    return rows.map((row) => {
      const checkboxId = cleanText(row.querySelector("input[name='dataViewerSelection']")?.value || "");
      const thId = cleanText(row.querySelector("th[scope='row'] .overflow--ellipsis")?.innerText || "");
      const idCell = checkboxId || thId;
      const tdElements = Array.from(row.querySelectorAll("td"));
      const tdCells = tdElements.map((td) => cleanText(td.innerText));
      const cells = [idCell, ...tdCells];
      const at = (i) => (i >= 0 && i < cells.length ? cells[i] : "");
      const titleLink = tdElements[idxTitle - 1]?.querySelector("a.overflow--ellipsis");
      // The site's JobTitle.applied flag renders this icon, including on restricted postings.
      const hasApplication = titleLink
        ? Array.from(titleLink.parentElement.querySelectorAll("i.material-icons"))
          .some((icon) => cleanText(icon.textContent) === "check_circle")
        : null;

      return {
        posting_id: at(idxId) || idCell,
        has_application: hasApplication,
        title: at(idxTitle),
        organization: at(idxOrg),
        division: at(idxDivision),
        openings: at(idxOpenings),
        city: at(idxCity),
        level: at(idxLevel),
        apps: at(idxApps),
        app_deadline: at(idxDeadline),
        raw_text: cleanText(cells.join(" | "))
      };
    });
  }

  function findPagerBtn(labelPart) {
    const exact = document.querySelector(`.pagination__link[aria-label*='${labelPart}']`);
    if (exact) return exact;

    const labelLower = labelPart.toLowerCase();
    const candidates = Array.from(document.querySelectorAll(".pagination__link, .pagination a, .pagination button"));
    return candidates.find((el) => {
      const aria = cleanText(el.getAttribute("aria-label") || "").toLowerCase();
      const title = cleanText(el.getAttribute("title") || "").toLowerCase();
      const text = cleanText(el.innerText || el.textContent || "").toLowerCase();
      const rel = cleanText(el.getAttribute("rel") || "").toLowerCase();

      if (labelLower.includes("next")) {
        return aria.includes("next") || title.includes("next") || rel === "next" || text === ">" || text === "next";
      }
      if (labelLower.includes("first")) {
        return aria.includes("first") || title.includes("first") || text === "<<" || text === "first";
      }
      return false;
    }) || null;
  }

  function clickIfEnabled(el) {
    if (!el) return false;
    if (el.classList.contains("disabled") || el.getAttribute("aria-disabled") === "true") {
      return false;
    }
    el.click();
    return true;
  }

  function hasNextPage() {
    const nextBtn = findPagerBtn("Go to next page");
    return !!nextBtn
      && !nextBtn.classList.contains("disabled")
      && nextBtn.getAttribute("aria-disabled") !== "true";
  }

  function goNextPage() {
    return clickIfEnabled(findPagerBtn("Go to next page"));
  }

  function goFirstPage() {
    return clickIfEnabled(findPagerBtn("Go to first page"));
  }

  async function waitPageChange(prevFirstId, timeoutMs = 12000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await waitMs(300);
      const currentRows = getPageRows();
      const firstId = currentRows[0]?.posting_id || "";
      if (!prevFirstId && currentRows.length > 0) return true;
      if (firstId && firstId !== prevFirstId) return true;
      if (!hasNextPage()) return true;
    }
    return false;
  }

  async function goToFirstPage(maxSteps = 8) {
    for (let i = 0; i < maxSteps; i += 1) {
      const rows = getPageRows();
      const firstId = rows[0]?.posting_id || "";
      const moved = goFirstPage();
      if (!moved) break;
      await waitPageChange(firstId);
      await waitMs(200);
    }
  }

  function extractActionTokenFromText(sourceText, functionName) {
    if (!sourceText) return "";
    const patterns = [
      new RegExp(`function\\s+${functionName}\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?action\\s*:\\s*['"]([^'"]+)['"]`, "i"),
      new RegExp(`${functionName}\\s*[:=]\\s*function\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?action\\s*:\\s*['"]([^'"]+)['"]`, "i"),
      new RegExp(`${functionName}\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?action\\s*:\\s*['"]([^'"]+)['"]`, "i")
    ];

    for (const pattern of patterns) {
      const match = sourceText.match(pattern);
      if (match?.[1]) return match[1];
    }
    return "";
  }

  async function getActionToken(functionName) {
    if (actionTokenCache[functionName]) {
      return actionTokenCache[functionName];
    }

    try {
      const inlineSources = [
        document.documentElement?.innerHTML || "",
        ...Array.from(document.scripts).map((script) => script.textContent || "")
      ];

      for (const source of inlineSources) {
        const token = extractActionTokenFromText(source, functionName);
        if (token) {
          actionTokenCache[functionName] = token;
          return token;
        }
      }

      const externalScripts = Array.from(document.scripts)
        .map((script) => script.src || "")
        .filter((src) => src && src.startsWith(window.location.origin));

      for (const src of externalScripts) {
        try {
          const resp = await fetch(src, { credentials: "include" });
          if (!resp.ok) continue;
          const scriptText = await resp.text();
          const token = extractActionTokenFromText(scriptText, functionName);
          if (token) {
            actionTokenCache[functionName] = token;
            return token;
          }
        } catch (_scriptErr) {}
      }
    } catch (_e) {}

    return "";
  }

  async function fetchOverviewHtml(postingId, overviewToken) {
    if (!postingId || !overviewToken) return "";
    const body = new URLSearchParams();
    body.set("action", overviewToken);
    body.set("postingId", String(postingId));

    const resp = await fetch("/myAccount/co-op/full/jobs.htm", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
      },
      body: body.toString()
    });

    if (!resp.ok) return "";
    return resp.text();
  }

  async function fetchPostingJson(postingId, postingDataToken) {
    if (!postingId || !postingDataToken) return null;
    const body = new URLSearchParams();
    body.set("action", postingDataToken);
    body.set("postingId", String(postingId));

    const resp = await fetch("/myAccount/co-op/full/jobs.htm", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest"
      },
      body: body.toString()
    });

    if (!resp.ok) return null;
    try {
      return await resp.json();
    } catch (_e) {
      return null;
    }
  }

  async function fetchWtrJson(companyId, reportToken) {
    if (!companyId || !reportToken) return null;
    const body = new URLSearchParams();
    body.set("action", reportToken);
    body.set("reportHolder", "com.orbis.web.content.crm.Company");
    body.set("reportHolderId", String(companyId));
    body.set("reportHolderField", "t100");

    const resp = await fetch("/myAccount/co-op/full/jobs.htm", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
      },
      body: body.toString()
    });

    if (!resp.ok) return null;
    try {
      return await resp.json();
    } catch (_e) {
      return null;
    }
  }

  function normalizeWtrData(section) {
    if (!section || typeof section !== "object") return null;
    const out = {
      title: cleanText(section.title || ""),
      description: cleanText(section.description || "")
    };
    if (Array.isArray(section.columns)) out.columns = section.columns.map((c) => cleanText(c));
    if (Array.isArray(section.rows)) out.rows = section.rows;
    if ("series" in section) out.series = section.series;
    if ("categories" in section) out.categories = section.categories;
    if ("value" in section) out.value = section.value;
    if ("data" in section) out.data = section.data;
    return out;
  }

  function getHiringHistoryFromWtr(report) {
    const empty = {
      hires_by_faculty: null,
      hires_by_student_work_term_number: null,
      most_frequently_hired_programs: null
    };
    if (!report || typeof report !== "object" || !Array.isArray(report.sections)) return empty;

    function findSection(matchers) {
      return report.sections.find((sec) => {
        const title = cleanText(`${sec?.title || ""} ${sec?.description || ""}`).toLowerCase();
        return matchers.every((matcher) => title.includes(matcher));
      }) || null;
    }

    return {
      hires_by_faculty: normalizeWtrData(findSection(["hires by", "faculty"])),
      hires_by_student_work_term_number: normalizeWtrData(findSection(["hires by", "work term"])),
      most_frequently_hired_programs: normalizeWtrData(findSection(["most frequently", "program"]))
    };
  }

  function getHiringHistoryFromHtml(html) {
    if (!html) {
      return {
        hires_by_faculty: null,
        hires_by_student_work_term_number: null,
        most_frequently_hired_programs: null
      };
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    function sectionByHeadingFromDoc(matchers) {
      const nodes = Array.from(doc.querySelectorAll("h1,h2,h3,h4,h5,strong,b,label,span,p,div"));
      for (const node of nodes) {
        const text = cleanText(node.textContent || "").toLowerCase();
        if (text && matchers.every((matcher) => text.includes(matcher))) {
          return node.closest("section,article,div,.doc-viewer") || node.parentElement;
        }
      }
      return null;
    }

    function extractSection(container) {
      if (!container) return null;

      const tables = [];
      container.querySelectorAll("table").forEach((table) => {
        const rows = Array.from(table.querySelectorAll("tr"))
          .map((tr) => Array.from(tr.querySelectorAll("th,td")).map((cell) => cleanText(cell.textContent)).filter(Boolean))
          .filter((row) => row.length > 0);
        if (rows.length) tables.push(rows);
      });

      const lists = Array.from(container.querySelectorAll("li"))
        .map((li) => cleanText(li.textContent))
        .filter(Boolean);

      const textLines = cleanText(container.textContent || "")
        .split(/\n+/)
        .map((line) => cleanText(line))
        .filter(Boolean)
        .slice(0, 200);

      return {
        tables,
        lists,
        text_lines: textLines
      };
    }

    return {
      hires_by_faculty: extractSection(sectionByHeadingFromDoc(["hires by", "faculty"])),
      hires_by_student_work_term_number: extractSection(sectionByHeadingFromDoc(["hires by", "work term"])),
      most_frequently_hired_programs: extractSection(sectionByHeadingFromDoc(["most frequently", "program"]))
    };
  }

  function isSectionEmpty(section) {
    if (!section) return true;
    const hasTable = Array.isArray(section.tables) && section.tables.length > 0;
    const hasList = Array.isArray(section.lists) && section.lists.length > 0;
    const hasLines = Array.isArray(section.text_lines) && section.text_lines.length > 0;
    return !(hasTable || hasList || hasLines);
  }

  function toSectionData(value) {
    if (value == null) return null;

    if (Array.isArray(value)) {
      const lines = value
        .map((item) => cleanText(typeof item === "object" ? JSON.stringify(item) : String(item)))
        .filter(Boolean);
      return {
        tables: [],
        lists: lines,
        text_lines: lines
      };
    }

    if (typeof value === "object") {
      const lines = Object.entries(value)
        .map(([key, val]) => `${cleanText(key)}: ${cleanText(typeof val === "object" ? JSON.stringify(val) : String(val))}`)
        .filter(Boolean);
      return {
        tables: [],
        lists: [],
        text_lines: lines
      };
    }

    const line = cleanText(String(value));
    return {
      tables: [],
      lists: line ? [line] : [],
      text_lines: line ? [line] : []
    };
  }

  function getHiringHistoryFromPosting(postingData) {
    const empty = {
      hires_by_faculty: null,
      hires_by_student_work_term_number: null,
      most_frequently_hired_programs: null
    };
    if (!postingData || typeof postingData !== "object") return empty;

    const patterns = {
      hires_by_faculty: [/faculty/i, /hire/i],
      hires_by_student_work_term_number: [/work\s*term/i, /hire/i],
      most_frequently_hired_programs: [/program/i, /(most|frequent|top)/i]
    };

    const found = {
      hires_by_faculty: null,
      hires_by_student_work_term_number: null,
      most_frequently_hired_programs: null
    };

    const visited = new Set();

    function walk(obj, path = []) {
      if (!obj || typeof obj !== "object") return;
      if (visited.has(obj)) return;
      visited.add(obj);

      if (Array.isArray(obj)) {
        obj.forEach((item, index) => walk(item, path.concat(String(index))));
        return;
      }

      for (const [key, val] of Object.entries(obj)) {
        const keyText = cleanText(key).toLowerCase();
        const pathText = cleanText(path.concat(key).join(" ")).toLowerCase();
        const targetText = `${keyText} ${pathText}`;

        for (const [target, regs] of Object.entries(patterns)) {
          if (found[target]) continue;
          if (regs.every((reg) => reg.test(targetText))) {
            found[target] = toSectionData(val);
          }
        }

        walk(val, path.concat(key));
      }
    }

    walk(postingData, []);
    return found;
  }

  function getExtraFieldsFromOverviewHtml(html) {
    const fields = globalThis.WWExportFields.filter(({ group }) => group !== "Hiring history");
    const out = Object.fromEntries(fields.map(({ field }) => [field, field === "service_team" ? [] : ""]));
    if (!html) return out;

    const doc = new DOMParser().parseFromString(html, "text/html");
    const normalizeLabel = (label) => cleanText(label).toLowerCase().replace(/[^a-z0-9]/g, "");
    const fieldsByLabel = new Map(fields.map(({ field, label }) => [normalizeLabel(label), field]));

    function readText(node) {
      if (node.nodeType === 3) return node.textContent;
      if (node.nodeType !== 1 || /^(SCRIPT|STYLE|BUTTON)$/.test(node.tagName)) return "";
      const text = Array.from(node.childNodes).map(readText).join("");
      return /^(BR|P|DIV|UL|OL|LI|TABLE|TR|TD|TH|H[1-6])$/.test(node.tagName) ? ` ${text} ` : text;
    }

    for (const container of doc.querySelectorAll(".js--question--container")) {
      const label = container.querySelector(".label");
      const field = fieldsByLabel.get(normalizeLabel(label?.textContent || ""));
      if (!field) continue;
      out[field] = cleanText(Array.from(container.childNodes)
        .filter((node) => node !== label)
        .map(readText).join(""));
    }

    for (const panel of doc.querySelectorAll(".panel")) {
      if (normalizeLabel(panel.querySelector("h4")?.textContent || "") !== "serviceteam") continue;
      out.service_team = Array.from(panel.querySelectorAll("tr"))
        .map((row) => Array.from(row.querySelectorAll("th,td")).map((cell) => cleanText(readText(cell))))
        .filter((row) => row.length > 0);
    }
    return out;
  }

  async function attachExtraData(jobs, exportOptions) {
    const includeHiringHistory = exportOptions.includeHiresByFaculty
      || exportOptions.includeHiresByWorkTerm
      || exportOptions.includeFrequentlyHiredPrograms;

    const overviewToken = await getActionToken("getPostingOverview");
    const postingDataToken = includeHiringHistory ? await getActionToken("getPostingData") : "";
    const wtrReportToken = includeHiringHistory ? await getActionToken("getWorkTermRatingReportJson") : "";

    if (!overviewToken) return jobs;

    const postingIds = Array.from(new Set(
      jobs.map((job) => cleanText(job.posting_id)).filter(Boolean)
    ));

    const historyMap = {};
    const extraMap = {};
    const concurrency = 6;
    let index = 0;

    async function worker() {
      while (index < postingIds.length) {
        const currentIndex = index++;
        const postingId = postingIds[currentIndex];

        try {
          const [overviewHtml, postingData] = await Promise.all([
            fetchOverviewHtml(postingId, overviewToken),
            postingDataToken ? fetchPostingJson(postingId, postingDataToken) : Promise.resolve(null)
          ]);

          extraMap[postingId] = getExtraFieldsFromOverviewHtml(overviewHtml);

          const companyId = cleanText(postingData?.divId?.value ?? postingData?.divId ?? "");
          const report = (wtrReportToken && companyId)
            ? await fetchWtrJson(companyId, wtrReportToken)
            : null;

          if (includeHiringHistory) {
            const fromOverview = getHiringHistoryFromHtml(overviewHtml);
            const fromPostingData = getHiringHistoryFromPosting(postingData);
            const fromWtrReport = getHiringHistoryFromWtr(report);

            historyMap[postingId] = {
              hires_by_faculty: fromWtrReport.hires_by_faculty
                || (!isSectionEmpty(fromPostingData.hires_by_faculty)
                  ? fromPostingData.hires_by_faculty
                  : fromOverview.hires_by_faculty),
              hires_by_student_work_term_number: fromWtrReport.hires_by_student_work_term_number
                || (!isSectionEmpty(fromPostingData.hires_by_student_work_term_number)
                  ? fromPostingData.hires_by_student_work_term_number
                  : fromOverview.hires_by_student_work_term_number),
              most_frequently_hired_programs: fromWtrReport.most_frequently_hired_programs
                || (!isSectionEmpty(fromPostingData.most_frequently_hired_programs)
                  ? fromPostingData.most_frequently_hired_programs
                  : fromOverview.most_frequently_hired_programs)
            };
          }
        } catch (_e) {
          extraMap[postingId] = getExtraFieldsFromOverviewHtml("");
          if (includeHiringHistory) {
            historyMap[postingId] = {
              hires_by_faculty: null,
              hires_by_student_work_term_number: null,
              most_frequently_hired_programs: null
            };
          }
        }

        await waitMs(50);
      }
    }

    const workers = [];
    for (let i = 0; i < Math.min(concurrency, postingIds.length); i += 1) {
      workers.push(worker());
    }
    await Promise.all(workers);

    return jobs.map((job) => ({
      ...job,
      ...(includeHiringHistory ? {
        hiring_history: historyMap[job.posting_id] || {
          hires_by_faculty: null,
          hires_by_student_work_term_number: null,
          most_frequently_hired_programs: null
        }
      } : {}),
      ...(extraMap[job.posting_id] || getExtraFieldsFromOverviewHtml(""))
    }));
  }

  function selectExportFields(jobs, exportOptions) {
    const basicFields = [
      "title", "organization", "division", "openings",
      "city", "level", "apps", "app_deadline", "raw_text"
    ];

    return jobs.map((job) => {
      const exportedJob = { posting_id: job.posting_id ?? "" };
      if (exportOptions.includeBasicInfo) {
        basicFields.forEach((field) => { exportedJob[field] = job[field]; });
      }
      for (const { option, field, group } of globalThis.WWExportFields) {
        if (!exportOptions[option]) continue;
        exportedJob[field] = group === "Hiring history"
          ? job.hiring_history?.[field] ?? null
          : job[field] ?? (field === "service_team" ? [] : "");
      }
      return exportedJob;
    });
  }

  async function ensureJobsTable() {
    if (findJobsTable()) return true;

    try {
      if (typeof dataViewerApp !== "undefined" && dataViewerApp) {
        if (typeof dataViewerApp.initSearch === "function") {
          dataViewerApp.initSearch();
        }
        if (dataViewerApp.$dataViewer && typeof dataViewerApp.$dataViewer.refresh === "function") {
          dataViewerApp.$dataViewer.refresh();
        }
      }
    } catch (_e) {}

    await waitUntil(() => findJobsTable() !== null, 6000);
    return findJobsTable() !== null;
  }

  async function exportFilteredJobs(exportOptions, maxPages = 100) {
    const tableReady = await ensureJobsTable();
    if (!tableReady) return { jobs: [], postingIds: [] };

    const exportCurrentPageOnly = exportOptions.includeCurrentPageOnly;
    if (!exportCurrentPageOnly) {
      await goToFirstPage(8);
    }

    const all = [];
    const seen = new Set();
    const pageLimit = exportCurrentPageOnly ? 1 : maxPages;

    for (let page = 1; page <= pageLimit; page += 1) {
      const ok = await ensureJobsTable();
      if (!ok) break;

      const rows = getPageRows();
      if (!rows.length) break;

      for (const row of rows) {
        if (exportOptions.skipAppliedJobs) {
          if (!row.posting_id) throw new Error("Cannot check application status for a job without a posting ID.");
          if (row.has_application === null) {
            throw new Error(`Could not determine application status for posting ${row.posting_id}. Make sure the Job Title column is visible and loaded.`);
          }
          if (row.has_application) continue;
        }
        const key = `${row.posting_id}::${row.title}`;
        if (seen.has(key)) continue;
        seen.add(key);
        all.push(row);
      }

      const firstId = rows[0]?.posting_id || "";
      if (page === pageLimit || !goNextPage()) break;
      await waitPageChange(firstId);
    }

    const enriched = await attachExtraData(all, exportOptions);
    return {
      jobs: selectExportFields(enriched, exportOptions),
      postingIds: Array.from(new Set(
        enriched.map((job) => cleanText(job.posting_id)).filter(Boolean)
      ))
    };
  }

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === "EXPORT_FILTERED_JOBS") {
      (async () => {
        if (isExportingJobs) {
          sendResponse({ success: false, error: "Export already in progress. Please wait for it to finish." });
          return;
        }

        isExportingJobs = true;
        try {
          const exportOptions = request.exportOptions || {
            includeBasicInfo: true,
            includeCurrentPageOnly: false,
            ...Object.fromEntries(globalThis.WWExportFields.map(({ option }) => [option, true]))
          };
          const result = await exportFilteredJobs(exportOptions, 120);
          sendResponse({ success: true, jobs: result.jobs, postingIds: result.postingIds });
        } catch (error) {
          sendResponse({ success: false, error: error?.message || "Export failed in content script." });
        } finally {
          isExportingJobs = false;
        }
      })();
      return true;
    }
    return false;
  });
}

globalThis.bootstrapContentScript = bootstrapContentScript;
