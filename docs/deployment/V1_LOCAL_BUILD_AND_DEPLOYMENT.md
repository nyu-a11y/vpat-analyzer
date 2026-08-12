# V1 local build and deployment handoff

## What is built

The production package is a Google Apps Script web app that executes as the accessing NYU user. It uses the approved Document Workbench revision 9, runs deterministic Google Doc/DOCX/searchable-PDF ingestion before provider analysis, and creates at most one private spreadsheet with exactly these tabs:

1. `Overview`
2. `Line-item Review`
3. `Quality Requirements`
4. `Scoring`
5. `Methodology & disclaimer`

The web review workspace is intentionally different: it has `Summary`, `WCAG criteria`, and `Report quality` views, plus a `Methodology & disclaimer` disclosure.

## Local commands

```sh
npm install
npm run build:v1
npm run preview:v1
```

Open `http://127.0.0.1:4175/local.html`. The preview uses committed synthetic Northstar data and never calls Google, Portkey, or Gemini.

Run all local deterministic and browser evidence with:

```sh
npm run proof:stage1
```

Generated deployment files are written to `build/v1/`. The directory is ignored by Git and contains the single inline `Index.html`, Apps Script server files, `appsscript.json`, a local preview, and a hash manifest.

## Provider configuration

Set these as Apps Script **Script Properties** in the deployment project; never put them in source, HtmlService, user properties, or a Sheet:

- `VPAT_PORTKEY_API_KEY`
- `VPAT_PORTKEY_VIRTUAL_KEY`
- `VPAT_GEMINI_MODEL`

The app has no provider-selection or API-key UI. Production analysis routes through Portkey to the configured Gemini model. Local tests make no provider call.

## Apps Script deployment

1. Create or select the production Apps Script project owned by the appropriate NYU account.
2. Copy or push only the generated files from `build/v1/` (excluding `local.html` and `build-manifest.json`).
3. Confirm the manifest uses domain access and `USER_ACCESSING` execution.
4. Enable the Advanced Drive v3 and Sheets v4 services in the linked Google Cloud project if the manifest has not done so automatically.
5. Add the three provider Script Properties.
6. Deploy as a web app restricted to the NYU domain.
7. Verify with an eligible NYU account using only synthetic or approved test content before using a vendor VPAT.

Deployment, credentials, Google mutations, and provider calls are intentionally not performed by the local build task.

## Owner-run acceptance

One NYU account is sufficient to verify the main workflow: Drive selection, source parsing, analysis, private Sheet creation, exact five-tab order, export-only retry, and opening the result.

A second account is optional. It is useful only for a strict inaccessible-file test where one account owns a private synthetic source and another account proves the app rejects access without changing sharing. It is not required to build, deploy, or use the product.

The remaining owner-run checks are:

- actual `DocumentApp` serialization and HtmlService `google.script.run` transport;
- a live Portkey-to-Gemini response using the configured contracts;
- native Google Sheet ownership, privacy, formatting, and exactly-once reconciliation;
- final VoiceOver and native browser zoom review.

Operational failures remain `Incomplete` or `Error`; they never become a report-quality `Fail` or an `F` grade.
