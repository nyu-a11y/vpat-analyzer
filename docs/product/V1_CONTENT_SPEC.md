# V1 content specification

## Voice

Use calm, direct language that explains the user’s task and the boundary of the result. Prefer “choose,” “analyze,” “report,” and “Google Sheet” over implementation terms. Never expose prompt, provider, parser, schema, queue, callback, Apps Script, or API-key jargon in ordinary UI. Do not imply human certification, legal approval, exhaustive accessibility conformance, or guaranteed correctness.

## Ready-state copy

**Page title:** VPAT Analyzer

**Purpose:** Review the WCAG tables in one VPAT 2.5 and create a private Google Sheet with line-item and report-quality findings.

**Input guidance:** Choose a Google Doc, DOCX, or searchable PDF from Google Drive. Scanned PDFs are not supported because this version does not use OCR.

**Output guidance:** Your result will be created in `My Drive/VPAT Analyzer Results` and will not be shared by this app.

**Primary action:** Choose from Google Drive

Keep the Ready workspace source-focused: show the product heading, source chooser, supported formats, analysis scope, scanned-PDF limitation, privacy, and destination guidance without repeating them in a separate hero or numbered choose/review/analyze strip. Do not show local-upload controls, provider selection, API-key fields, batch/history language, or unsupported standards.

## Selected-file summary

Show, when deterministically known:

- Literal display name, type, and size.
- VPAT version (`2.5` required).
- Declared WCAG version and levels, retaining A, AA, and AAA rows in scope when present.
- A concise eligibility message: `Ready to analyze WCAG tables.`

Primary action: `Analyze VPAT`. Secondary action: `Choose a different file`.

The shared visual fixture is synthetic: `Northstar Collaboration Suite VPAT 2.5.docx`, `DOCX · 1.8 MB`, `WCAG 2.2 A/AA`.

## Processing copy

Use only these five event-backed stage labels, in order:

1. Preparing the source
2. Extracting WCAG tables
3. Checking criteria and coverage
4. Analyzing report quality
5. Preparing your Google Sheet

Use indeterminate activity and an optional plain-language explanation of the current event. Never show a made-up percent, completion time, rotating fabricated subtask, or claim that later stages have begun before their event arrives.

## Error and recovery copy

| Condition | Heading | Required explanation | Primary action |
| --- | --- | --- | --- |
| Inaccessible Drive file | We can’t access this file | Confirm that the user can open it in Drive, then choose it again. Do not disclose permissions beyond what is known. | Choose another file |
| Unsupported type or VPAT version | This file isn’t supported | V1 accepts one VPAT 2.5 Google Doc, DOCX, or searchable PDF. | Choose another file |
| Non-searchable PDF | This PDF doesn’t contain enough searchable text | Scanned or image-only PDFs cannot be analyzed because V1 does not use OCR. | Choose another file |
| No eligible WCAG tables | We couldn’t find VPAT 2.5 WCAG tables | Only WCAG conformance tables are analyzed; body prose and other standards tables are excluded. | Choose another file |
| Retryable provider failure | Analysis was interrupted | No quality grade was assigned. The user may retry within the configured limit. | Try analysis again |
| Permanent analysis failure | We couldn’t complete this analysis | Give a safe, nontechnical reason and state that the result is incomplete, not failed quality. | Analyze another file |
| Export failure after analysis | Your analysis is complete, but the Sheet wasn’t created | The saved analysis can be exported again without reanalyzing the VPAT. | Try creating the Sheet again |
| NYU access failure | NYU access is required | The app is available through the authorized NYU deployment to eligible accounts. | Try again |

Never label an operational problem as a quality `Fail`, assign an `F`, or suggest that retrying export reruns analysis.

## Success copy

**Heading:** Your VPAT analysis is ready

**Primary result:** Use `Report quality: B (82%)` only for the completed design/test fixture and make it the dominant result. Show `4 items to review` as a control that moves focus to `Items needing review`; omit that control instead of displaying zero. The representative values `55 criteria reviewed` and `16 quality requirements` remain valid detailed, print, and workbook content but are not required as hero metrics.

**Location:** Created privately in `My Drive/VPAT Analyzer Results`.

**Primary action:** Open Google Sheet (new tab)

**Adjacent action:** Save as PDF

**Final action after the result workspace:** Analyze another

## Web review workspace and Sheet tabs

The completed web app uses exactly three accessible review views, in order: `Summary`, `WCAG criteria`, and `Report quality`.

- `Summary` leads with expandable items needing review, followed by source and output-location details.
- `WCAG criteria` contains representative line-item results, the author response, analyzer assessment, reviewer action, and confidence.
- `Report quality` combines the completed score, representative quality checks, exact evidence, analyzer assessment, reviewer action, and scoring bands.

These are web review views, not exported workbook tabs. The Google Sheet retains exactly five tabs in this order: `Overview`, `Line-item Review`, `Quality Requirements`, `Scoring`, and `Methodology & disclaimer`. The consolidated web presentation must never change the workbook schema or stable identifiers.

Use `All shown` and `Needs review` filters for WCAG criteria and report-quality checks when review items exist. The criterion or quality-requirement name is the disclosure trigger. WCAG details show `Conformance Level (author)`, `Remarks and Explanations (author)`, analyzer assessment, reviewer action, and confidence. Report-quality details show the requirement, evidence location, exact evidence, analyzer assessment, and reviewer action. Prototype `QR-*` labels are synthetic display examples only; production uses the immutable `qr-*` catalog IDs.

In the web app, `Methodology & disclaimer` is a disclosure after the three review views. In the resulting Google Sheet it remains the fifth exact tab.

## Local PDF copy

`Save as PDF` opens the browser print flow from immutable completed analysis. The print presentation exposes all review views, unfiltered rows, evidence disclosures, scoring bands, and methodology, then restores the prior interactive view/filter/disclosure state. It is client-side and receipt-free: it does not create or upload a Drive artifact, call a provider, rerun analysis, alter the Sheet receipt, or become the authoritative output.

## Methodology and disclaimer content

The web disclosure and the Sheet's `Methodology & disclaimer` tab must explain that the report:

- Reviews only extracted VPAT 2.5 WCAG table content and does not test the product itself.
- Uses automated analysis that may be incomplete or incorrect and should be reviewed by a qualified person.
- Separates source conformance statements from report-quality checks.
- Treats ingestion, missing-result, provider, and export problems as `Incomplete` or `Error`, never as quality `Fail` or an `F` grade.
- Uses a default confidence review threshold of 70 until calibrated.
- Identifies the catalog, rubric, scoring, prompt, and response-schema versions.

Do not claim legal advice, certification, NYU endorsement of the vendor’s claims, or production proof that Stage 0 has not established.

## Accessible content behavior

- Labels remain visible; placeholders are examples, not labels.
- Error text names the problem and next action and is associated with the relevant control.
- Polite status and assertive error/completion regions are separate and avoid repeated announcements.
- Link and button text describes its result without surrounding context.
- Status terms include text in forced-colors and high-contrast use; icons are supplemental.
- Literal user/source strings are safely rendered and written to Sheets; they never become markup or formulas.
