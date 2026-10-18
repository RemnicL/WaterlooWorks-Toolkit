# WaterlooWorks 数据库工具

使用 SQLite 保存岗位快照、筛选与分类集合、排序分析、个人资料版本及申请状态。仅依赖 Python 3.10+ 标准库，无需数据库服务器或第三方包。

本目录从原本地数据库项目提取工具源码、Schema、测试和合成示例，不包含真实数据库、个人排名、筛选报告或依赖原始个人资料的 `bootstrap.py`。首次使用需要初始化并导入自己的资料。下列命令均从仓库根目录执行。

## 初始化与导入

```powershell
python job_database/jobdb.py init
python job_database/jobdb.py import-jobs jobs.json --name first-export --role all
python job_database/jobdb.py stats
python job_database/jobdb.py list --batch first-export
python job_database/jobdb.py show 900000001 --batch first-export
```

默认数据库为 `job_database/applications.sqlite3`，已加入 Git 忽略规则。指定其他文件时，将 `--db 路径` 放在子命令之前，例如 `python job_database/jobdb.py --db other.sqlite3 init`。初始化不会导入示例资料。

岗位格式见 [导出契约](../docs/json-export-contract.md)、[Schema](job-export.schema.json) 和 [合成示例](fixtures/all-sections.json)。按每条记录的非空字符串 `posting_id` 识别岗位，保留前导零；不按顶层数组位置配对。类型错误、重复 ID、未知字段或不一致的计数会拒绝导入。

每份导出保存为独立命名批次。同名同源导入不增加记录；内容或元数据变化时需使用新名称。未指定基础批次时，不会自动合并其他批次或删除旧资料。

## 部分字段补充

```powershell
python job_database/jobdb.py import-jobs selected_sections.json --name enriched --base-batch first-export --role candidate
python job_database/jobdb.py show 900000001 --batch enriched
```

此操作创建新批次，保留基础批次所有岗位，再补充或新增本次岗位。属性缺失、空字符串、空数组、null 不清除已有值；非空字段更新对应字段。原始输入完整保留，可通过 `source_job`、`source_field_states` 和 `base_batch` 追溯。派生批次不自动复制排名、分类或申请记录。

```powershell
python job_database/jobdb.py export-jobs --batch enriched --output enriched.json
python job_database/jobdb.py export-jobs --batch enriched --raw --output enrichment_input.json
```

普通导出包含合并后的字段；`--raw` 导出本次原始输入。输出路径必须尚不存在。

## 筛选和文件夹分类

```powershell
python job_database/jobdb.py import-selection major_ids.json --name major --batch first-export --kind major
python job_database/jobdb.py export-jobs --batch first-export --exclude-selection major --output nonmajor.json
python job_database/jobdb.py import-selection selected_ids.json --name screened --batch first-export --kind screened
python job_database/jobdb.py export-jobs --batch first-export --include-selection major --include-selection screened --output candidates.json
```

筛选输入接受岗位导出、`{"posting_ids": ["900000001"]}` 或 ID 数组。集合成员需存在于关联批次。多次 `--include-selection` 取并集并去重。

文件夹分类使用 `{"folders": {"SW": ["900000001"], "HW": []}}` 格式：

```powershell
python job_database/jobdb.py import-selection categories.json --name folders --batch first-export --kind classification
python job_database/jobdb.py export-classification --selection folders --output folders.json
```

导出保留类别及类别内 ID 顺序，可交给 [文件夹分类扩展](../folder-debug-extension/README.md)。扩展要求文件夹已存在且名称完全匹配，每个岗位只能出现一次。

## 排名、个人资料和申请状态

```powershell
python job_database/jobdb.py save-facts RESUME_FACTS.md --name facts-v1
python job_database/jobdb.py import-ranking ranking.txt --name ranking-v1 --batch first-export --facts-version facts-v1
python job_database/jobdb.py list --batch first-export --analysis ranking-v1 --selection folders --category SW
python job_database/jobdb.py show 900000001 --batch first-export --facts RESUME_FACTS.md
```

仅在分析确实使用该资料版本时指定 `--facts-version`。排名必须从 1 连续递增、ID 唯一且存在于指定批次。支持的 TXT 格式如下，分数是比较指标而非录用概率：

```text
001. Job ID 900000001 | 示例职位 | 示例公司
建议：建议申请 | 机会优先分：80/100（非概率） | 匹配度：4.1/5
原因：具体匹配理由和待确认条件。
建议文书：05 电子硬件／半导体／板卡验证（简历＋求职信）
```

只有确认实际投递后才记录 `submitted`；导入岗位、分类或排名不会自动产生投递记录：

```powershell
python job_database/jobdb.py status 900000001 --batch first-export --state submitted --resume resume.pdf --notes "已手动投递"
```

状态包括 `unknown`、`planned`、`submitted`、`interview`、`offer`、`rejected`、`withdrawn`、`skipped`。默认未知不能理解为未投递。可用 `--submitted-at` 指定含时区偏移的真实投递时间；未指定的时间、材料路径和备注在更新时保留。

## 测试与备份

```powershell
python -m unittest discover -s job_database -p "test_*.py" -v
python job_database/jobdb.py --help
```

测试使用临时数据库和合成资料。当前结构版本为 2；已有 v1 数据库可先运行 `init` 完成迁移。备份前关闭数据库写入程序，再复制 SQLite 文件；关联的简历和求职信需单独保存。
