# Workbook contract

## Creation and privacy

One completed request creates at most one new private Google Sheet in `My Drive/VPAT Analyzer Results`, owned by the accessing user under the intended Apps Script execution model. A retryable export failure may retry export from the same immutable analysis output; it must not rerun ingestion or AI analysis. A stored export receipt keyed by stable request ID is the authority for exactly-once finalization.

Stage 0 defines this model but does not prove Google Sheet creation, Drive folder behavior, permissions, formatting, or Apps Script identity.

## Exact tab set and order

1. `Overview`
2. `Line-item Review`
3. `Quality Requirements`
4. `Scoring`
5. `Methodology & disclaimer`

No other tab is part of the V1 export.

This exact five-tab set applies to the exported Google Sheet. The web app may consolidate the same completed content into the approved reviewer-focused views `Summary`, `WCAG criteria`, and `Report quality` without changing the export schema, IDs, data responsibilities, or order.

## Tab responsibilities

| Tab | Required contents |
| --- | --- |
| Overview | Source display name and type, declared VPAT/WCAG scope, request status, completed analysis summary, quality grade when complete, incomplete/error callouts, and links to the detailed tabs. |
| Line-item Review | One row per expected WCAG catalog criterion in the selected standard/level scope, with immutable criterion ID, SC number/title/level, source conformance and remarks, normalized conformance result, confidence, evidence, and status. Missing or malformed AI results are `Incomplete`, never `Fail`. |
| Quality Requirements | The exact 16 versioned rubric items with stable IDs, aliases, type, impact, result, evidence, guidance, confidence, and status. Provider or missing results are `Incomplete`, never `Fail`. |
| Scoring | Trusted-template calculations or precomputed literal values for applicable completed quality checks, earned/possible weight, percentage, and grade. Incomplete operational states display `Incomplete` and no letter grade. |
| Methodology & disclaimer | Version identifiers, supported scope, deterministic-ingestion statement, AI limitations, confidence threshold, scoring bands, error semantics, and disclaimer. |

## Literal-value boundary

Every source- or user-controlled string is written as literal text, including values beginning with `=`, `+`, `-`, `@`, tabs, carriage returns, or line feeds. The export adapter must escape or force literal cell input before calling Sheets APIs. Only formulas from a reviewed, versioned template allowlist may be written with formula semantics; AI output can never create or select a formula.

## Incomplete and error presentation

- `Pass` and `Fail` are available only to completed quality evaluations.
- Missing criteria, malformed responses, provider errors, ingestion errors, and export errors use `Incomplete` or `Error` in operational fields.
- An incomplete run has no quality letter grade, even if partial completed rows would numerically fall in the F band.
- A line-item conformance value such as `Does Not Support` is source/conformance data, not itself an operational quality `Fail`.
- The default confidence threshold is 70. Values below it are flagged for review without silently changing the result.

## Formatting requirements for later proof

Headers remain visible when scrolling; tables have filters where useful; widths prioritize readable criterion titles, evidence, remarks, and guidance; wrapped text remains legible; status is never communicated by color alone; keyboard focus is visible; and the workbook remains understandable at practical zoom and in print. These are simulated-preview requirements until an authorized native Sheets write proves them.

## Provenance

Each export model records contract, catalog, rubric, scoring, prompt, and schema versions plus the stable request ID. It must not include provider secrets, real deployment identifiers, source binaries, page images, or hidden central history.
