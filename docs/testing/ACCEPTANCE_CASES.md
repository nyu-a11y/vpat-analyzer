# Acceptance cases

## Evidence policy

Committed automated tests use synthetic fixtures only and have no production fallback. Stage 0 contract, unit, integration, build, and local browser checks now exercise deterministic DOCX/PDF parsing and the isolated harness package. They must not claim to exercise unproven deployed Apps Script/HtmlService/Drive/`DocumentApp` boundaries, providers, Sheets, production UI, or production behavior.

The live Google ingestion cases remain owner-retained as described in `STAGE_0_INGESTION_GATE.md`. The owner approved the optimized Document Workbench visual direction and later authorized the local production build. Stage 1 commands now execute actual deterministic, Apps Script static/build, and browser evidence; they do not claim deployment, live provider, or native Sheets proof.

## Stage 0 executable contract cases

| ID | Case | Expected contract result |
| --- | --- | --- |
| C-001 | Load every required JSON artifact. | Valid JSON with explicit version metadata; no missing Stage 0 artifact. |
| C-002 | Load the WCAG union catalog. | Exactly 87 unique `wcag-sc-{SC}` primary IDs; unique SC numbers; official titles; A/AA/AAA levels; version activity metadata; 4.1.1 retained; no 508 or EN rows. |
| C-003 | Load the quality rubric. | Exactly 16 unique stable `qr-*` IDs with the specified numeric/broader aliases, titles, impact weights/labels, and Essential/Best Practice types; blank broader `ReqID` anomaly documented but never primary. |
| C-004 | Load scoring configuration. | Confidence threshold 70; integer bands cover 0–100 once with no gaps/overlap: F 0–60, D 61–69, C 70–79, B 80–89, A- 90–94, A 95–100. |
| C-005 | Validate each JSON Schema's strictness. | Root and nested objects reject unexpected fields; required version/ID/status fields and enums are explicit. |
| C-006 | Inspect conformance and quality semantics. | Missing/malformed/provider/ingestion/export outcomes map to `Incomplete`/`Error`; only completed quality evaluations allow `Fail`; incomplete score has `grade: null`; F applies only to a completed score ≤60. |
| C-007 | Inspect synthetic candidate-table and expected-row fixtures. | Fixtures contain no real IDs/content; expected rows use immutable catalog IDs; non-WCAG/body/508/EN candidates are excluded deterministically in the golden expectation. This proves fixture shape only. |
| C-008 | Inspect workbook/export schema. | Exactly five tabs in order: Overview, Line-item Review, Quality Requirements, Scoring, Methodology & disclaimer. No extra tabs; provenance versions present. |
| C-009 | Inspect prompts. | Separate versioned tasks, strict JSON-only response, untrusted-source delimiter, expected-ID coverage, no tools/OCR/table discovery/scoring/export authority, and no complete binary/image input. |
| C-010 | Run Stage 0 blocker sentinel. | Exits with code 2, reports `BLOCKED`, and names missing real-format/HtmlService/DocumentApp/transport proof. It is intentionally not part of passing `npm test`. |
| C-011 | Invoke Stage 1 build and proof commands. | They execute the real local implementation and synthetic browser proof; none substitutes for the owner-retained Google/provider/Sheets acceptance. |

## Blocked ingestion acceptance cases

These cases are required to unblock Stage 0, but no committed contract test may mark them passed before the authorized real harness exists.

| ID | Source/condition | Expected behavior and evidence |
| --- | --- | --- |
| I-001 | Actual synthetic Google Doc containing WCAG, non-WCAG, body prose, merged cells, and duplicate rows | Serialize through `DocumentApp`; retain its declared WCAG 2.2 A/AA rows in source order; record duplicates; exclude prose and other tables; golden JSON parity through a JSON-only `google.script.run` round trip. |
| I-002 | Real synthetic DOCX package with the same logical fixture | Actual browser bundle parses OOXML under bound/deployed HtmlService constraints; golden row parity; no Drive conversion, OCR, provider, or network fetch. |
| I-003 | Real synthetic searchable PDF with the same logical fixture | Actual browser PDF bundle reconstructs eligible rows within documented tolerances; golden parity; CSP/worker/memory behavior proven; no page images/provider/OCR. |
| I-004 | Image-only/scanned PDF | Reject `PDF_NON_SEARCHABLE`; no OCR or image-to-provider fallback. |
| I-005 | Searchable PDF with insufficient trustworthy table text | Reject `PDF_INSUFFICIENT_TEXT` or `WCAG_ROWS_AMBIGUOUS` according to deterministic thresholds; do not guess. |
| I-006 | Malformed PDF | Reject `SOURCE_MALFORMED` without crash, content leak, or partial analysis. |
| I-007 | Encrypted/password-protected PDF | Reject `PDF_ENCRYPTED` without password collection or provider fallback. |
| I-008 | Inaccessible Drive source | Reject `SOURCE_INACCESSIBLE`; do not alter sharing or expose permission details. |
| I-009 | Large/decompression-hostile source | Enforce byte/page/ZIP/table/text/time bounds and reject `RESOURCE_LIMIT_EXCEEDED`; no unexpected network. |
| I-010 | Drive-to-browser transport | Prove byte encoding/chunking/round-trip integrity and JSON-only `google.script.run` return values in the authorized HtmlService harness. |
| I-011 | Full 87-criterion WCAG 2.0/2.1/2.2 A/AA/AAA DOCX and wrapped/multipage searchable PDF | Preserve every ordered immutable criterion ID and normalized literal criterion/conformance/remarks value exactly; retain retired 4.1.1; no duplicate, missing, or cross-format-corrupted evidence. |
| I-012 | Actual synthetic Google Doc with a normalized 10,001-character prose paragraph | Serializer rejects `RESOURCE_LIMIT_EXCEEDED` before parsing and does not slice or return partial candidate-document content. |

