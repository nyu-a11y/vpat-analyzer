# Domain model

## Identity rules

Runtime joins use immutable, versioned primary IDs. Display numbers, criterion labels, source row positions, workbook `ReqID` values, and historic names are aliases only. Leading-number string matching is forbidden because it can conflate criteria, include non-WCAG standards, and break when labels change.

## Core entities

### AnalysisRequest

- `requestId`: stable opaque ID for one selected source and its retry lineage.
- `sourceRef`: non-secret Drive reference available only at the integration boundary; it is not retained in committed fixtures or a central history system.
- `status`: current state-machine value.
- `attempts`: bounded attempt counters by operation, not a source of new request identity.
- `contractVersions`: catalog, rubric, scoring, prompt, schema, and export-model versions.
- `createdAt` / `updatedAt`: integration timestamps; deterministic tests inject a clock.

A new document selection creates a new request ID. Retrying provider analysis or export keeps the existing request ID. A duplicate command is rejected or returns the existing state/receipt.

### SourceDescriptor

- Literal display name, Drive MIME/type classification, byte size when available, and access status.
- Detected VPAT template version and declared WCAG versions/levels.
- Eligibility or a stable rejection code.

V1 accepts one VPAT 2.5 Google Doc, DOCX, or text-searchable PDF from Drive. It excludes OCR, local upload, body prose, non-WCAG tables, and complete binary/image AI payloads.

### IngestionResult

- `requestId`, source type, parser version, and terminal `complete` or `rejected` status.
- Ordered `CandidateTable` records and normalized `ExtractedWcagRow` records.
- Stable rejection code and safe diagnostic details for inaccessible, unsupported, insufficient-text, image-only, malformed, encrypted, missing-table, or ambiguous input.

An ingestion rejection is operational and cannot create a quality result or grade. Stage 0 defines this entity while the real-format Apps Script/HtmlService path remains blocked.

### WcagCriterion

- Primary ID: `wcag-sc-{number}`, for example `wcag-sc-1.1.1`.
- Official SC number and title, level, `introducedIn`, supported-version activity metadata, and optional retirement metadata.

The committed catalog is the 87-item union of WCAG 2.0, 2.1, and 2.2 success criteria, including 4.1.1. It retains A, AA, and AAA criteria and excludes Section 508 and EN criteria.

### ExtractedWcagRow

- Stable row ID local to the immutable ingestion result.
- `criterionId` resolved through explicit aliases to a catalog ID.
- Literal source criterion label, conformance term, remarks/evidence, table index, and row index.
- Resolution status: matched, duplicate, missing, or ambiguous.

Unmatched or ambiguous labels are never guessed by an AI or leading-number heuristic.

### ConformanceFinding

- `criterionId`, normalized conformance value, literal source evidence, explanation, confidence from 0–100, and `Complete` or `Incomplete` status.
- Incomplete reason when missing, malformed, low-contract-validity, or provider interrupted.

Conformance terminology is distinct from the report-quality rubric. A source statement such as `Does Not Support` is not an operational quality failure.

### QualityRequirement

- Stable primary ID such as `qr-e12`.
- Numeric/live and broader-rubric aliases, title, concise description/guidance, `Essential` or `Best Practice` type, impact weight from 2–5, and impact label.

There are exactly 16 canonical requirements. One blank broader-workbook `ReqID` is recorded as a source anomaly and never used as a primary ID.

### QualityFinding

- `requirementId`, result `Pass`, `Fail`, or `Incomplete`, evidence, guidance, confidence, and incomplete reason when applicable.
- Only a completed evaluation may be `Pass` or `Fail`.

Missing results, provider failures, ingestion failures, and export failures are never `Fail`.

### ScoreSummary

- Applicable completed weight earned and possible, integer percentage, and optional grade.
- Default confidence review threshold: 70.
- Bands: F ≤60; D 61–69; C 70–79; B 80–89; A- 90–94; A 95–100.

Any required operationally incomplete analysis has status `Incomplete` and `grade: null`; partial arithmetic must not be presented as an F or any final grade.

### AnalysisOutput

Immutable, schema-valid aggregation of source metadata safe for export, extracted-row references, conformance findings, quality findings, and score summary. Provider raw responses and source binaries are not export authority. Export-only retry always consumes this same value and never invokes ingestion or analysis.

### ExportModel

Strict, serializable representation of exactly five tabs in this order: `Overview`, `Line-item Review`, `Quality Requirements`, `Scoring`, `Methodology & disclaimer`. It contains only literal cell values plus trusted versioned template formula references. It includes version provenance and no credentials, page images, complete binaries, or arbitrary formulas.

### ExportReceipt

- `requestId`, stable exported spreadsheet reference/URL at the integration boundary, completion timestamp, and template version.
- Exactly one final receipt may exist per request.

Receipt creation is the exactly-once boundary. Before creation, an export attempt may be retried. After creation, any duplicate or stale export command returns/uses the existing receipt without creating a second spreadsheet.

## Ports

- `SourceDocumentPort`: authorized metadata/byte/table acquisition from Drive and Google Docs.
- `IngestionPort`: deterministic format parsing and WCAG-row filtering.
- `AnalysisProviderPort`: schema-constrained analysis; production target is Portkey to Gemini.
- `ExportPort`: private folder/Sheet creation and idempotent receipt lookup.
- `RequestStorePort`: minimal request/receipt reconciliation needed for resume and exactly-once effects; not a user-visible history or central retained-record product.
- `ClockPort` and `IdPort`: injected for deterministic behavior.

No port is implemented or production-proven by Stage 0 contracts.

## Invariants

1. One request references one source and yields zero or one final export receipt.
2. Only catalog IDs and rubric IDs form joins; aliases are validated inputs, not keys.
3. Only WCAG table rows enter analysis; non-WCAG tables and body prose do not.
4. AI/provider boundaries never receive page images or complete source binaries.
5. Incomplete/error outcomes cannot become quality `Fail` or a letter grade.
6. User/source text remains literal in the UI and spreadsheet.
7. A stale callback has no DOM, focus, announcement, persistence, or export effect.
8. Export retry consumes immutable analysis output without reanalysis.
9. Trusted formulas originate only from a versioned allowlist.
10. Stage 0's blocked ingestion gate cannot be represented as runtime support.
