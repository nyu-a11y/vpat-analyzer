# Stage 0 ingestion gate

## Status: BLOCKED — LIVE BOUNDARY OWNER-RETAINED

The deterministic local ingestion adjunct passes, but the decisive authorized Google/HtmlService boundary has not been run by this build task. The owner elected to perform that live acceptance independently and directed the implementation to proceed. Production rollout must still treat Google Doc/Drive/HtmlService claims as unverified until the remaining live evidence below exists. The legacy reference implementation does not satisfy the gate because its PDF path uses OCR and its conversion/workbook architecture is explicitly out of scope.

## Evidence currently available

- Fourteen deterministic, invented Northstar real-format binaries are committed with byte counts and SHA-256 digests: the primary DOCX/searchable-PDF pair; the 87-criterion full-union DOCX/searchable-PDF pair; image-only, insufficient-text, malformed, encrypted, ambiguous, and resource-limit PDFs; a default-limit 200,032-XML-node DOCX; VPAT 2.4 and no-WCAG DOCX files; and unsupported text.
- One shared catalog-ID ingestion core and the pinned `fflate`/PDF.js browser adapters produce exact 55-row primary and 87-row union projections. Digests bind ordered immutable IDs, normalized literal criterion/conformance/remarks evidence, coverage, duplicate-row evidence and locations, exclusions, and table decisions per case.
- Nineteen contract tests and 87 unit/real-format integration assertions pass. They cover exact catalog matching, limits, unsafe OOXML, wrapped/multipage PDF geometry, stable rejection codes, authoritative MIME/signature agreement, and incomplete-not-quality-failure semantics.
- The build packages one 1,737,697-byte inline IIFE bundle (SHA-256 `622bfac5be57b1654ad5383029ff19a3fcf7a0d96a391f199cc31437eed9e44c`) and a separate early network-guard bundle. A fresh local Chrome run passed 17/17 assertions, with exact projection/rejection matrices, zero console errors/warnings, zero unexpected requests, zero Worker/service-worker activity, zero CSP violations, 29 sampled heap observations within policy, keyboard activation, visible focus, landmark/table/live-region checks, and no source content, Drive ID, or deployment binding in the schema-validated summary.
- An isolated synthetic-only Apps Script harness, actual primary/overflow `DocumentApp` provisioners, 16 KiB batched Drive transport, JSON round-trip endpoint, build-bound two-account inaccessible sentinel, and sanitized Playwright live runner are implemented but not deployed.

This evidence closes the real-container and local browser adjuncts. It is necessary but not sufficient because it does not yet exercise an authorized `DocumentApp`, Drive transport, deployed HtmlService CSP, or `google.script.run` boundary.

## Exact gaps

1. No bound/deployed HtmlService proof yet establishes the actual Google CSP, inline packaged-asset behavior, in-process PDF.js worker strategy, memory behavior, or unexpected-network result.
2. No actual primary or deterministic-overflow synthetic Google Doc has yet been created and serialized through `DocumentApp` for golden comparison/rejection.
3. No authorized Drive-to-browser byte transport has yet proven base64 chunking, per-chunk/whole-file digest checks, limits, and reconstruction at the Apps Script boundary.
4. No JSON-only `google.script.run` request/response round trip has yet proven that ingestion results survive the Apps Script boundary without corruption.
5. No genuinely inaccessible allowlisted synthetic source has yet produced `SOURCE_INACCESSIBLE` under the identity executing the web app.
6. No deployed run has yet exercised the complete positive/negative matrix while recording zero OCR/provider/page-render/AI fallback behavior.

Package declarations, Node-only parser tests, mocked browser APIs, JSON fixtures, visual prototypes, schemas, and prompts do not close these gaps.

## Exact unblock proof

Run a bound or deployed, authorized, synthetic-only HtmlService harness that:

- Uses actual primary and 10,001-character overflow synthetic Google Docs serialized through `DocumentApp`.
- Parses committed real-format synthetic DOCX and searchable-PDF fixtures with the actual pinned pure-JavaScript browser bundles.
- Exercises committed real-format image-only, malformed, and encrypted/password-protected PDF fixtures.
- Transports authorized synthetic Drive bytes to the browser with proven 16 KiB chunks, multi-call batching, whole/chunk digest integrity, limits, and JSON-only `google.script.run` values without corruption.
- Produces golden-parity ordered WCAG rows using immutable catalog IDs for Google Docs, DOCX, and searchable PDF.
- Demonstrates deterministic exclusion of body prose, layout/non-WCAG tables, Section 508, EN 301 549, arbitrary numbered rows, and ambiguous rows.
- Produces stable expected rejection codes for every negative case, including no OCR fallback.
- Proves actual HtmlService CSP behavior, worker configuration, memory/resource limits, local asset packaging, and failure behavior.
- Blocks and records every unexpected network request.
- Demonstrates that no OCR, provider call, PDF page image, screenshot, complete binary, or full-document payload is sent to AI.

All source content must be synthetic and safe to commit. The authorized proof may use Google services only for this synthetic gate; it must not mutate canonical sources, share files, configure production, or use real user documents.

## Decision rule

The gate remains `BLOCKED` if any required format, negative fixture, boundary, or security assertion is missing, mocked at the decisive boundary, or failing. Do not substitute AI parsing, Drive conversion, OCR, or a Node-only result.

When all evidence passes, record the bound/deployed harness identity without committing deployment bindings, the exact fixture hashes/versions, parser bundle versions, CSP/worker strategy, resource limits, network log result, golden parity result, rejection matrix, and command output. Re-run after any parser, transport, HtmlService, fixture, catalog, or limit change.

## Command behavior

- `npm test` verifies 19 contract tests plus 87 deterministic ingestion assertions; `npm run proof:stage0:local` regenerates/verifies all 14 binaries, reruns ingestion tests, rebuilds the identity-bound harness, and executes the schema-validated 17-assertion local Playwright proof.
- `npm run proof:stage0` must exit with code 2 and print this gate's `BLOCKED` status and missing proof.
- Stage 1 local build and proof commands are real and may pass independently. They must label the live Google boundary as owner-retained rather than using a placeholder or implying deployment proof. The visual-selection prerequisite was satisfied by the owner's 2026-08-12 approval of Document Workbench.

No Stage 0 status may be called complete while this gate is blocked.
