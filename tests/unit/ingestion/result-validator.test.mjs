import assert from "node:assert/strict";
import test from "node:test";

import {
  IngestionResultValidationError,
  validateIngestionResult,
} from "../../../src/ingestion/core/index.mjs";
import {
  ingestSourceBytes,
  ingestStructuredSource,
} from "../../../src/ingestion/browser/ingest-bytes.mjs";

function validCompleteResult() {
  return {
    schemaVersion: "1.0.0",
    requestId: "request-result-validator",
    parserVersion: "1.0.0",
    catalogVersion: "1.0.0",
    sourceType: "docx",
    status: "complete",
    candidateTables: [
      {
        tableId: "table-wcag",
        sourceOrder: 0,
        classification: "wcag",
        reasonCode: "ELIGIBLE_WCAG_HEADERS",
        headers: ["Criteria", "Conformance Level", "Remarks and Explanations"],
      },
    ],
    rows: [
      {
        rowId: "row-001",
        criterionId: "wcag-sc-1.1.1",
        sourceCriterionLabel: "1.1.1 Non-text Content",
        sourceConformance: "Supports",
        sourceRemarks: "Synthetic remarks.",
        sourceTableIndex: 0,
        sourceRowIndex: 1,
        aliasMatch: "exact-sc-plus-official-title",
      },
    ],
    excludedRows: [],
    duplicates: [],
    coverage: {
      declaredWcagVersions: ["2.2"],
      declaredLevels: ["A", "AA"],
      expectedCriterionIds: ["wcag-sc-1.1.1"],
      extractedCriterionIds: ["wcag-sc-1.1.1"],
      missingCriterionIds: [],
    },
  };
}

function validRejectedResult() {
  return {
    schemaVersion: "1.0.0",
    requestId: "request-result-validator",
    parserVersion: "1.0.0",
    catalogVersion: "1.0.0",
    sourceType: "unknown",
    status: "rejected",
    rejection: {
      code: "SOURCE_TYPE_UNSUPPORTED",
      stage: "classification",
      safeMessage: "The selected source type is not supported.",
    },
  };
}

function validReportEvidence() {
  return {
    templateVersion: "VPAT template version 2.5Rev",
    productDescription: "Product description: Synthetic collaboration service",
    reportDate: "Report date: August 12, 2026",
    contactInformation: "Accessibility contact: accessibility@example.edu",
    evaluationMethods: "Evaluation methods: expert review",
    assistiveTechnologyTesting: "Assistive technology testing: NVDA",
    manualTesting: "Manual testing: keyboard review",
    automatedTesting: "Automated testing: axe-core",
    testerFamiliarity: "Tester familiarity: advanced product knowledge",
    conformanceDefinitions: "Conformance terms are defined.",
    scopeNotes: "Evaluation scope: web application",
  };
}

function changed(base, mutate) {
  const value = structuredClone(base);
  mutate(value);
  return value;
}

function assertInvalid(value, path) {
  assert.throws(
    () => validateIngestionResult(value),
    (error) => {
      assert.ok(error instanceof IngestionResultValidationError);
      if (path) assert.equal(error.path, path);
      assert.equal(error.safeMessage, "The ingestion result failed deterministic validation.");
      return true;
    },
  );
}

function addSecondExtractedRow(result) {
  result.rows.push({
    ...result.rows[0],
    rowId: "row-002",
    criterionId: "wcag-sc-1.2.1",
    sourceCriterionLabel: "1.2.1 Audio-only and Video-only (Prerecorded)",
    sourceRowIndex: 2,
  });
  result.coverage.expectedCriterionIds.push("wcag-sc-1.2.1");
  result.coverage.extractedCriterionIds.push("wcag-sc-1.2.1");
}

