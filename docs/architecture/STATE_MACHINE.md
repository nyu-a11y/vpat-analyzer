# Request state machine

## Authority and identity

The server-side request record is authoritative. Client views derive from accepted state events and may never advance a request on their own. Every command, event, callback, retry, analysis output, export attempt, and receipt carries one stable opaque `requestId`.

A newly selected source creates a new request ID. Retrying an operation for that source retains its request ID and increments only that operation's bounded attempt counter. A request whose ID does not equal the current active request is stale at the client boundary; its callback is rejected before any DOM, focus, live-region, navigation, persistence, or export effect.

## States

| State | Meaning | Permitted next states |
| --- | --- | --- |
| `ready` | No active source request. | `validating`, `nyu_access_failure` |
| `validating` | Access, type, VPAT version, and deterministic source eligibility are being checked. | `selected`, `source_rejected`, `non_searchable_pdf`, `permanent_failure` |
| `selected` | One eligible source is attached to an active request and awaits explicit analysis. | `preparing_source`, `ready` |
| `source_rejected` | Source is inaccessible, unsupported, not VPAT 2.5, or has no eligible WCAG table. | `validating`, `ready` |
| `non_searchable_pdf` | PDF has image-only or insufficient searchable text and OCR is forbidden. | `validating`, `ready` |
| `preparing_source` | Event-backed processing stage 1. | `extracting_wcag_tables`, `retryable_failure`, `permanent_failure` |
| `extracting_wcag_tables` | Event-backed processing stage 2. | `checking_coverage`, `source_rejected`, `non_searchable_pdf`, `permanent_failure` |
| `checking_coverage` | Event-backed processing stage 3. | `analyzing_report_quality`, `permanent_failure` |
| `analyzing_report_quality` | Event-backed processing stage 4. | `preparing_results`, `retryable_failure`, `permanent_failure` |
| `preparing_results` | Event-backed processing stage 5; immutable analysis output is validated and exported. | `success`, `export_retryable_failure`, `permanent_failure` |
| `retryable_failure` | A provider or transient analysis operation ended without a complete output. | The failed analysis state, `validating`, `ready`, `permanent_failure` |
| `export_retryable_failure` | Complete immutable analysis exists, but no final export receipt was obtained. | `preparing_results`, `success`, `permanent_failure` |
| `reconciling_resume` | Reload found a request/receipt record that must be reconciled before effects. | Any truthful active/recovery state, `success`, `ready` |
| `success` | One final export receipt exists for the request. | `ready` |
| `permanent_failure` | The operation cannot safely continue within its retry/policy boundary. | `validating`, `ready` |
| `nyu_access_failure` | Intended deployment could not authorize an eligible NYU user. | `ready` after an approved access retry |

`Incomplete` and `Error` are result/operation statuses, not synonyms for `permanent_failure`: they communicate that no completed quality determination exists. None of these states may manufacture a quality `Fail` or an `F` grade.

## Command rules

### Select source

`selectSource(sourceRef)` creates a new stable request ID only after the integration boundary accepts the selection intent. Selecting a different source supersedes the prior active request on the client. Later callbacks for the superseded request are stale and silent.

### Start analysis

`startAnalysis(requestId)` is accepted only from `selected`. Repeated activation or delivery for the same request is idempotently rejected/acknowledged without starting a second pipeline. Each named processing state begins only after a real domain event; timers cannot synthesize progress or percentages.

### Retry analysis

`retryAnalysis(requestId)` is accepted only from `retryable_failure`, within versioned per-operation limits, and resumes at the earliest safe failed boundary. It may reuse immutable deterministic ingestion output when its versions and source identity still match. It may not turn missing or provider-error results into `Fail`.

### Retry export

`retryExport(requestId)` is accepted only when a schema-valid immutable `AnalysisOutput` exists. It performs a receipt lookup before attempting creation. It never invokes source acquisition, ingestion, prompt construction, or provider analysis. If a receipt already exists, the request transitions to `success`; otherwise the export adapter attempts creation and atomically records at most one final receipt.

### Analyze another

`resetToReady(requestId)` clears the active client projection after success or failure. It does not delete the already-created private spreadsheet or rewrite request history. Any later callback for the old request is stale.

## Callback acceptance algorithm

Before handling an asynchronous callback:

1. Validate its envelope and stable `requestId`.
2. Compare it with the active request ID.
3. Reject on mismatch with no DOM, focus, announcement, persistence, navigation, analysis, or export effect.
4. Verify that its event is allowed from the server-authoritative current state and has not already been applied.
5. Apply the event idempotently and render the resulting state.
6. Perform explicitly declared focus/live-region behavior once for the accepted event.

A stale success callback cannot show a link or create a spreadsheet. A duplicate current callback cannot repeat an announcement or final side effect.

## Resume and reload

On reload, the client enters `reconciling_resume` and queries the server by the locally referenced active request ID. The response must be JSON-serializable and is treated as a fresh callback subject to ID and schema checks.

- A final receipt yields `success` without a new export.
- Immutable analysis with no receipt yields `export_retryable_failure` or resumes an in-flight idempotent export reconciliation.
- A safely retryable interrupted analysis yields `retryable_failure` with the correct next action.
- A currently executing operation may show its last event-backed named stage only when durable state supports that claim.
- An unknown, expired, version-incompatible, or non-resumable request returns `ready` or a plain-language permanent recovery state; the UI must not invent background work.

V1 does not add a history dashboard or retained central application-record product. The minimum request/receipt data needed for idempotency and reconciliation is an implementation concern for Stage 1 and remains unproven.

## Exactly-once export invariant

For each `requestId`, cardinality of final `ExportReceipt` is `0..1`. Export creation uses an idempotency check keyed by request ID plus an atomic or otherwise race-safe receipt-claim strategy appropriate to Apps Script. A timeout after a write is ambiguous until receipt reconciliation; it is never permission to create another spreadsheet blindly. One request may produce at most one final spreadsheet.

## Stage 0 boundary

This document is a contract, not an implemented state runtime. Future Stage 1 commands must report unavailable until the ingestion proof and visual-selection gates are satisfied; placeholder success is forbidden.
