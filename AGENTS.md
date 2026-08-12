# Repository Instructions

These rules apply to this repository and all descendants.

## Product boundary

- V1 is an NYU-internal Google Apps Script web app: one VPAT 2.5 Google Doc, DOCX, or searchable PDF selected from Google Drive produces one new private Google Sheet in `My Drive/VPAT Analyzer Results`.
- Only WCAG tables are analyzed. There is no OCR, local upload, history, tenancy, collaboration, monitoring, review system, or provider-selection UI in V1.
- Treat `VPATAnalyzer` as reference-only legacy code. Do not extend its Drive-conversion/OCR path or its workbook schema into the modular V1 architecture.
- Production UI is forbidden until the owner selects exactly one documented visual direction.

## Protected state

- Preserve unrelated and user-authored changes. Never reset, discard, reformat, or silently overwrite them.
- Never open, read, print, copy, transmit, or commit `.env.local`.
- Never commit generated output spreadsheet IDs, deployment IDs, credentials, access tokens, provider secrets, private user document IDs or content, Drive files, or browser evidence. Canonical reference URLs explicitly supplied for repository traceability are allowed.
- Tests use committed synthetic fixtures only and have no production fallback.

## Authority

- Local source, contract, fixture, dependency, test, and preview work is allowed when requested.
- Do not stage, commit, push, deploy, run mutating `clasp` commands, alter Google Drive/Sheets, configure real providers, or call Portkey/Gemini without explicit task authority.
- User/source text written to Sheets is literal text. Formulas are allowed only from trusted, versioned templates.

## Engineering contract

- Use immutable internal catalog and rubric IDs; source numbers and labels are aliases only.
- Incomplete, missing, provider, and export errors are never quality `Fail` and never an `F` grade.
- Reject stale callbacks by stable request ID without DOM, focus, announcement, or export effects.
- Retry export from immutable analysis output without reanalysis; one request may produce at most one final spreadsheet.
- Keep modules deterministic and Apps-Script/HtmlService-compatible. Provider calls are outside deterministic tests.
- After the final relevant edit, rerun the affected proof, inspect the diff/status, and label missing live or manual evidence honestly.