function addDuplicateGroup(result, overrides = {}) {
  const duplicateRow = {
    ...result.rows[0],
    rowId: "row-002",
    sourceRowIndex: 2,
    sourceConformance: "Partially Supports",
    sourceRemarks: "Duplicate synthetic row.",
    ...overrides,
  };
  result.excludedRows.push({
    sourceTableIndex: duplicateRow.sourceTableIndex,
    sourceRowIndex: duplicateRow.sourceRowIndex,
    sourceLabel: duplicateRow.sourceCriterionLabel,
    reasonCode: "DUPLICATE_CRITERION",
  });
  result.duplicates.push({
    criterionId: duplicateRow.criterionId,
    keptRowId: result.rows[0].rowId,
    duplicateRows: [duplicateRow],
  });
  return duplicateRow;
}

test("accepts complete and rejected v1 results without cloning or mutation", () => {
  const complete = validCompleteResult();
  const rejected = validRejectedResult();

  assert.equal(validateIngestionResult(complete), complete);
  assert.equal(validateIngestionResult(rejected), rejected);
  assert.deepEqual(complete, validCompleteResult());
  assert.deepEqual(rejected, validRejectedResult());
});

test("accepts only a closed, bounded report-evidence projection when supplied", () => {
  const complete = validCompleteResult();
  complete.reportEvidence = validReportEvidence();
  assert.equal(validateIngestionResult(complete), complete);

  assertInvalid(changed(complete, (value) => { value.reportEvidence.extra = "x"; }), "$.reportEvidence");
  assertInvalid(changed(complete, (value) => { value.reportEvidence.reportDate = "x".repeat(1001); }), "$.reportEvidence.reportDate");
});

test("enforces closed required result shapes and common constants", () => {
  const complete = validCompleteResult();
  const rejected = validRejectedResult();

  const cases = [
    [null, "$"],
    [[], "$"],
    [changed(complete, (value) => { delete value.status; }), "$"],
    [changed(complete, (value) => { value.extra = true; }), "$"],
    [changed(complete, (value) => { value.schemaVersion = "2.0.0"; }), "$.schemaVersion"],
    [changed(complete, (value) => { value.requestId = ""; }), "$.requestId"],
    [changed(complete, (value) => { value.requestId = "x".repeat(129); }), "$.requestId"],
    [changed(complete, (value) => { value.parserVersion = "1.0"; }), "$.parserVersion"],
    [changed(complete, (value) => { value.catalogVersion = "1.0.1"; }), "$.catalogVersion"],
    [changed(complete, (value) => { value.sourceType = "unknown"; }), "$.sourceType"],
    [changed(rejected, (value) => { value.rows = []; }), "$"],
    [changed(rejected, (value) => { value.sourceType = "rtf"; }), "$.sourceType"],
    [changed(rejected, (value) => { value.status = "pending"; }), "$.status"],
  ];

  for (const [value, path] of cases) assertInvalid(value, path);

  const sparse = validCompleteResult();
  sparse.candidateTables = Array(1);
  assertInvalid(sparse, "$.candidateTables[0]");

  const arrayWithProperty = validCompleteResult();
  arrayWithProperty.rows.extra = true;
  assertInvalid(arrayWithProperty, "$.rows");

  const accessorStatus = validCompleteResult();
  Object.defineProperty(accessorStatus, "status", { enumerable: true, get: () => "complete" });
  assertInvalid(accessorStatus, "$.status");
});

test("enforces candidate-table structure, bounds, enums, and classification semantics", () => {
  const base = validCompleteResult();
  const cases = [
    [changed(base, (value) => { value.candidateTables = []; }), "$.candidateTables"],
    [changed(base, (value) => { value.candidateTables[0].extra = "x"; }), "$.candidateTables[0]"],
    [changed(base, (value) => { value.candidateTables[0].tableId = ""; }), "$.candidateTables[0].tableId"],
    [changed(base, (value) => { value.candidateTables[0].tableId = "x".repeat(129); }), "$.candidateTables[0].tableId"],
    [changed(base, (value) => { value.candidateTables[0].sourceOrder = -1; }), "$.candidateTables[0].sourceOrder"],
    [changed(base, (value) => { value.candidateTables[0].sourceOrder = 0.5; }), "$.candidateTables[0].sourceOrder"],
    [changed(base, (value) => { value.candidateTables[0].classification = "layout"; }), "$.candidateTables[0].classification"],
    [changed(base, (value) => { value.candidateTables[0].reasonCode = "UNKNOWN"; }), "$.candidateTables[0].reasonCode"],
    [changed(base, (value) => { value.candidateTables[0].reasonCode = "NON_WCAG_TABLE"; }), "$.candidateTables[0].reasonCode"],
    [changed(base, (value) => { value.candidateTables[0].headers = Array(33).fill(""); }), "$.candidateTables[0].headers"],
    [changed(base, (value) => { value.candidateTables[0].headers = ["x".repeat(501)]; }), "$.candidateTables[0].headers[0]"],
  ];

  for (const [value, path] of cases) assertInvalid(value, path);
});

