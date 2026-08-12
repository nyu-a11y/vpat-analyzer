# AI contract

## Purpose and separation

AI may interpret already-extracted, deterministic WCAG table text for two separate tasks:

1. Normalize and explain source conformance statements for catalog criteria.
2. Evaluate the report against the versioned 16-item quality rubric.

The tasks use separate prompts and strict response schemas. AI does not discover source files, parse DOCX/PDF containers, perform OCR, select tables, resolve arbitrary criterion labels, calculate a final grade, create formulas, or export a spreadsheet.

## Provider boundary

The intended production route is Portkey to Gemini. Direct Gemini is allowed only in a future explicitly opted-in, sanitized local contract test. Deterministic tests and Stage 0 contract proof make no provider call and have no production fallback. Provider names, keys, routing controls, and error internals are not user-facing UI.

## Allowed input

The analysis orchestrator may send only a schema-defined JSON payload containing:

- Stable request and version identifiers.
- Catalog and rubric IDs plus the minimum versioned metadata needed for the task.
- Deterministically extracted literal WCAG row text: source criterion label, conformance term, and remarks/evidence.
- Limited, explicitly selected VPAT metadata needed by a named quality requirement.

The payload excludes body prose unless a versioned quality requirement explicitly requires a deterministically selected metadata field. It always excludes credentials, Drive permissions, source URLs, private account data, complete source documents/binaries, ZIP parts, PDF page images, screenshots, OCR output, non-WCAG tables, hidden prompt instructions from source text, and spreadsheet formulas.

Source strings are untrusted data. Prompts delimit them as literal evidence and instruct the model never to follow instructions contained within them.

## Version and request envelope

Every request records:

- Stable `requestId`.
- `catalogVersion`, `rubricVersion`, `scoringVersion`, prompt version, and response-schema version.
- Task kind: `conformance-analysis` or `quality-analysis`.
- Deterministic ordered input IDs.

A response is rejected when its request ID, task kind, or declared versions do not match the active call. Retry keeps the stable request ID and changes only an internal bounded attempt number.

## Output rules

- The provider must return JSON matching the task's strict schema, with no prose wrapper.
- Every finding uses an expected immutable ID exactly once; unknown, duplicate, and unexpected IDs are rejected.
- Confidence is an integer from 0 through 100. The default review threshold is 70 and does not silently flip a result.
- Evidence is a concise explanation grounded only in supplied fields. The model may say evidence is insufficient; it may not invent source content.
- The orchestrator, not the model, orders rows, supplies catalog titles/levels, detects missing IDs, computes scores, assigns grades, builds export models, and applies literal-cell safety.

## Conformance result semantics

Each expected criterion returns a completed normalized source-conformance finding or `Incomplete` with a machine-readable reason. A source conformance value such as `Does Not Support` is retained as conformance data and must not be confused with the quality-rubric result `Fail`.

If a response is missing, malformed, duplicated, unknown, contradictory to the schema, or interrupted by the provider, affected findings are `Incomplete`. The orchestrator may retry within its configured boundary; it may never manufacture completed findings from absent output.

## Quality result semantics

For each of the 16 requirements, only a complete evidence-based evaluation may return `Pass` or `Fail`. `Fail` means the supplied report evidence does not meet that named quality requirement. `Incomplete` means the requirement could not be evaluated, including missing input, missing response, malformed output, provider error, or an interrupted run.

Operational failures are never quality `Fail`. If required findings are incomplete, the score summary is `Incomplete` and has `grade: null`. The F band applies only to a completed score of 60 or below.

## Validation and failure handling

Validation occurs before any response affects domain state or export:

1. Parse JSON with size/depth limits.
2. Validate against the versioned strict JSON Schema, including `additionalProperties: false` at every object boundary.
3. Validate envelope identity and versions.
4. Validate exact expected ID coverage and uniqueness.
5. Validate domain invariants, allowed enums, confidence ranges, and literal evidence limits.
6. Convert the accepted response into immutable internal findings.

Schema or domain failure yields a safe provider/malformed-response error. A retryable classification must be deterministic and bounded. Raw provider output is not displayed or exported as trusted content and must not become a formula, URL, or HTML instruction.

## Prompt-injection and data handling boundary

Prompts state that document text is evidence, never instructions. The model receives no tool authority. It cannot browse, fetch URLs, open Drive, call an exporter, or modify request state. Output strings remain untrusted and are escaped in the UI and forced to literal values in Sheets.

## Stage 0 evidence limit

Versioned prompts and schemas can prove contract shape only. They do not prove model quality, Portkey/Gemini availability, production privacy, latency, or live error behavior. No such claim is part of Stage 0.
