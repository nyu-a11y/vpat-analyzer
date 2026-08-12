# V1 scope

## Product promise

VPAT Analyzer V1 is an NYU-internal Google Apps Script web app. A person with an NYU account and the application URL chooses one VPAT 2.5 file from Google Drive. The app analyzes only WCAG conformance tables and creates one new private Google Sheet in `My Drive/VPAT Analyzer Results`.

The deployed Apps Script configuration is intended to use `DOMAIN` access and execute as the accessing user. Those settings, user identity, Drive access, parsing, Sheets writes, and deployment behavior are requirements, not Stage 0 proof claims.

## Accepted input

- Exactly one Google Doc, DOCX, or text-searchable PDF selected through Google Drive.
- VPAT template version 2.5 only.
- WCAG 2.0, 2.1, or 2.2 success-criterion tables at levels A, AA, and AAA, matched through immutable catalog IDs and explicit aliases. A document may declare a narrower scope such as A/AA.
- Deterministic extraction before any AI call; body prose and non-WCAG tables are excluded.

## Produced output

- At most one final spreadsheet for one stable analysis request.
- Exactly five tabs: `Overview`, `Line-item Review`, `Quality Requirements`, `Scoring`, and `Methodology & disclaimer`.
- Literal spreadsheet text for every user- or source-controlled value. Formulas are permitted only in trusted, versioned template cells.
- Incomplete, missing, provider, ingestion, and export errors remain operational outcomes and never become quality `Fail` results or an `F` grade.
- An optional `Save as PDF` action uses the browser's local print flow over immutable completed results. It creates no application-managed Drive artifact, export receipt, provider call, or second authoritative result.

## Explicit exclusions

V1 has no OCR, local upload, batch processing, history dashboard, tenancy, roles, billing, approvals, collaboration, review system, monitoring, bidirectional synchronization, retained central application records, or provider-selection UI. It does not analyze Section 508 or EN 301 549 tables. It does not send PDF page images or complete document binaries to an AI provider.

## Provider boundary

Production analysis is intended to route through Portkey to Gemini. Direct Gemini is reserved for a future, explicitly opted-in local contract test using sanitized synthetic content. Deterministic tests make no provider call and have no production fallback.

## Release gates

Stage 0 remains blocked on deterministic ingestion proof documented in `docs/testing/STAGE_0_INGESTION_GATE.md`. The owner approved the optimized Document Workbench direction on 2026-08-12, so `selectedDirection` is `Document Workbench` with status `approved`. That decision clears the visual-selection gate only; production implementation remains outside the authority of the approval task and Stage 1 remains unavailable while the ingestion gate is blocked.