test("enforces every top-level complete-result collection bound", () => {
  const base = validCompleteResult();
  const cases = [
    [changed(base, (value) => { value.candidateTables = Array.from({ length: 129 }, () => structuredClone(value.candidateTables[0])); }), "$.candidateTables"],
    [changed(base, (value) => { value.rows = Array.from({ length: 88 }, () => structuredClone(value.rows[0])); }), "$.rows"],
    [changed(base, (value) => { value.excludedRows = Array.from({ length: 5001 }, () => ({ sourceTableIndex: 0, sourceRowIndex: 0, sourceLabel: "", reasonCode: "BODY_PROSE" })); }), "$.excludedRows"],
    [changed(base, (value) => { value.duplicates = Array.from({ length: 88 }, () => ({ criterionId: "wcag-sc-1.1.1", keptRowId: "row-001", duplicateRows: [structuredClone(value.rows[0])] })); }), "$.duplicates"],
  ];

  for (const [value, path] of cases) assertInvalid(value, path);
});

test("enforces extracted-row structure, patterns, field bounds, and enums", () => {
  const base = validCompleteResult();
  const cases = [
    [changed(base, (value) => { value.rows = []; }), "$.rows"],
    [changed(base, (value) => { value.rows[0].extra = null; }), "$.rows[0]"],
    [changed(base, (value) => { value.rows[0].rowId = ""; }), "$.rows[0].rowId"],
    [changed(base, (value) => { value.rows[0].rowId = "x".repeat(161); }), "$.rows[0].rowId"],
    [changed(base, (value) => { value.rows[0].criterionId = "1.1.1"; }), "$.rows[0].criterionId"],
    [changed(base, (value) => { value.rows[0].sourceCriterionLabel = ""; }), "$.rows[0].sourceCriterionLabel"],
    [changed(base, (value) => { value.rows[0].sourceCriterionLabel = "x".repeat(1001); }), "$.rows[0].sourceCriterionLabel"],
    [changed(base, (value) => { value.rows[0].sourceConformance = "x".repeat(2001); }), "$.rows[0].sourceConformance"],
    [changed(base, (value) => { value.rows[0].sourceRemarks = "x".repeat(10001); }), "$.rows[0].sourceRemarks"],
    [changed(base, (value) => { value.rows[0].sourceTableIndex = -1; }), "$.rows[0].sourceTableIndex"],
    [changed(base, (value) => { value.rows[0].sourceRowIndex = 1.5; }), "$.rows[0].sourceRowIndex"],
    [changed(base, (value) => { value.rows[0].aliasMatch = "guess"; }), "$.rows[0].aliasMatch"],
  ];

  for (const [value, path] of cases) assertInvalid(value, path);
});