## Future deterministic domain and AI cases

| ID | Case | Expected behavior |
| --- | --- | --- |
| A-001 | Valid conformance response for all expected IDs | Strict schema and exact-ID validation pass; immutable findings retain catalog IDs and literal evidence. |
| A-002 | Missing criterion response | Missing finding becomes `Incomplete`; no fabricated finding, quality failure, or grade. |
| A-003 | Unknown or duplicate criterion/rubric ID | Reject the response before domain/export effects. |
| A-004 | Malformed JSON, prose wrapper, extra nested property, invalid enum, or out-of-range confidence | Reject as malformed provider output; bounded retry if configured; otherwise `Incomplete`, never `Fail`. |
| A-005 | Provider timeout/transient failure | Enter retryable provider failure; retry keeps request ID and respects operation limit. |
| A-006 | Provider permanent failure or exhausted retries | Enter permanent/incomplete outcome with `grade: null`. |
| A-007 | Confidence below 70 | Preserve the evidence-based result, set review flag, and do not silently flip Pass/Fail or conformance. |
| A-008 | Prompt-injection text inside remarks | Treat text as evidence only; no tools, URL fetch, scope change, formula creation, or output-shape deviation. |
| A-009 | Direct Gemini test without explicit opt-in or sanitized fixture | Fail closed before network access. Production route remains Portkey to Gemini. |

## Future state, retry, and export cases

| ID | Case | Expected behavior |
| --- | --- | --- |
| S-001 | Double activation of Analyze for one selected request | One pipeline start; duplicate command acknowledged/rejected idempotently. |
| S-002 | Callback for superseded request | No DOM, focus, announcement, navigation, persistence, analysis, or export effect. |
| S-003 | Duplicate current stage callback | Stage applied/announced at most once; no fake progress. |
| S-004 | Reload during an active request | Reconcile durable state; show only a real event-backed stage or truthful recovery; do not invent background work. |
| S-005 | Reload after export receipt | Restore Success using the receipt; no second spreadsheet. |
| S-006 | Export failure after complete analysis | Offer export-only retry using immutable analysis output; provider/ingestion call counts unchanged. |
| S-007 | Duplicate export requests or timeout after ambiguous completion | Receipt/claim reconciliation yields at most one final spreadsheet and one final receipt. |
| S-008 | Source/provider string begins `=`, `+`, `-`, `@`, tab, CR, or LF | Visible literal text is preserved and never evaluated as a formula, link, or command. |
| S-009 | Formula requested from untrusted content or unknown template reference | Fail closed; only reviewed versioned template formula cells are permitted. |
| S-010 | Partial quality findings numerically total ≤60 | Overall status is `Incomplete`, grade is null, and no F is shown. |
| S-011 | Complete quality findings calculate each band edge | Exact configured grade: 60 F, 61 D, 69 D, 70 C, 79 C, 80 B, 89 B, 90 A-, 94 A-, 95 A, 100 A. |
| S-012 | Save a local PDF after completed analysis, including during export-only failure | Browser print uses immutable completed results, expands all review content for print, restores prior web state afterward, and creates no Drive artifact, export receipt, provider call, reanalysis, or second authoritative result. |

## Future browser and accessibility cases

All visible states in `V1_FLOW_STATE_MATRIX.md` require deterministic render fixtures at 1440×900, 1024×768, 768×1024, 390×844, 320×568, and desktop at 200% zoom. Automated proof must find no unapproved axe violations and no serious/critical browser findings; controls must work by keyboard; focus and live-region changes must match the state contract; 44 px targets, forced colors, reduced motion, and reflow must pass; and there must be no clipping, page-level horizontal overflow, dead controls, console errors, placeholder copy, TODOs, or fake progress. Completed-state proof must also distinguish the exact three-view web navigator from the exact five-tab Sheet and verify reviewer jump/focus, row disclosures, review filters, methodology disclosure, print expansion/restoration, and unchanged exactly-once Sheet semantics.

The local Stage 1 browser proof executes the synthetic keyboard, focus, target-size, 200% zoom/reflow, forced-colors, reduced-motion, axe, print, stale-callback, recovery, and visual-comparison checks. VoiceOver, live Google authorization, provider quality, and native Sheets readability remain owner-run and cannot be self-certified by the builder.
