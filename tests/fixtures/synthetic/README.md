# Synthetic fixture boundary

These fixtures contain invented Northstar Collaboration Suite content only. They are safe, committed contract data and have no production fallback. They do not contain a real Drive file, source document, spreadsheet ID, deployment binding, account information, or provider response.

`google-docs-candidate-tables.v1.json` is a JSON model of candidate tables and `expected-wcag-rows.v1.json` is its golden normalized expectation. Together they verify fixture consistency, immutable catalog IDs, the full 55-criterion WCAG 2.2 A/AA representative scope, four representative review rows, and deterministic expectations for excluding body prose, Section 508, EN 301 549, arbitrary leading-number text, and a formula-like source string.

They do **not** prove that `DocumentApp` can serialize an actual Google Doc, that Drive bytes can reach a browser, that `google.script.run` can round-trip the result, or that DOCX/PDF parsers work in HtmlService.

## Missing real-format fixtures are a blocker

The repository does not yet include real-format synthetic fixtures for DOCX, searchable PDF, image-only/scanned PDF, malformed PDF, or encrypted/password-protected PDF. Their absence is an explicit P0 blocker, not passing evidence. A JSON object with a `.docx` or `.pdf` name would not close the gap.

Stage 0 can be unblocked only by the authorized bound/deployed synthetic-only harness and exact proof in `docs/testing/STAGE_0_INGESTION_GATE.md`. Do not add real user documents, canonical Drive content, OCR output, page images, source binaries sent to AI, or hidden production fallback to these tests.