test("enforces excluded-row and duplicate-group schema constraints", () => {
  const duplicate = validCompleteResult();
  addDuplicateGroup(duplicate);
  assert.equal(validateIngestionResult(duplicate), duplicate);

  const cases = [
    [changed(duplicate, (value) => { value.excludedRows[0].extra = true; }), "$.excludedRows[0]"],
    [changed(duplicate, (value) => { value.excludedRows[0].sourceTableIndex = -1; }), "$.excludedRows[0].sourceTableIndex"],
    [changed(duplicate, (value) => { value.excludedRows[0].sourceLabel = "x".repeat(1001); }), "$.excludedRows[0].sourceLabel"],
    [changed(duplicate, (value) => { value.excludedRows[0].reasonCode = "IGNORED"; }), "$.excludedRows[0].reasonCode"],
    [changed(duplicate, (value) => { value.duplicates[0].extra = true; }), "$.duplicates[0]"],
    [changed(duplicate, (value) => { value.duplicates[0].criterionId = "wcag-sc-0.1.1"; }), "$.duplicates[0].criterionId"],
    [changed(duplicate, (value) => { value.duplicates[0].keptRowId = ""; }), "$.duplicates[0].keptRowId"],
    [changed(duplicate, (value) => { value.duplicates[0].duplicateRows = []; }), "$.duplicates[0].duplicateRows"],
    [changed(duplicate, (value) => { value.duplicates[0].duplicateRows[0].extra = true; }), "$.duplicates[0].duplicateRows[0]"],
    [changed(duplicate, (value) => { value.duplicates[0].duplicateRows = Array.from({ length: 512 }, () => structuredClone(value.duplicates[0].duplicateRows[0])); }), "$.duplicates[0].duplicateRows"],
  ];

  for (const [value, path] of cases) assertInvalid(value, path);
});

test("enforces coverage schema constraints and Unicode code-point string lengths", () => {
  const base = validCompleteResult();
  const cases = [
    [changed(base, (value) => { value.coverage.extra = true; }), "$.coverage"],
    [changed(base, (value) => { value.coverage.declaredWcagVersions = []; }), "$.coverage.declaredWcagVersions"],
    [changed(base, (value) => { value.coverage.declaredWcagVersions = ["2.2", "2.2"]; }), "$.coverage.declaredWcagVersions[1]"],
    [changed(base, (value) => { value.coverage.declaredWcagVersions = ["3.0"]; }), "$.coverage.declaredWcagVersions[0]"],
    [changed(base, (value) => { value.coverage.declaredLevels = ["AA", "AA"]; }), "$.coverage.declaredLevels[1]"],
    [changed(base, (value) => { value.coverage.declaredLevels = ["AAAA"]; }), "$.coverage.declaredLevels[0]"],
    [changed(base, (value) => { value.coverage.expectedCriterionIds = []; }), "$.coverage.expectedCriterionIds"],
    [changed(base, (value) => { value.coverage.expectedCriterionIds = Array.from({ length: 88 }, (_, index) => `wcag-sc-1.1.${index + 1}`); }), "$.coverage.expectedCriterionIds"],
    [changed(base, (value) => { value.coverage.extractedCriterionIds = []; }), "$.coverage.extractedCriterionIds"],
    [changed(base, (value) => { value.coverage.missingCriterionIds = ["bad-id"]; }), "$.coverage.missingCriterionIds[0]"],
    [changed(base, (value) => { value.coverage.missingCriterionIds = ["wcag-sc-1.2.1", "wcag-sc-1.2.1"]; }), "$.coverage.missingCriterionIds[1]"],
  ];

  for (const [value, path] of cases) assertInvalid(value, path);

  const codePoints = validCompleteResult();
  codePoints.requestId = "😀".repeat(128);
  assert.equal(validateIngestionResult(codePoints), codePoints);
  codePoints.requestId += "😀";
  assertInvalid(codePoints, "$.requestId");
});

test("enforces rejection object closure, enums, and safe-message bounds", () => {
  const base = validRejectedResult();
  const cases = [
    [changed(base, (value) => { value.rejection.extra = true; }), "$.rejection"],
    [changed(base, (value) => { value.rejection.code = "FAIL"; }), "$.rejection.code"],
    [changed(base, (value) => { value.rejection.stage = "provider"; }), "$.rejection.stage"],
    [changed(base, (value) => { value.rejection.safeMessage = ""; }), "$.rejection.safeMessage"],
    [changed(base, (value) => { value.rejection.safeMessage = "x".repeat(501); }), "$.rejection.safeMessage"],
  ];

  for (const [value, path] of cases) assertInvalid(value, path);
});

