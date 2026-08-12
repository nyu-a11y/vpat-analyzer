# Source registry

This registry records authority and discrepancies. The following owner-supplied canonical reference URLs are intentionally committed for traceability; they are not deployment bindings, generated-output IDs, credentials, or private user-document references.

| Source | Authority in V1 | Repository use | Known discrepancy or constraint |
| --- | --- | --- | --- |
| [Live VPAT Analyzer workbook](https://docs.google.com/spreadsheets/d/1ggV8Vk9ILleDKji20WH5bCT6jJI2734w3IPFKJt0LqU/edit) | Canonical for current five-tab analysis content and the 16 quality requirements | Read-only observation summarized in versioned contracts | Live tabs are `Start`, `Line-item Review`, `Quality Requirements`, `Scoring`, and `Advanced Settings`; only `Start` is visible. It has no `Overview` or `Methodology & disclaimer` tab. Its schema is incompatible with the legacy monolith and is not suitable for configuration-only conversion. Existing API-key entry UI on `Start` is forbidden in V1. |
| [Broader quality-rubric workbook](https://docs.google.com/spreadsheets/d/1aBOmkBnK_fyNdcn_TKApQ-SwqIG94_WFt_WkFMLQSqk/edit) | Alias and provenance reference for the canonical 16-item rubric | Read-only observation captured as aliases in `quality-rubric.v1.json` | One broader-rubric row has a blank `ReqID`; stable primary IDs therefore use `qr-e12`-style identifiers, while numeric and broader IDs are aliases only. |
| [Help Guide](https://docs.google.com/document/d/1QnzKG6oj9LCS9m4P9Sy2oSwhe2oWbTO3QZ1MEw2mIR4/edit) | Terminology and workflow reference | Read-only product/content reference | It is not runtime configuration and cannot override the resolved V1 boundary or error semantics. |
| Directory reference application (`/Users/ms9513/Documents/Repositories/directory`) | Mandatory accessibility and interface baseline | Reuse NYU tokens and patterns conceptually | Reuse visible focus, screen-reader utilities, 44 px actions, responsive reflow, live regions, forced-colors, and reduced-motion behavior. Do not copy the dense panels, multi-view navigation, dashboard architecture, or whole stylesheet. |
| `VPATAnalyzer` legacy tree | Reference-only implementation evidence | Inspect only when explicitly needed | Its OCR/Drive-conversion path and workbook schema are outside the modular V1 architecture and must not be extended. |
| Versioned repository contracts | Runtime implementation authority after owner acceptance | Immutable IDs, schemas, prompts, state semantics, and tests | Must remain traceable to the canonical sources while avoiding real identifiers or source document content. |

## Authority order

Resolved owner decisions and repository policy govern product scope. The live workbook governs the current rubric content where it does not conflict with those decisions. Versioned repository IDs govern runtime joins. Human-readable numbers, labels, source row positions, and broader-workbook IDs are aliases and may never be used as primary keys.

## Recorded schema differences

- V1 exports `Overview` and `Methodology & disclaimer`; neither exists in the live workbook.
- V1 does not export `Start` or `Advanced Settings`; both exist in the live workbook.
- The live `Start` API-key surface is removed because V1 has no provider-selection or user-secret UI.
- The legacy monolith's tabs, Drive-conversion/OCR behavior, and number-led criterion matching are not V1 contracts.
- V1 uses an 87-item WCAG union catalog, stable `wcag-sc-*` IDs, and strict response schemas instead of leading-number matching.
- The broader rubric's single blank `ReqID` is retained as a provenance anomaly, not propagated as a runtime identifier.
