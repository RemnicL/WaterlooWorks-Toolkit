# Database Import Handoff: JSON Export Contract

This document describes **current exporter behavior**, including the sections added in commit `157e7f2` and subsequent changes making Posting ID mandatory, renaming the search-result option, and persisting checkbox selections. Exported JSON does not contain a version number.

`posting_id` is required in every job record and is no longer controlled by a checkbox. The former basic-information option now covers search-result row information (`includeBasicInfo`). Even with that option enabled, title, organization, division, openings, city, level, and deadline require their corresponding content options. Application count (`apps`) follows the row-information option; `raw_text` is rebuilt from the ID and selected list values only. All checkbox choices, including current-page-only, are saved in local extension storage and restored when the popup opens. Options without saved values retain their original defaults.

The skip-applied option (`skipAppliedJobs`) is off by default and is also remembered. When enabled, the exporter reads the `check_circle` marker next to each job title, controlled by `JobTitle.applied`, and excludes applied jobs before fetching details. `jobs`, `posting_ids`, and `total_jobs` describe retained jobs only. Being ineligible and having applied are different states: posting 493499 can legitimately return `applicationData: {"canApply": false}` without `hasApplication`, without stopping the export or excluding that posting. The Job Title column must be visible and loaded. An unrecognizable title column or missing posting ID causes an export error. If every posting is excluded, no empty file is downloaded. This option adds no fields such as `has_applied` and changes no field types. Importers must not interpret omitted postings as deletion instructions: they may simply have been filtered out.

## Handoff instructions for another process

Provide the following instructions, together with access to the files in this directory, to a process responsible for database import:

> Review the WaterlooWorks importer against `docs/json-export-contract.md` and `docs/job-export.schema.json`. Compare `docs/examples/all-sections.json`, `docs/examples/selected-sections.json`, and `docs/examples/id-only.json` to understand full, partial, and ID-only exports. The top-level structure is unchanged; the job format expanded from 18 to 40 fields. `posting_id` is always present, while the other 39 fields may be omitted when their options are unchecked. Preserve string IDs and distinguish missing properties, empty strings, empty arrays, and null so partial imports do not accidentally clear stored data. Identify jobs by each record's nonempty `posting_id`; do not pair `posting_ids` and `jobs` by array position. Inspect the existing database and importer before deciding field mappings or migrations. Verify new fields, long text, structured hiring history, and partial updates. This document describes exporter behavior; consult the database tool's own documentation for its implemented import policy.

## Machine-readable materials

- [`job-export.schema.json`](job-export.schema.json): JSON Schema Draft 2020-12 covering the current 40 job fields and their types.
- `x-export-option` identifies a field's checkbox when a single option controls it. Paired list fields use `x-export-requires` to identify both required options: `includeBasicInfo` and the corresponding content option. `posting_id` has `x-always-exported: true` and no checkbox.
- `x-change: added` identifies fields introduced by the section expansion; `existing` identifies earlier fields. These are schema annotations and do not appear in exported data.
- [`examples/all-sections.json`](examples/all-sections.json): a synthetic 40-field example with every content option enabled.
- [`examples/selected-sections.json`](examples/selected-sections.json): only row information, job summary, and service team are selected. The output includes the ID, `apps`, filtered `raw_text`, summary, and service team. Unselected list and detail fields such as title, city, and level are absent.
- [`examples/id-only.json`](examples/id-only.json): a synthetic example containing only `posting_id` after every content option is unchecked.
- Examples contain no real postings or personal information and must not be imported as real production records.

The schema's `additionalProperties: false` detects fields outside this snapshot; it does not promise that the format will never expand. Each job must contain `posting_id`, but the schema still permits an empty string if the source page supplied no ID. Structural validation alone does not satisfy database identity requirements. The schema cannot verify matching counts, record identity, or update policy. Older files that omit `posting_id` do not satisfy the current required-field constraint.

## Top-level structure

```json
{
  "total_jobs": 1,
  "posting_ids": ["EXAMPLE-001"],
  "jobs": [{ "posting_id": "EXAMPLE-001" }]
}
```

| Property | JSON type | Meaning |
| --- | --- | --- |
| `total_jobs` | integer | `jobs.length`, rather than the number of unique IDs; the extension does not download empty results |
| `posting_ids` | string[] | Nonempty IDs, deduplicated in traversal order; retained even when row information is disabled |
| `jobs` | object[] | Each record contains `posting_id` and selected fields; disabling all content options leaves the ID rather than `{}` |

Exports contain no `schema_version`, `exportOptions`, scrape-success flag, observation timestamp, or field-error status. A missing field alone does not identify an older export, because current options can also omit it.

## Field changes

The original 18 fields retain their names and JSON types. The expansion added 22 fields: 21 strings and the two-dimensional string array `service_team`. All content options are enabled by default, so a complete record normally contains 40 properties.

### Existing list information: 10 strings, with ID always included

`posting_id`, `title`, `organization`, `division`, `openings`, `city`, `level`, `apps`, `app_deadline`, `raw_text`.

These fields come from the search-result list. `posting_id` is always included. `includeBasicInfo` controls the remaining list fields, and the seven fields paired with detail values also require their content options. `apps` requires only the list option. `raw_text` is rebuilt from the ID and selected list values rather than unconditionally copying the whole row. Counts such as `openings` and `apps` remain display strings, not JSON numbers. IDs remain strings; a missing source ID is exported as `""`.

### Existing details: 5 independently controlled strings

`work_term_duration`, `special_job_requirements`, `required_skills`, `job_responsibilities`, `job_summary`.

