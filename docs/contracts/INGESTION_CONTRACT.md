# Ingestion contract

## Gate status

`BLOCKED`. This document defines the deterministic pre-LLM contract; it does not claim a production ingestion runtime or support proof. The legacy reference path uses OCR and is outside the V1 boundary. No deployed or bound HtmlService/Drive-to-browser parser proof currently establishes the required Google Docs, DOCX, and searchable-PDF behavior.

## Accepted source boundary

One Drive-selected VPAT 2.5 source per request:

- Google Doc.
- DOCX.
- PDF with sufficient searchable text.

The parser retains WCAG 2.0, 2.1, and 2.2 success-criterion table rows at levels A, AA, and AAA when present. It analyzes WCAG tables only. It excludes body prose, Section 508 tables, EN 301 549 tables, non-WCAG tables, decorative layout tables, and unrelated numbered content.

V1 has no OCR and no local upload. Image-only/scanned or insufficient-text PDFs are rejected. PDF page images, screenshots, ZIP/DOCX binaries, complete PDFs, and full documents are never sent to an AI provider as an extraction workaround.

## Deterministic pipeline

1. Validate NYU/Drive access at the integration boundary without widening sharing.
2. Classify the source using authoritative MIME/type metadata and safe signature checks, not filename alone.
3. Acquire only the bytes or DocumentApp structure needed through an Apps Script-compatible transport.
4. Parse the container/Document structure deterministically with pinned, auditable code that can operate within the proven HtmlService constraints.
5. Enumerate candidate tables in source order and classify eligible WCAG tables using structural headers and explicit catalog aliases.
6. Normalize cell whitespace without changing meaningful literal conformance or remarks content.
7. Resolve each criterion to an immutable `wcag-sc-*` catalog ID; never join on a leading number or AI guess.
8. Record duplicate, missing, ambiguous, and excluded rows explicitly.
9. Return a JSON-only `IngestionResult` validated by the versioned schema.

Provider calls occur only after a complete, schema-valid ingestion result exists.

## Format-specific requirements

### Google Docs

Use an actual authorized Google Doc and `DocumentApp` structures in proof, including serialized tables/cells and merged or irregular cases. A JSON fixture that merely resembles DocumentApp output is useful for contract tests but is not proof that a Google Doc can be acquired or serialized correctly.

### DOCX

Parse the OOXML package without Google Drive conversion and without extending the legacy path. Preserve document-order tables, cell text, merged-cell interpretation needed for headers, and explicit rejection of malformed/unsupported packages. Browser/parser bundles and their transitive behavior must be exercised in the actual HtmlService execution shape; installing a package or running it only in Node is not proof.

### Searchable PDF

Extract text and geometry/text-item grouping deterministically from the PDF's text layer, reconstruct eligible tables within documented tolerances, and reject cases where trustworthy row/cell recovery is not possible. Image presence never triggers OCR. Encrypted/password-protected, malformed, image-only, or insufficient-text documents receive stable rejection codes. A parser succeeding in Node alone is not evidence that CSP, workers, memory, fonts, or byte transport work in HtmlService.

## Matching and retention

- The committed 87-item union catalog is the only criterion allowlist.
- Candidate text must resolve through explicit normalized full-SC aliases to one catalog ID. The implementation may tolerate versioned punctuation/whitespace variants but cannot accept arbitrary leading-number matches.
- A criterion row retains the literal source label, conformance value, remarks/evidence, source table index, and row index.
- Repeated criteria are recorded as duplicates rather than silently overwritten.
- Missing expected criteria are recorded separately and become incomplete coverage, never fabricated rows or quality failure.
- Non-WCAG rows are excluded with a deterministic reason and are not sent to AI.

## Result and rejection semantics

A complete result contains stable request/source/parser versions, ordered candidate-table decisions, extracted rows, exclusions, duplicates, and coverage metadata. A rejected result contains no analysis findings or grade and uses one stable code:

- `SOURCE_INACCESSIBLE`
- `SOURCE_TYPE_UNSUPPORTED`
- `VPAT_VERSION_UNSUPPORTED`
- `PDF_NON_SEARCHABLE`
- `PDF_INSUFFICIENT_TEXT`
- `PDF_ENCRYPTED`
- `SOURCE_MALFORMED`
- `WCAG_TABLE_NOT_FOUND`
- `WCAG_ROWS_AMBIGUOUS`
- `RESOURCE_LIMIT_EXCEEDED`

Safe diagnostics may identify the failed stage but must not expose document content, credentials, stack traces, or provider details. Ingestion errors are operational `Error`/`Incomplete` outcomes, never quality `Fail` or an F grade.

## Security and transport constraints

- Treat document text, relationships, metadata, filenames, and embedded links as untrusted data.
- Do not execute macros, external relationships, embedded scripts, URLs, actions, attachments, or formulas.
- Block unexpected network requests during parser proof; pinned local parser assets must not fetch workers, CMaps, fonts, WASM, or other resources unless explicitly packaged and proven.
- Enforce bounded bytes, pages, ZIP entries/expansion, tables, rows, cells, string length, recursion, and processing time; stable resource-limit failures are preferable to partial guessed output.
- Cross the `google.script.run` boundary with JSON-serializable values only. The proof must cover Drive-to-browser byte encoding/chunking and round-trip integrity within actual limits.
- Do not persist real source content in committed fixtures, logs, browser evidence, or test output.

## Exact proof required to unblock

The gate changes from `BLOCKED` only when a bound or deployed, authorized, synthetic-only HtmlService harness:

1. Parses committed real-format fixtures for DOCX, searchable PDF, image-only PDF, malformed PDF, and encrypted/password-protected PDF, plus an actual synthetic Google Doc serialized through `DocumentApp`.
2. Demonstrates golden parity for eligible WCAG rows and deterministic exclusion of body prose, non-WCAG tables, Section 508, and EN content.
3. Demonstrates the specified rejection codes for negative fixtures, including no OCR fallback.
4. Runs the actual pure-JavaScript browser parser bundles and proves HtmlService CSP, worker strategy, memory/resource limits, and packaged-asset behavior.
5. Proves authorized Drive-to-browser byte transport and a JSON-only `google.script.run` round trip without corruption.
6. Blocks and records unexpected network requests.
7. Shows that no OCR, provider call, page image, complete binary, or full document payload is sent to AI.

All fixture content must be synthetic and safe to commit. Until every item passes, Google Doc/DOCX/PDF ingestion support remains unproven and `npm run proof:stage0` must exit nonzero with the blocker.
