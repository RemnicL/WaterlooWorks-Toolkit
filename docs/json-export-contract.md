# 数据库导入交接：JSON 导出结构变更

本文描述功能提交 `157e7f2`（相对于其父提交）的**实际输出行为**。交接材料本身不修改导出器，也不在 JSON 中加入版本号。

## 给另一个进程的任务说明

可以直接将下面这段话交给负责数据库导入的进程，并让它访问同目录中的文件：

> 请根据 `docs/json-export-contract.md` 和 `docs/job-export.schema.json`，检查并更新 WaterlooWorks JSON 的数据库导入逻辑。对照 `docs/examples/all-sections.json` 与 `docs/examples/selected-sections.json` 理解全量字段和部分字段的区别。顶层结构不变，职位最多由 18 个字段扩展为 40 个；所有职位字段都可能因取消勾选而缺失，`work_term_duration` 现在也可省略。保留字符串 ID，区分属性缺失、空字符串、空数组和 null，避免部分导入意外清空已有数据。不要将 `posting_ids` 与 `jobs` 按下标强行配对；需要每条记录的 `posting_id` 才能可靠地按职位导入。请先检查现有数据库和导入器，再确定字段映射与迁移，并验证新增字段、长文本、结构化招聘历史和部分字段更新。这里描述的是导出端事实；后文的数据库处理策略是建议，尚未在导入端实现。

## 机器可读材料

- `job-export.schema.json`：JSON Schema Draft 2020-12，覆盖当前 40 个职位字段及类型。
- 每个职位属性的 `x-export-option` 标注对应复选框；`includeBasicInfo` 同时控制十个列表字段。
- `x-change` 为 `added` 的是此次新增字段，为 `existing` 的是既有字段。两者是 Schema 注解，不会出现在导出数据中。
- `examples/all-sections.json`：开启所有内容选项的合成示例，包含 40 个字段。
- `examples/selected-sections.json`：仅开启基本信息、职位简介、服务团队的合成示例。未选择的字段直接缺失。
- 示例不包含真实职位或个人信息，不应作为真实数据导入生产库。

Schema 的 `additionalProperties: false` 用来发现不属于本次快照的字段，不代表导出格式永远不会增加字段。职位对象没有必填属性；结构验证通过不等于满足数据库导入条件。Schema 也不能验证 `total_jobs` 与数组长度相等、职位身份匹配或更新策略。

## 顶层结构保持不变

```json
{
  "total_jobs": 1,
  "posting_ids": ["EXAMPLE-001"],
  "jobs": [{ "posting_id": "EXAMPLE-001" }]
}
```

| 属性 | JSON 类型 | 实际含义 |
| --- | --- | --- |
| `total_jobs` | integer | `jobs.length`，不是唯一职位 ID 的数量；扩展界面不会下载空结果 |
| `posting_ids` | string[] | 遍历顺序下去重后的非空职位 ID；关闭基本信息仍会保留此列表 |
| `jobs` | object[] | 每个职位的已选字段；可出现 `{}` |

导出数据中仍没有 `schema_version`、`exportOptions`、抓取成功标记、来源时间或字段错误状态。不能仅凭某个新字段缺失判断文件来自旧版，因为新版也允许取消该字段。

## 字段变化清单

既有 18 个字段未重命名、未删除，JSON 类型不变。新增 22 个字段，其中 21 个是字符串，`service_team` 是二维字符串数组。默认开启全部内容选项，因此正常完整记录现在有 40 个属性。

### 既有基本信息：10 个字符串，共用 `includeBasicInfo`

`posting_id`、`title`、`organization`、`division`、`openings`、`city`、`level`、`apps`、`app_deadline`、`raw_text`。

这些字段来自搜索结果列表。数量字段 `openings`、`apps` 仍是显示文本，不是 JSON 数值。ID 仍是字符串。

### 既有详情：5 个字符串，分别控制

`work_term_duration`、`special_job_requirements`、`required_skills`、`job_responsibilities`、`job_summary`。

- `work_term_duration` 以前无条件导出，现在受 `includeWorkTermDuration` 控制，取消后属性缺失。
- 其余四项继续使用原有选项。选中但没有取到值时，现在明确输出 `""`；旧代码在详情数据完全缺失时，可能因为值为 `undefined` 而在 JSON 序列化时省略它们。
- 提取方式从整页文本正则改为各自的 HTML 字段容器。旧的职责、技能、简介、特殊要求曾最多捕获 1200 个字符，工期最多捕获 150 个字符；现在没有这些人为长度限制。
- 因而同名字段的文本可能比以前更长、更完整，也可能因字段边界正确分离而不同。正文转换为纯文本并合并空白，列表与段落不保留为 HTML 或独立数组。

### 新增详情：21 个字符串

