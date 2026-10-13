(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.WaterlooWorksJson = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function validateExport(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new TypeError("JSON 顶层必须是对象。");
    }
    if (!Array.isArray(data.jobs)) {
      throw new TypeError("JSON 必须包含 jobs 数组。");
    }
    if ("posting_ids" in data && !Array.isArray(data.posting_ids)) {
      throw new TypeError("posting_ids 必须是数组。");
    }
    return data;
  }

  function normalizeChunkSize(value) {
    const size = Number(value);
    if (!Number.isSafeInteger(size) || size < 1) {
      throw new RangeError("每个文件的工作数量必须是大于 0 的整数。");
    }
    return size;
  }

  function idsForJobs(source, jobs, start, end) {
    if (Array.isArray(source.posting_ids) && source.posting_ids.length === source.jobs.length) {
      return source.posting_ids.slice(start, end);
    }

    return Array.from(new Set(
      jobs
        .map((job) => job && typeof job === "object" ? job.posting_id : undefined)
        .filter((id) => id !== undefined && id !== null && String(id).trim() !== "")
    ));
  }

  function splitExportData(input, chunkSize) {
    const source = validateExport(input);
    const size = normalizeChunkSize(chunkSize);
    const parts = [];

    for (let start = 0; start < source.jobs.length; start += size) {
      const jobs = source.jobs.slice(start, start + size);
      parts.push({
        ...source,
        total_jobs: jobs.length,
        posting_ids: idsForJobs(source, jobs, start, start + size),
        jobs
      });
    }

    return parts;
  }

  function mergeExportData(inputs) {
    if (!Array.isArray(inputs) || inputs.length < 2) {
      throw new RangeError("请至少选择两个 JSON 文件。");
    }

    const sources = inputs.map(validateExport);
    const mergedJobs = [];
    const mergedIds = [];
    const seenIds = new Set();
    let duplicateCount = 0;

    sources.forEach((source, fileIndex) => {
      if (!Array.isArray(source.posting_ids)) {
        throw new TypeError(`第 ${fileIndex + 1} 个文件缺少 posting_ids 数组。`);
      }
      if (source.posting_ids.length !== source.jobs.length) {
        throw new RangeError(`第 ${fileIndex + 1} 个文件的 posting_ids 与 jobs 数量不一致。`);
      }

      source.posting_ids.forEach((id, jobIndex) => {
        const key = String(id == null ? "" : id).trim();
        if (!key) {
          throw new TypeError(`第 ${fileIndex + 1} 个文件包含空的工作 ID。`);
        }
        if (seenIds.has(key)) {
          duplicateCount += 1;
          return;
        }

        seenIds.add(key);
        mergedIds.push(id);
        mergedJobs.push(source.jobs[jobIndex]);
      });
    });

    return {
      data: {
        ...sources[0],
        total_jobs: mergedJobs.length,
        posting_ids: mergedIds,
        jobs: mergedJobs
      },
      duplicateCount
    };
  }

  function deleteMatchingJobs(input, field, query) {
    const source = validateExport(input);
    const searchField = String(field || "all");
    const searchText = String(query || "").trim().toLocaleLowerCase();
    if (!searchText) {
      throw new RangeError("请输入要查找的文本。");
    }
    if (Array.isArray(source.posting_ids) && source.posting_ids.length !== source.jobs.length) {
      throw new RangeError("posting_ids 与 jobs 数量不一致，无法安全删除条目。");
    }

    const hasAlignedIds = Array.isArray(source.posting_ids);
    const keptJobs = [];
    const keptIds = [];
    let deletedCount = 0;

    source.jobs.forEach((job, index) => {
      const postingId = hasAlignedIds ? source.posting_ids[index] : job?.posting_id;
      const value = searchField === "all"
        ? `${postingId ?? ""} ${JSON.stringify(job)}`
        : searchField === "posting_id"
          ? postingId
          : job?.[searchField];
      const matches = String(value ?? "").toLocaleLowerCase().includes(searchText);

      if (matches) {
        deletedCount += 1;
        return;
      }
      keptJobs.push(job);
      if (postingId !== undefined && postingId !== null && String(postingId).trim() !== "") {
        keptIds.push(postingId);
      }
    });

    return {
      data: {
        ...source,
        total_jobs: keptJobs.length,
        posting_ids: keptIds,
        jobs: keptJobs
      },
      deletedCount
    };
  }

  function removeJobsFoundInReference(referenceInput, targetInput) {
    const reference = validateExport(referenceInput);
    const target = validateExport(targetInput);

    [reference, target].forEach((source, index) => {
      const label = index === 0 ? "基准文件" : "待清理文件";
      if (!Array.isArray(source.posting_ids)) {
        throw new TypeError(`${label}缺少 posting_ids 数组。`);
      }
      if (source.posting_ids.length !== source.jobs.length) {
        throw new RangeError(`${label}的 posting_ids 与 jobs 数量不一致。`);
      }
      if (source.posting_ids.some((id) => !String(id ?? "").trim())) {
        throw new TypeError(`${label}包含空的工作 ID。`);
      }
    });

    const referenceIds = new Set(reference.posting_ids.map((id) => String(id).trim()));
    const keptIds = [];
    const keptJobs = [];
    let duplicateCount = 0;

    target.posting_ids.forEach((id, index) => {
      if (referenceIds.has(String(id).trim())) {
        duplicateCount += 1;
        return;
      }
      keptIds.push(id);
      keptJobs.push(target.jobs[index]);
    });

    return {
      data: {
        ...target,
        total_jobs: keptJobs.length,
        posting_ids: keptIds,
        jobs: keptJobs
      },
      duplicateCount
    };
  }

  function keepJobsByIds(input, requestedIds) {
    const source = validateExport(input);
    if (!Array.isArray(source.posting_ids)) {
      throw new TypeError("文件缺少 posting_ids 数组。");
    }
    if (source.posting_ids.length !== source.jobs.length) {
      throw new RangeError("posting_ids 与 jobs 数量不一致。");
    }

    const rawIds = Array.isArray(requestedIds)
      ? requestedIds
      : String(requestedIds || "").split(/[\s,，;；]+/);
    const normalizedIds = rawIds.map((id) => String(id ?? "").trim()).filter(Boolean);
    const requested = new Set(normalizedIds);
    if (!requested.size) {
      throw new RangeError("请至少输入一个要保留的工作 ID。");
    }

    const keptIds = [];
    const keptJobs = [];
    const matchedIds = new Set();

    source.posting_ids.forEach((id, index) => {
      const key = String(id ?? "").trim();
      if (!requested.has(key)) return;
      keptIds.push(id);
      keptJobs.push(source.jobs[index]);
      matchedIds.add(key);
    });

    return {
      data: {
        ...source,
        total_jobs: keptJobs.length,
        posting_ids: keptIds,
        jobs: keptJobs
      },
      requestedCount: requested.size,
      matchedCount: keptJobs.length,
      missingIds: Array.from(requested).filter((id) => !matchedIds.has(id))
    };
  }

  function partFilename(originalName, partIndex, partCount) {
    const base = String(originalName || "waterlooworks_jobs.json").replace(/\.json$/i, "");
    const width = Math.max(2, String(partCount).length);
    return `${base}_part_${String(partIndex + 1).padStart(width, "0")}_of_${String(partCount).padStart(width, "0")}.json`;
  }

  return {
    validateExport,
    normalizeChunkSize,
    splitExportData,
    mergeExportData,
    deleteMatchingJobs,
    removeJobsFoundInReference,
    keepJobsByIds,
    partFilename
  };
});
