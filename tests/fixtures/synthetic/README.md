# Synthetic fixture boundary

These fixtures contain invented Northstar Collaboration Suite content only. They are safe, committed contract data and have no production fallback. They do not contain a real Drive file, source document, spreadsheet ID, deployment binding, account information, or provider response.

`google-docs-candidate-tables.v1.json` is a JSON model of candidate tables and `expected-wcag-rows.v1.json` is its golden normalized expectation. Together they verify fixture consistency, immutable catalog IDs, the full 55-criterion WCAG 2.2 A/AA representative scope, four representative review rows, and deterministic expectations for excluding body prose, Section 508, EN 301 549, arbitrary leading-number text, and a formula-like source string.

They do **not** prove that `DocumentApp` can serialize an actual Google Doc, that Drive bytes can reach a browser, that `google.script.run` can round-trip the result, or that DOCX/PDF parsers work in HtmlService.

## Real-format synthetic fixtures are now committed

The `real-format/` directory now contains 14 deterministic DOCX/PDF/text binaries generated entirely from invented Northstar content. Its versioned manifest records byte counts, SHA-256 digests, expected complete/rejected outcomes, and the source-model/catalog digests. The committed set includes the primary 55-row DOCX/searchable-PDF pair; a full-union 87-row DOCX/searchable-PDF pair with A/AA/AAA coverage, wrapped evidence, repeated headers, and a multipage continuation; and image-only, insufficient-text, malformed, encrypted, ambiguous, unsupported-version, no-WCAG, unsupported-type, parser-page-limit, and default DOCX XML-node-limit rejection cases. The generator uses the `google_docs_default` document design preset and the fixtures have been rendered and visually inspected.

These fixtures and the local browser proof close the file-container and browser-bundle adjuncts. They still do not clear the live gate: an authorized HtmlService deployment must prove actual `DocumentApp` serialization, Drive byte transport, `google.script.run` round trips, deployed CSP behavior, and inaccessible-source behavior.

Stage 0 can be unblocked only by the authorized bound/deployed synthetic-only harness and exact proof in `docs/testing/STAGE_0_INGESTION_GATE.md`. Do not add real user documents, canonical Drive content, OCR output, page images, source binaries sent to AI, or hidden production fallback to these tests.
