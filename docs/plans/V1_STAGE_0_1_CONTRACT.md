# Endpoint

Create a repository-owned, versioned, testable Stage 0 contract checkpoint for the NYU VPAT Analyzer. The checkpoint defines the V1 product boundary, source discrepancies, immutable WCAG and quality identifiers, ingestion and AI boundaries, export semantics, lifecycle states, experience/content requirements, synthetic fixtures, JSON Schemas, and executable contract tests. It records the ingestion feasibility gate as `BLOCKED`, records the owner's 2026-08-12 approval of the optimized Document Workbench direction, and does not implement a production ingestion runtime or production UI. Stage 1 remains unavailable until the ingestion gate is proven.

# Allowed scope

- Add or update Stage 0 documentation under `docs/`, versioned data under `config/`, prompts under `prompts/`, response/export/ingestion schemas under `schemas/`, synthetic-only fixtures under `tests/fixtures/synthetic/`, contract tests under `tests/contracts/`, a Stage 0 blocker sentinel under `scripts/`, and package scripts needed to run those checks.
- Use local, deterministic checks that do not contact providers, Google services, or canonical Drive materials.
- Describe future ports and proof requirements without claiming that an Apps Script, Drive, DOCX, PDF, AI, or Sheets integration exists.
- Record Document Workbench as the single approved direction; retain Calm Utility and Guided Assurance as historical references without blending them into the selected design.

# Protected state

- Preserve all user-authored and unrelated changes, including `README.md` and the reference-only `VPATAnalyzer` tree; do not edit, stage, reset, reformat, or discard them.
- Never read, print, copy, transmit, or commit `.env.local`; never commit credentials, provider secrets, tokens, deployment bindings, generated output spreadsheet IDs, private user document IDs or content, Drive files, or browser evidence. Owner-supplied canonical reference URLs committed for traceability are allowed.
- Keep canonical Drive materials read-only. Do not mutate Google Drive, Sheets, Apps Script deployments, sharing, production configuration, or provider configuration.
- Do not extend the legacy OCR/Drive-conversion path or reuse its incompatible workbook schema.
- Do not create production UI as part of the visual-approval update; implementation requires separate task authority and the applicable release gates.

# Authority

Authority is limited to bounded local source, contract, configuration, schema, prompt, synthetic-fixture, test, and package-script edits for this checkpoint, plus read-only inspection and local deterministic test execution. The owner's 2026-08-12 approval authorizes recording Document Workbench as the selected visual direction. There is no authority to implement production UI, stage, commit, push, deploy, run mutating `clasp` commands, call Portkey or Gemini, configure real providers, or alter Google systems.

# Required proof

- `npm run test:contracts` and `npm test` pass against committed synthetic data only.
- `npm run proof:stage0` exits nonzero with status code `2` and names the exact ingestion evidence still missing.
- Contract tests verify required files, JSON syntax and versions, 87 unique immutable WCAG IDs, the exact 16-item rubric, gap-free scoring bands, strict schemas, and the rule that incomplete/error outcomes are never quality `Fail` or an `F` grade.
- Final repository status and diff are inspected after the last edit, with protected changes left untouched.
- The ingestion gate can be unblocked only by a bound or deployed, authorized, synthetic-only HtmlService harness that parses committed real-format Google Docs/DOCX/searchable-PDF cases and rejects image-only, malformed, inaccessible, and encrypted PDFs; proves golden WCAG-row parity; blocks unexpected network access; proves CSP, worker, and memory behavior; serializes an actual synthetic Google Doc through `DocumentApp`; and proves Drive-to-browser byte transport plus a JSON-only `google.script.run` round trip. No OCR, provider call, page image, or complete binary may be sent to AI.
- Owner-only VoiceOver, keyboard, focus restoration, reading order, 200% zoom/reflow, and visual comparison checks remain explicitly unchecked.

# Stop conditions

- Stop with `BLOCKED` rather than promise ingestion support while any required P0 ingestion evidence is missing or failing.
- Stop before Stage 1 implementation while the ingestion gate remains blocked. Future Stage 1 commands must exit unavailable rather than simulate success.
- Stop before any action requiring credentials, provider access, canonical-source mutation, deployment, staging, commit, push, production UI work, or expanded product scope unless the owner grants new explicit authority.
- Stop and report a conflict if requested work would overwrite protected user changes, expose secrets or real identifiers, introduce OCR/local upload/history/tenancy/collaboration/provider-selection UI, classify missing/provider/export errors as quality failures, or permit duplicate/stale callbacks to cause user-visible or export effects.
