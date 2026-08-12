# Stage 0 ingestion gate

## Status: BLOCKED

The deterministic pre-LLM ingestion feasibility gate is not proven. V1 must not promise production Google Doc, DOCX, or searchable-PDF ingestion until the exact unblock evidence below exists. The legacy reference implementation does not satisfy the gate because its PDF path uses OCR and its conversion/workbook architecture is explicitly out of scope.

## Evidence currently available

- Repository contracts can define accepted formats, immutable catalog matching, rejection codes, security limits, and golden synthetic JSON shapes.
- Synthetic JSON can exercise catalog/fixture contract assertions without using production content.
- Versioned prompts/schemas can constrain post-ingestion analysis shape.

This evidence is necessary but not sufficient. It does not exercise a real document container, DocumentApp, Drive transport, HtmlService, browser parser, CSP, worker, memory behavior, or `google.script.run` serialization.

## Exact gaps

1. No real committed synthetic DOCX fixture exists.
2. No real committed synthetic searchable-PDF fixture exists.
3. No real committed synthetic image-only/scanned PDF fixture exists.
4. No real committed synthetic malformed-PDF fixture exists.
5. No real committed synthetic encrypted/password-protected PDF fixture exists.
6. No pure-JavaScript DOCX or PDF browser parser bundle has actually run in the V1 ingestion shape.
7. No bound/deployed HtmlService proof establishes CSP compatibility, worker strategy, packaged-asset behavior, memory/resource limits, or unexpected-network blocking.
8. No actual synthetic Google Doc has been serialized through `DocumentApp` and compared with the golden WCAG-row model.
9. No authorized Drive-to-browser byte transport has proven encoding, chunking, size limits, and round-trip integrity.
10. No JSON-only `google.script.run` request/response round trip has proven that ingestion inputs/results survive the Apps Script boundary.
11. No cross-format golden parity proves that only eligible WCAG A/AA/AAA rows are retained while body prose, non-WCAG tables, Section 508, and EN rows are excluded.
12. No bound harness proves stable rejection codes for image-only, insufficient-text, malformed, encrypted, inaccessible, ambiguous, or resource-limited sources without OCR/provider fallback.

Package declarations, Node-only parser tests, mocked browser APIs, JSON fixtures, visual prototypes, schemas, and prompts do not close these gaps.

## Exact unblock proof

Run a bound or deployed, authorized, synthetic-only HtmlService harness that:

- Uses an actual synthetic Google Doc serialized through `DocumentApp`.
- Parses committed real-format synthetic DOCX and searchable-PDF fixtures with the actual pinned pure-JavaScript browser bundles.
- Exercises committed real-format image-only, malformed, and encrypted/password-protected PDF fixtures.
- Transports authorized synthetic Drive bytes to the browser with proven encoding/chunking/limits and returns JSON-only values through `google.script.run` without corruption.
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

- `npm run test:contracts` and `npm test` may pass because they verify the honest repository contract checkpoint only.
- `npm run proof:stage0` must exit with code 2 and print this gate's `BLOCKED` status and missing proof.
- Future Stage 1 commands must also exit code 2/unavailable until this gate is cleared. The visual-selection prerequisite was satisfied by the owner's 2026-08-12 approval of Document Workbench.

No Stage 0 status may be called complete while this gate is blocked.
