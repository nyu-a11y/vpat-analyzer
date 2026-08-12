# Export contract

## Outcome

Given one immutable, schema-valid completed analysis output, create at most one new private Google Sheet for the stable request in `My Drive/VPAT Analyzer Results`. A successful export returns one final receipt. Stage 0 defines this behavior without writing to Drive or Sheets and without claiming that Apps Script identity, permissions, folder creation, or native formatting has been proven.

The web app's `Save as PDF` control is a client-side browser print of immutable completed results and is outside this Sheet export protocol. It creates no application-managed Drive artifact or receipt and does not acquire the source, rerun analysis, call a provider, or alter exactly-once Sheet state.

## Preconditions

Export is allowed only when:

- The command carries the active stable `requestId`.
- The immutable `AnalysisOutput` validates against its versioned domain contract.
- Every expected conformance and quality finding has a valid completed or `Incomplete` status.
- Score status follows incomplete-versus-grade semantics.
- The export model validates against `export-model.v1.schema.json`.
- No existing final receipt needs to be returned instead.

An ingestion/provider/export error may be represented in an incomplete result view, but a provider or missing-result failure cannot be converted to a quality `Fail` or an F grade to satisfy export preconditions.

## Exact workbook shape

The workbook contains exactly these tabs, in this order:

1. `Overview`
2. `Line-item Review`
3. `Quality Requirements`
4. `Scoring`
5. `Methodology & disclaimer`

The export schema fixes their identifiers, labels, order, table/section types, and version provenance. It permits no extra tab. `Start` and `Advanced Settings` are live-source references, not exported tabs. There is no API-key UI or hidden provider-configuration sheet.

## Data responsibilities

- `Overview`: literal source summary safe for export, analysis completion/incomplete status, counts, grade only when complete, review callouts, and workbook navigation descriptors.
- `Line-item Review`: immutable criterion ID, official SC number/title/level, literal source conformance/remarks, normalized finding, evidence, confidence, and complete/incomplete status.
- `Quality Requirements`: exact 16 stable requirement IDs, aliases for display/provenance, title, type, impact, result, evidence, guidance, confidence, and status.
- `Scoring`: completed/incomplete status, earned/possible weight, percentage and grade only when complete, plus the versioned gap-free band table.
- `Methodology & disclaimer`: version provenance, supported boundary, deterministic-ingestion statement, AI limitations, confidence threshold, scoring semantics, privacy/output statement, and required disclaimer.

## Literal-cell and formula safety

All source-, user-, and provider-controlled strings are untrusted and written with literal value semantics. This includes strings beginning with `=`, `+`, `-`, `@`, tab, carriage return, or line feed and strings that resemble URLs or formulas. The adapter must use an API/input option and explicit normalization proven to preserve the visible literal text without evaluation.

Formula semantics are allowed only for cells named by a trusted, reviewed, version-controlled template allowlist. The formula text originates in that template, never in source content, AI output, runtime aliases, or arbitrary configuration. Unknown formula references fail closed. A precomputed literal score is acceptable when the contract does not require a native formula.

UI rendering also treats all strings as text and never injects them as HTML.

## Exactly-once protocol

1. Resolve the stable `requestId` and look up an existing receipt.
2. If a final receipt exists, return it and do not create a spreadsheet.
3. Claim the export operation using a race-safe idempotency mechanism keyed by request ID.
4. Build from the immutable analysis output and fixed template version.
5. Create/finalize one private spreadsheet, then atomically persist the final receipt.
6. If completion is ambiguous after a timeout, reconcile the claim/receipt and created artifact before any retry.

The implementation must address Apps Script concurrency explicitly (for example, a lock plus durable idempotency record); naming collisions alone do not provide exactly-once safety. One request has zero or one final receipt and may produce at most one final spreadsheet.

## Export-only retry

An export failure after analysis transitions to `export_retryable_failure`. Retry consumes the same immutable `AnalysisOutput` and template versions. It must not reacquire the source, rerun ingestion, reconstruct prompts, call a provider, recompute findings from mutable data, or change the request ID. If reconciliation finds a receipt, retry returns success immediately.

## Formatting contract for later proof

- Clear workbook title and hierarchy; exact tab labels.
- Frozen table headers, useful filters, readable widths, wrapped long evidence/remarks, and stable row ordering.
- Status text and symbols do not depend on color alone; contrast and zoom remain usable.
- No source string controls number formats, formulas, links, sheet names, ranges, or styling.
- Print views preserve headings and identify continuation/context.
- Workbook-equivalent previews are labeled simulated until an authorized native Sheets write proves actual Sheets behavior.

## Failures and receipt

Export errors use stable safe codes such as authorization, folder, create, write, format, finalize, and ambiguous completion. They are operational `Error`/`Incomplete` outcomes and never quality failures.

The final receipt contains only the request ID, final spreadsheet reference/URL at the integration boundary, completion timestamp, and template version needed for reconciliation. It contains no credentials, provider response, source binary, page image, or hidden history feature.

## Stage 0 evidence limit

Schema and deterministic builder contracts do not prove Drive/Sheets mutation, ownership, privacy, formula handling, concurrency, formatting, or printing. Those require separately authorized Apps Script and native-Sheets proof in a later stage.
