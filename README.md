# WaterlooWorks Toolkit

将 WaterlooWorks JSON 导出器、SQLite 数据库工具和文件夹分类扩展放在同一个仓库，并附带 JSON 拆分、合并与去重工具。

| 工具 | 位置 | 使用方式 |
| --- | --- | --- |
| JSON Exporter | 仓库根目录 | 在 Chrome 扩展管理页加载根目录 |
| 数据库工具 | [job_database](job_database/README.md) | Python 命令行；仅使用标准库 |
| 文件夹分类工具 | [folder-debug-extension](folder-debug-extension/README.md) | 作为另一个 Chrome 扩展加载该目录 |
| JSON 文件处理工具 | [json-tool](json-tool/README.md) | 浏览器打开 `json-tool/index.html` |

## 完整工作流

1. 使用 JSON Exporter 导出当前 WaterlooWorks 筛选结果。
2. 在仓库根目录运行以下命令，创建本地数据库并导入岗位：

   ```powershell
   python job_database/jobdb.py init
   python job_database/jobdb.py import-jobs jobs.json --name first-export --role all
   python job_database/jobdb.py list --batch first-export
   ```

3. 根据岗位筛选结果准备 `{"folders": {"SW": ["岗位ID"], "HW": ["岗位ID"]}}` 分类文件；每个岗位只归入一个文件夹，名称须与 WaterlooWorks 中已有的文件夹完全一致。格式见 [分类示例](folder-debug-extension/example-folder-assignments.json)。数据库可导入并重新导出该格式：

   ```powershell
   python job_database/jobdb.py import-selection categories.json --name first-selection --batch first-export
   python job_database/jobdb.py export-classification --selection first-selection --output folders.json
   ```

4. 在文件夹分类扩展中选择 `folders.json` 并执行分配。

数据库工具保存和查询资料，不会自动筛选岗位、生成排名或提交申请。仓库仅包含源码、测试与示例；实际数据库、个人资料、真实岗位导出和个人筛选结果不随工具发布。

## 验证

需要 Node.js 和 Python 3.10 或更高版本。在仓库根目录执行：

```powershell
node --test options.test.js content_helpers/bootstrapContent.test.js json-tool/splitter-core.test.js folder-debug-extension/content.test.js folder-debug-extension/folder-plan.test.js
python -m unittest discover -s job_database -p "test_*.py" -v
```

## JSON Exporter

Minimal Chrome extension extracted from the larger Enghacks project.

## What it does

- Reads the currently open WaterlooWorks jobs page
- Keeps your current filter selection
- Walks every result page
- Offers `跳过已申请岗位` (off by default) to exclude postings using the search list's applied marker (`check_circle` next to the job title, rendered from `JobTitle.applied`). Ineligible postings remain exportable: their overview response may legitimately omit `hasApplication`. No extra status requests are needed, and excluded jobs are not fetched for further detail. The Job Title column must be visible and loaded so its marker can be read. When every job is excluded, no file is downloaded.
- Exports one JSON file with independently selectable content:
  - Posting ID (always included)
  - Search-result row information (`搜索结果列表信息`): applications and selected list fields. Title, organization, division, openings, city, level, and deadline also require their corresponding content checkbox. `raw_text` is rebuilt using only the selected list values and Posting ID.
  - Job posting information: work term, job type, title, openings, level, region, full address, location arrangement, duration, special requirements, summary, responsibilities, skills, compensation and benefits, and targeted degrees and disciplines
  - Application information: deadline, required documents, additional application information, and application method
  - Company information: organization and division
  - Service team (table rows, each exported as an array of cell values)
  - Individual hiring-history fields: `hires_by_faculty`, `hires_by_student_work_term_number`, and `most_frequently_hired_programs`
- Reads each overview field from its own HTML container, including full descriptions and collapsed targeted-program lists
- Restores checkbox selections from local extension storage whenever the popup opens, and saves each change immediately, including the current-page-only and skip-applied options. Storage is not read or written during job collection. Options without saved values retain their original defaults (all content selected; current-page-only and skip-applied off).
- Unchecking an option omits its optional fields from each job. Posting ID is always included, even when every option is unchecked. Selected fields absent from a posting export as empty strings, an empty array for `service_team`, or `null` for hiring history.

## What was removed

- AI resume analysis
- API key storage
- Resume upload
- Dashboard
- Open job by posting ID
- Open apply by posting ID
- Any injected side panel UI

## Load in Chrome

1. Open `chrome://extensions`
2. Turn on `Developer mode`
3. Click `Load unpacked`
4. Select the cloned repository's root directory (the directory containing `manifest.json`).

## Use

1. Open WaterlooWorks jobs page
2. Apply your desired filter
3. Open the extension popup
4. Choose which job information to include. Select `Export jobs from the current page only` to skip all other result pages, and `跳过已申请岗位` to omit jobs already applied to by the signed-in user.
5. Click `Download Current Filter as JSON`

## Database import contract

See [JSON export handoff](docs/json-export-contract.md) for the current contract, including the mandatory Posting ID, changes introduced by `157e7f2`, missing/empty-value semantics, and importer considerations. A [JSON Schema](docs/job-export.schema.json) and [synthetic examples](docs/examples/all-sections.json) are included for other processes.