test("enforces candidate table identity and strictly increasing source order", () => {
  const base = validCompleteResult();
  const secondTable = {
    tableId: "table-non-wcag",
    sourceOrder: 2,
    classification: "non-wcag",
    reasonCode: "NON_WCAG_TABLE",
    headers: ["Item"],
  };
  base.candidateTables.push(secondTable);
  assert.equal(validateIngestionResult(base), base);

  assertInvalid(
    changed(base, (value) => { value.candidateTables.reverse(); }),
    "$.candidateTables[1].sourceOrder",
  );
  assertInvalid(
    changed(base, (value) => { value.candidateTables[1].tableId = "table-wcag"; }),
    "$.candidateTables[1].tableId",
  );
  assertInvalid(
    changed(base, (value) => { value.candidateTables[1].sourceOrder = 0; }),
    "$.candidateTables[1].sourceOrder",
  );
});

test("enforces row and criterion uniqueness plus eligible table references", () => {
  const duplicateRowId = validCompleteResult();
  addSecondExtractedRow(duplicateRowId);
  duplicateRowId.rows[1].rowId = "row-001";
  assertInvalid(duplicateRowId, "$.rows[1].rowId");

  const duplicateCriterionId = validCompleteResult();
  addSecondExtractedRow(duplicateCriterionId);
  duplicateCriterionId.rows[1].criterionId = "wcag-sc-1.1.1";
  duplicateCriterionId.coverage.expectedCriterionIds = ["wcag-sc-1.1.1"];
  duplicateCriterionId.coverage.extractedCriterionIds = ["wcag-sc-1.1.1"];
  assertInvalid(duplicateCriterionId, "$.rows[1].criterionId");

  const duplicateLocation = validCompleteResult();
  addSecondExtractedRow(duplicateLocation);
  duplicateLocation.rows[1].sourceRowIndex = 1;
  assertInvalid(duplicateLocation, "$.rows[1]");

  const reversedRows = validCompleteResult();
  addSecondExtractedRow(reversedRows);
  reversedRows.rows.reverse();
  reversedRows.coverage.extractedCriterionIds.reverse();
  assertInvalid(reversedRows, "$.rows[1]");

  const danglingTable = validCompleteResult();
  danglingTable.rows[0].sourceTableIndex = 9;
  assertInvalid(danglingTable, "$.rows[0].sourceTableIndex");

  const nonEligibleTable = validCompleteResult();
  nonEligibleTable.candidateTables[0].classification = "non-wcag";
  nonEligibleTable.candidateTables[0].reasonCode = "NON_WCAG_TABLE";
  assertInvalid(nonEligibleTable, "$.rows[0].sourceTableIndex");
});