| 新字段 | 含义 |
| --- | --- |
| `work_term` | 工作学期 |
| `job_type` | 职位类型 |
| `job_title` | 详情中的职位名称 |
| `number_of_job_openings` | 详情中的招聘人数，字符串 |
| `job_level` | 详情中的级别，合并为文本 |
| `region` | 地区 |
| `job_address_line_one` | 地址第一行 |
| `job_address_line_two` | 地址第二行 |
| `job_city` | 详情中的城市 |
| `job_province_state` | 省或州 |
| `job_postal_zip_code` | 邮政编码 |
| `job_country` | 国家 |
| `employment_location_arrangement` | 现场、远程、混合等安排的原始显示文本 |
| `compensation_and_benefits` | 薪酬福利全文，不是解析后的金额 |
| `targeted_degrees_and_disciplines` | 目标学位与专业的纯文本，包含折叠列表内容；可能包含 Targeted Clusters 等标题 |
| `application_deadline` | 详情中的申请截止时间显示文本 |
| `application_documents_required` | 申请材料显示文本，常以逗号分隔，仍不是数组 |
| `additional_application_information` | 额外申请信息全文 |
| `application_method` | 申请方式显示文本 |
| `company_organization` | 详情中的公司名称 |
| `company_division` | 详情中的部门 |

这些属性全部独立可选。选中但没有取到内容时为 `""`。

### 新增服务团队：`service_team`

```json
{
  "service_team": [["EEM", "Example staff member"]]
}
```

数据类型是 `string[][]`，每个内部数组对应表格的一行，每个字符串对应单元格。行列顺序来自页面；代码没有保证固定两列，也没有转换成 `{role, name, phone}`。没有取得内容时为 `[]`，取消选项时整个属性缺失。

### 既有招聘历史：3 个 object 或 null，分别控制

`hires_by_faculty`、`hires_by_student_work_term_number`、`most_frequently_hired_programs`。

它们仍直接位于职位对象内，**没有**新增 `hiring_history` 包装层。内部内容依赖原有数据来源：

- 报表来源可能有 `title`、`description`、`columns`、`rows`、`series`、`categories`、`value`、`data`；图表及表格内部值没有统一类型保证。
- 页面或职位数据来源可能是 `{ "tables": [], "lists": [], "text_lines": [] }`。
- 没有取得数据时为 `null`；取消选项时属性缺失。

本次修改未统一这些历史结构。建议导入时保留原始 JSON，不要假定它们始终是同一种图表或数值表。

## 数据库导入必须理解的语义

### 属性缺失与空值不是同一个状态

| JSON 状态 | 导出端含义 | 建议的导入处理，尚未实现 |
| --- | --- | --- |
| 属性缺失 | 用户未选中该字段；部分旧版数据也可能省略未取得的字段 | 部分更新时保留数据库原值，不因缺失而清空 |
| `""` | 已选择字符串字段，但内容为空或未成功取得 | 与“未选择”分开处理；是否清空旧值需要明确策略 |
| `[]` | 已选择服务团队，但没有取得表格行 | 不据此证明公司没有服务团队；明确覆盖策略 |
| `null` | 已选择招聘历史，但没有取得数据 | 不当成招聘人数为零；明确覆盖策略 |

当前抓取链路会在某些失败情况下输出与“页面没有内容”相同的空值，而且不会在 JSON 中注明失败。因此不能把空值当成已经确认的数据删除操作。

### 按每条记录的 `posting_id` 识别职位

数据库导入建议要求开启 Basic job information，并检查每个 `jobs[i].posting_id` 是非空字符串。不要用职位名称作为主键，不要把 ID 转成数值。

`jobs` 使用 `posting_id + title` 去重，`posting_ids` 则只按非空 ID 去重。因此遇到空 ID，或同一 ID 对应不同列表标题时，两者长度可能不同，不能保证 `posting_ids[i]` 就是 `jobs[i]` 的 ID。若记录缺少 `posting_id`，建议隔离或拒绝该记录，不按顶层数组下标猜测。若同一 ID 有多份职位对象，导入器应报告或明确处理冲突。

### 列表值与详情值是不同来源

以下属性是并存字段，不是改名或替换关系，也不保证内容相同：

| 列表字段 | 详情字段 |
| --- | --- |
| `title` | `job_title` |
| `openings` | `number_of_job_openings` |
| `level` | `job_level` |
| `city` | `job_city` |
| `app_deadline` | `application_deadline` |
| `organization` | `company_organization` |
| `division` | `company_division` |

导入端可以保留两份来源值，或制定明确的映射优先级；不应仅因名称相似就覆盖既有属性。日期是显示文本，例如 `Oct 21, 2026 9:00 AM`，没有 ISO 格式或时区保证；数字、级别、专业、材料、薪酬也没有自动规范化。

## 导入端验收清单

1. 全选示例的 40 个字段均可接收；新增字段不会被静默丢弃。
2. 部分字段示例导入已有记录时，未提供的字段按明确的部分更新策略处理。
3. 缺失、`""`、`[]`、`null` 四种状态能被区分。
4. 超过 1200 字符的描述可以完整存储；数据库、验证器和导入代码均无旧长度截断。
5. `service_team` 按二维数组处理，招聘历史保留可变结构的原始 JSON。
6. 缺失或为空的逐条 ID、重复 ID、数组不对齐等情况会被明确处理。
7. ID、显示日期、数量、薪酬等不会被不加验证地强制转型。

本次仅提供交接契约、结构描述和示例；尚未检查或修改下游数据库，也未执行数据库迁移。
