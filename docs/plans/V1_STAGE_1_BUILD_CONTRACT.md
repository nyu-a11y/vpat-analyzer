# Endpoint

Deliver a production-shaped, locally runnable NYU VPAT Analyzer V1 that implements the approved Document Workbench revision 9 and one complete flow: choose one eligible Google Drive source, validate and ingest its WCAG tables, run schema-constrained analysis through the production provider port, create at most one private five-tab Google Sheet, and review the immutable result in the three approved web views. The exported Sheet remains exactly `Overview`, `Line-item Review`, `Quality Requirements`, `Scoring`, and `Methodology & disclaimer`, in that order.

# Allowed scope

- Add modular deterministic domain, orchestration, Apps Script adapter, HtmlService client, build, test, and local-preview source under `src/`, `appsscript/`, `scripts/`, `tests/`, and narrowly related versioned configuration or schemas.
- Reuse the completed Stage 0 ingestion modules and committed synthetic fixtures.
- Update package commands and current V1 documentation to describe the implemented local build and the owner-retained live Google acceptance work.
- Use only synthetic data in local tests and previews. Build provider and Google integration ports without calling them locally.

# Protected state

- Preserve unrelated and user-authored changes, including the existing `README.md`, `VPATAnalyzer`, `.env.local.example`, `examples/`, and every secret or local environment file.
- Do not read `.env.local`; stage, commit, push, deploy, or mutate Google Drive, Docs, Sheets, Apps Script, Portkey, or Gemini.
- Preserve the V1 boundary: no OCR, local upload, history dashboard, collaboration/review system, provider-selection UI, API-key UI, Section 508/EN analysis, or extra workbook tabs.
- Preserve literal source/provider text, immutable catalog and rubric IDs, incomplete-not-fail semantics, stale-callback silence, export-only retry, and exactly-once final Sheet behavior.

# Authority

The owner's 2026-08-12 instruction to stop delaying the product for owner-run live acceptance testing authorizes bounded local production implementation and proof. It does not authorize credentials, live provider calls, Google mutation, deployment, staging, commit, push, publication, or cleanup. The live two-account ingestion harness and native Google acceptance remain owner-run evidence and must be labeled unverified in the build handoff.

# Required proof

- Fresh deterministic tests for domain invariants, response validation, scoring, state transitions, stale callbacks, request retry lineage, literal-cell safety, fixed workbook shape, and exactly-once export behavior using fakes.
- Fresh Apps Script bundle/static checks and a complete synthetic end-to-end local flow through the same client and domain contracts used by production adapters.
- Browser proof at the required responsive breakpoints and 200% zoom, keyboard tab behavior, focus/live-region behavior, error and export-retry recovery, print expansion/restoration, forced-colors/reduced-motion rules, and zero console errors.
- Product Design comparison against the approved revision 9 visual target, with `design-qa.md` ending in `final result: passed` before handoff.
- Final diff/status review proving protected files and external systems were not changed by this build.

# Stop conditions

- Stop before any action that needs a provider credential, live Google authorization, deployment, sharing change, production document, external publication, staging, commit, or push.
- Stop rather than weaken exact five-tab export, immutable-ID joins, literal-value safety, stale-callback rejection, incomplete-not-fail semantics, or exactly-once export.
- Stop and ask if a protected user change overlaps a required production file or if the approved design and a product contract materially conflict without an already recorded owner decision.