test("enforces duplicate-group referential integrity and complete accounting", () => {
  const base = validCompleteResult();
  addDuplicateGroup(base);

  assertInvalid(
    changed(base, (value) => { value.duplicates[0].keptRowId = "missing-row"; }),
    "$.duplicates[0].keptRowId",
  );
  assertInvalid(
    changed(base, (value) => { value.duplicates[0].criterionId = "wcag-sc-1.2.1"; }),
    "$.duplicates[0].criterionId",
  );
  assertInvalid(
    changed(base, (value) => { value.duplicates[0].duplicateRows[0].rowId = "row-001"; }),
    "$.duplicates[0].duplicateRows[0].rowId",
  );
  assertInvalid(
    changed(base, (value) => { value.duplicates[0].duplicateRows[0].criterionId = "wcag-sc-1.2.1"; }),
    "$.duplicates[0].duplicateRows[0].criterionId",
  );
  assertInvalid(
    changed(base, (value) => { value.duplicates[0].duplicateRows[0].sourceRowIndex = 1; }),
    "$.duplicates[0].duplicateRows[0]",
  );
  assertInvalid(
    changed(base, (value) => { value.duplicates[0].duplicateRows[0].sourceTableIndex = 9; }),
    "$.duplicates[0].duplicateRows[0].sourceTableIndex",
  );
  assertInvalid(
    changed(base, (value) => { value.excludedRows = []; }),
    "$.duplicates",
  );
  assertInvalid(
    changed(base, (value) => { value.excludedRows[0].sourceRowIndex = 3; }),
    "$.duplicates[0].duplicateRows[0]",
  );
  assertInvalid(
    changed(base, (value) => { value.excludedRows[0].sourceLabel = "Different label"; }),
    "$.excludedRows[0].sourceLabel",
  );

  const reusedDuplicateId = validCompleteResult();
  addSecondExtractedRow(reusedDuplicateId);
  const firstDuplicate = { ...reusedDuplicateId.rows[0], rowId: "duplicate-row", sourceRowIndex: 3 };
  const secondDuplicate = { ...reusedDuplicateId.rows[1], rowId: "duplicate-row", sourceRowIndex: 4 };
  reusedDuplicateId.excludedRows.push(
    { sourceTableIndex: 0, sourceRowIndex: 3, sourceLabel: firstDuplicate.sourceCriterionLabel, reasonCode: "DUPLICATE_CRITERION" },
    { sourceTableIndex: 0, sourceRowIndex: 4, sourceLabel: secondDuplicate.sourceCriterionLabel, reasonCode: "DUPLICATE_CRITERION" },
  );
  reusedDuplicateId.duplicates.push(
    { criterionId: "wcag-sc-1.1.1", keptRowId: "row-001", duplicateRows: [firstDuplicate] },
    { criterionId: "wcag-sc-1.2.1", keptRowId: "row-002", duplicateRows: [secondDuplicate] },
  );
  assertInvalid(reusedDuplicateId, "$.duplicates[1].duplicateRows[0].rowId");

  const reusedLocation = structuredClone(reusedDuplicateId);
  reusedLocation.duplicates[1].duplicateRows[0].rowId = "different-row";
  reusedLocation.duplicates[1].duplicateRows[0].sourceRowIndex = 3;
  assertInvalid(reusedLocation, "$.duplicates[1].duplicateRows[0]");
});

test("enforces coverage set equality and deterministic order relationships", () => {
  const partial = validCompleteResult();
  partial.coverage.expectedCriterionIds.push("wcag-sc-1.2.1");
  partial.coverage.missingCriterionIds.push("wcag-sc-1.2.1");
  assert.equal(validateIngestionResult(partial), partial);

  assertInvalid(
    changed(partial, (value) => { value.coverage.extractedCriterionIds = ["wcag-sc-1.2.1"]; }),
    "$.coverage.extractedCriterionIds",
  );
  assertInvalid(
    changed(partial, (value) => { value.coverage.expectedCriterionIds.reverse(); }),
    "$.coverage.expectedCriterionIds[1]",
  );
  assertInvalid(
    changed(partial, (value) => { value.coverage.missingCriterionIds = []; }),
    "$.coverage.missingCriterionIds",
  );

  const unexpectedExtracted = validCompleteResult();
  unexpectedExtracted.coverage.expectedCriterionIds = ["wcag-sc-1.2.1"];
  unexpectedExtracted.coverage.missingCriterionIds = ["wcag-sc-1.2.1"];
  assertInvalid(unexpectedExtracted, "$.coverage.extractedCriterionIds[0]");
});

test("browser result-producing boundaries return only validated fail-closed rejections", async () => {
  const malformedTransport = await ingestSourceBytes({
    requestId: "request-malformed-transport",
    bytes: "not-bytes",
    mimeType: "application/pdf",
    catalog: null,
    declaredWcagVersions: ["2.2"],
    declaredLevels: ["A", "AA"],
  });
  assert.equal(malformedTransport.status, "rejected");
  assert.equal(validateIngestionResult(malformedTransport), malformedTransport);

  const unsupportedVpat = ingestStructuredSource({
    requestId: "request-unsupported-vpat",
    sourceType: "google-doc",
    candidateDocument: { bodyProse: ["VPAT version 2.4"], tables: [] },
    catalog: null,
    declaredWcagVersions: ["2.2"],
    declaredLevels: ["A", "AA"],
  });
  assert.equal(unsupportedVpat.status, "rejected");
  assert.equal(validateIngestionResult(unsupportedVpat), unsupportedVpat);
});