- `work_term_duration` was previously unconditional and now follows `includeWorkTermDuration`; disabling the option omits the property.
- The other four fields retain their existing options. Selected fields without retrieved content explicitly export `""`. Earlier code could omit them during serialization when the entire detail response was missing and their values were `undefined`.
- Extraction now uses each field's HTML container rather than regular expressions over the whole page. The earlier limits of 1,200 characters for descriptions and 150 characters for duration no longer apply.
- Text may therefore be longer, more complete, or different because field boundaries are separated correctly. Content is converted to plain text with normalized whitespace; paragraphs and lists are not preserved as HTML or separate arrays.

### Added details: 21 strings

| Field | Meaning |
| --- | --- |
| `work_term` | Work term |
| `job_type` | Job type |
| `job_title` | Title from the posting overview |
| `number_of_job_openings` | Opening count from the overview, as a string |
| `job_level` | Overview level, combined as text |
| `region` | Region |
| `job_address_line_one` | First address line |
| `job_address_line_two` | Second address line |
| `job_city` | City from the overview |
| `job_province_state` | Province or state |
| `job_postal_zip_code` | Postal or ZIP code |
| `job_country` | Country |
| `employment_location_arrangement` | Original display text for on-site, remote, hybrid, or other arrangements |
| `compensation_and_benefits` | Full compensation and benefits text, not a parsed monetary amount |
| `targeted_degrees_and_disciplines` | Plain text including collapsed program lists; may include headings such as Targeted Clusters |
| `application_deadline` | Deadline display text from the overview |
| `application_documents_required` | Required-document display text, often comma-separated; still a string rather than an array |
| `additional_application_information` | Full additional application information |
| `application_method` | Application method display text |
| `company_organization` | Organization from the overview |
| `company_division` | Division from the overview |

Each property is independently optional. Selected properties without retrieved content export as `""`.

### Added service team: `service_team`

```json
{
  "service_team": [["EEM", "Example staff member"]]
}
```

The type is `string[][]`: each inner array represents a table row, and each string represents a cell. Row and column order follow the page. The exporter does not guarantee two columns or convert rows to `{role, name, phone}`. Missing retrieved content exports as `[]`; disabling the option omits the property.

### Existing hiring history: 3 independently controlled objects or null

`hires_by_faculty`, `hires_by_student_work_term_number`, `most_frequently_hired_programs`.

These remain direct job properties, with no new `hiring_history` wrapper. Their contents depend on the source:

- Report data may contain `title`, `description`, `columns`, `rows`, `series`, `categories`, `value`, or `data`. Chart and table values have no single guaranteed internal type.
- Page or posting data may use `{ "tables": [], "lists": [], "text_lines": [] }`.
- Unavailable data exports as `null`; disabling an option omits its property.

The section expansion did not standardize these structures. Preserve their original JSON rather than assuming a fixed chart or numeric-table format.

## Import semantics

### Missing properties and empty values are distinct

| JSON state | Exporter meaning | Import policy to define |
| --- | --- | --- |
| Missing property | The optional field was not selected; some older exports also omitted unavailable fields. Current `posting_id` is never omitted by a checkbox | Preserve the stored value during partial updates |
| `""` | A string field was selected, but its content was empty or not retrieved | Distinguish it from an unselected field and explicitly decide whether it may clear old data |
| `[]` | Service team was selected, but no rows were retrieved | Do not infer that the company has no service team; define an overwrite policy |
| `null` | Hiring history was selected, but no data was retrieved | Do not interpret it as zero hires; define an overwrite policy |

Some retrieval failures produce the same empty values as genuinely empty page content, without recording the failure in JSON. Empty values therefore do not confirm a deletion. The bundled database tool's implemented merge policy is described in its [partial-field import guide](../job_database/README.md#enrich-a-batch-with-partial-fields).

### Identify jobs by each record's `posting_id`

`jobs[i].posting_id` is retained even when row information is disabled. Importers should require a nonempty string, avoid using the title as a primary key, and preserve IDs without numeric conversion.

The exporter deduplicates `jobs` using `posting_id + title`, while `posting_ids` deduplicates nonempty IDs alone. Empty IDs or one ID with different list titles can therefore produce arrays of different lengths. `posting_ids[i]` is not guaranteed to identify `jobs[i]`. Reject or isolate records with missing IDs rather than guessing by position. Report or explicitly resolve multiple job records sharing one ID.

### List values and overview values have different sources

The following pairs come from different locations and may differ. Each pair shares its content option: disabling that option omits both values; enabling it includes the overview value, while the list value additionally requires `includeBasicInfo`. `raw_text` follows the same selection.

| List field | Overview field |
| --- | --- |
| `title` | `job_title` |
| `openings` | `number_of_job_openings` |
| `level` | `job_level` |
| `city` | `job_city` |
| `app_deadline` | `application_deadline` |
| `organization` | `company_organization` |
| `division` | `company_division` |

An importer may preserve both values or define an explicit mapping priority; similar names alone do not justify overwriting one with the other. Dates remain display text such as `Oct 21, 2026 9:00 AM`, without ISO formatting or a guaranteed timezone. Counts, levels, disciplines, documents, and compensation are not automatically normalized either.

## Importer acceptance checklist

1. Accept all 40 fields in the full example without silently discarding added fields.
2. Apply an explicit partial-update policy when importing the selected-fields example over existing records.
3. Distinguish missing properties, `""`, `[]`, and `null`.
4. Preserve descriptions longer than 1,200 characters without old database, validator, or importer truncation.
5. Store `service_team` as a two-dimensional array and preserve variable hiring-history JSON structures.
6. Explicitly handle missing or empty per-record IDs, duplicate IDs, and arrays that do not align.
7. Avoid unvalidated type coercion of IDs, display dates, counts, and compensation.

This document defines the exporter contract and importer considerations. Refer to the [database guide](../job_database/README.md) and its tests for the bundled importer's behavior and migration support.
