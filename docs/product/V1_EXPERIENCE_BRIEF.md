# V1 experience brief

## Experience goal

Make a single consequential task feel calm, legible, and trustworthy: choose one eligible VPAT from Google Drive, understand what will be analyzed, follow truthful named processing stages, recover from a problem without losing valid work, and open the resulting private Google Sheet.

## Audience and context

The audience is any NYU user with the application URL. Users may know accessibility policy but should not need to understand parsers, prompts, model routing, Apps Script, or workbook internals. The interface must explain limitations in plain language and never ask for a provider key.

## Visual selection gate

Three high-fidelity directions have already been rendered using the same fixture and state set:

- Calm Utility — quiet, centered, and deliberately single-task.
- Guided Assurance — a compact choose/analyze/receive journey.
- Document Workbench — a wider professional-tool treatment.

The owner approved the optimized Document Workbench direction on 2026-08-12. `selectedDirection` is `Document Workbench` and `selectionStatus` is `approved`. The approval reference is the Local Codex Open Design project `nyu-vpat-analyzer-document-workbench-optimized`, with `nyu-vpat-analyzer.html` as its entry artifact. The current approved artifact is `approvedRevision: 9` with `approvedArtifactSha256: 300be6052711fd76e436de8c950a67cb66c4c7555f03453703bd76c360944c95`.

Document Workbench is now the sole V1 production design authority. Calm Utility and Guided Assurance remain historical candidate references and must not be blended into the selected direction. This approval clears only the visual-selection gate; it does not authorize production UI implementation, deployment, or bypass the blocked ingestion gate.

## Approved review-workspace refinement

Revision 9 keeps the exact five-tab Google Sheet as the authoritative output while consolidating the web app into three reviewer-focused views: `Summary`, `WCAG criteria`, and `Report quality`. These review views are a presentation layer, not workbook tabs. `Report quality` combines the score and quality checks in the app; `Methodology & disclaimer` is an app disclosure below the views. The resulting Sheet remains exactly `Overview`, `Line-item Review`, `Quality Requirements`, `Scoring`, and `Methodology & disclaimer`, in that order.

The completed state is reviewer-first: make the grade prominent, show a nonzero review count as a jump to `Items needing review`, expose source statements and analyzer assessments on demand, provide `All shown` and `Needs review` filters, and place `Analyze another` after the completed result workspace. `Save as PDF` invokes the browser print flow for a local copy of immutable completed results; it is not a second server-side export, Drive artifact, or authoritative receipt.

## Shared realistic fixture

- File: `Northstar Collaboration Suite VPAT 2.5.docx`
- Type and size: DOCX, 1.8 MB
- Scope: WCAG 2.2 A/AA
- Analysis summary: 55 criteria, 16 quality requirements, 4 items to review
- Completed result: report quality B, 82%
- Representative error: a scanned, non-searchable PDF that V1 cannot analyze because OCR is out of scope

Fixture names and results are synthetic product-design content, not production evidence or a real Drive file.

## Interaction principles

- One dominant action at a time, with the chosen file and supported formats immediately clear.
- Processing uses five event-backed stage names and indeterminate activity; never fabricated percentages or time remaining.
- Recovery preserves the stable request and immutable completed analysis where safe. Export-only retry never reanalyzes.
- Stale callbacks are silent: they do not change the DOM, focus, announcements, or export behavior.
- Success offers `Open Google Sheet (new tab)`, local `Save as PDF`, and `Analyze another` with clear privacy and output-folder language.
- Errors distinguish access, unsupported type/version, non-searchable PDF, retryable provider failure, permanent failure, and export-only failure.

## Accessibility baseline

Target WCAG 2.2 AA behavior: semantic headings and controls; explicit labels and instructions; visible focus; logical reading/focus order; polite status and assertive error live regions; focus movement/restoration after state changes; 44 px minimum action targets; reflow at 320 px and 200% zoom; no color-only meaning; forced-colors support; reduced-motion support; and no fake progress. VoiceOver, keyboard operation, focus restoration, reading order, 200% zoom/reflow, and final visual comparison require owner sign-off and remain unchecked in Stage 0.
