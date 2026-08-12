import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ingestCandidateDocument,
  INGESTION_LIMITS,
  PARSER_VERSION,
} from "../../../src/ingestion/core/index.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const json = (path) => JSON.parse(readFileSync(resolve(ROOT, path), "utf8"));
const catalog = json("config/vpat-2.5-wcag-criteria.v1.json");
const sourceFixture = json("tests/fixtures/synthetic/google-docs-candidate-tables.v1.json");
const expectedFixture = json("tests/fixtures/synthetic/expected-wcag-rows.v1.json");

function fixtureCandidateDocument() {
  return {
    bodyProse: structuredClone(sourceFixture.bodyProse),
    tables: sourceFixture.candidateTables.map(({ tableId, sourceOrder, headers, rows }) => ({
      tableId,
      sourceOrder,
      context: "",
      headers: structuredClone(headers),
      rows: structuredClone(rows),
    })),
  };
}

function ingest(overrides = {}) {
  return ingestCandidateDocument({
    requestId: "request-synthetic-core",
    sourceType: "google-doc",
    candidateDocument: fixtureCandidateDocument(),
    catalog,
    declaredWcagVersions: ["2.2"],
    declaredLevels: ["A", "AA"],
    ...overrides,
  });
}

function wcagTable(rows) {
  return {
    bodyProse: [],
    tables: [
      {
        tableId: "table-wcag",
        sourceOrder: 0,
        context: "WCAG 2.2",
        headers: ["Criteria", "Conformance Level", "Remarks and Explanations"],
        rows,
      },
    ],
  };
}

test("existing synthetic candidate tables produce the 55-row golden result", () => {
  const result = ingest();

  assert.equal(result.status, "complete");
  assert.equal(result.schemaVersion, "1.0.0");
  assert.equal(result.parserVersion, PARSER_VERSION);
  assert.equal(result.catalogVersion, catalog.version);
  assert.deepEqual(
    result.candidateTables.map(({ tableId, classification, reasonCode }) => ({
      tableId,
      classification,
      reasonCode,
    })),
    expectedFixture.expectedTableDecisions,
  );
  assert.equal(result.rows.length, 55);
  assert.deepEqual(
    result.rows.map(
      ({ rowId, sourceTableIndex, sourceRowIndex, criterionId, sourceConformance, aliasMatch }) => ({
        rowId,
        sourceTableIndex,
        sourceRowIndex,
        criterionId,
        sourceConformance,
        aliasMatch,
      }),
    ),
    expectedFixture.rows.map(
      ({ rowId, sourceTableIndex, sourceRowIndex, criterionId, sourceConformance, aliasMatch }) => ({
        rowId,
        sourceTableIndex,
        sourceRowIndex,
        criterionId,
        sourceConformance,
        aliasMatch,
      }),
    ),
  );
  assert.deepEqual(
    new Set(result.excludedRows.map(({ reasonCode }) => reasonCode)),
    new Set(expectedFixture.excluded.map(({ reasonCode }) => reasonCode)),
  );
  assert.equal(result.duplicates.length, 0);
  assert.equal(result.coverage.expectedCriterionIds.length, 55);
  assert.deepEqual(result.coverage.extractedCriterionIds, result.coverage.expectedCriterionIds);
  assert.deepEqual(result.coverage.missingCriterionIds, []);
});

test("matching accepts only normalized exact SC, official-title, and explicit-title aliases", () => {
  const result = ingest({
    candidateDocument: wcagTable([
      { sourceRowIndex: 1, cells: ["  1.1.1\t", "Supports", "Exact SC."] },
      {
        sourceRowIndex: 2,
        cells: ["2.5.5 TARGET SIZE", "Supports", "Explicit catalog title alias."],
      },
    ]),
    declaredLevels: ["A", "AAA"],
  });

  assert.equal(result.status, "complete");
  assert.deepEqual(
    result.rows.map(({ criterionId, aliasMatch }) => ({ criterionId, aliasMatch })),
    [
      { criterionId: "wcag-sc-1.1.1", aliasMatch: "exact-sc" },
      {
        criterionId: "wcag-sc-2.5.5",
        aliasMatch: "exact-sc-plus-official-title",
      },
    ],
  );
});

test("matching accepts official VPAT level and also-applies structural suffixes exactly", () => {
  const result = ingest({
    candidateDocument: wcagTable([
      {
        sourceRowIndex: 1,
        cells: ["1.1.1 Non-text Content (Level A)", "Supports", "Official VPAT label."],
      },
      {
        sourceRowIndex: 2,
        cells: [
          "2.4.11 Focus Not Obscured (Minimum) (Level AA 2.2 only) EN 301 549 Criteria – Does not apply Revised Section 508 – Does not apply",
          "Supports",
          "Official VPAT label with explicit version suffix.",
        ],
      },
    ]),
  });
  assert.equal(result.status, "complete");
  assert.deepEqual(result.rows.map(({ criterionId }) => criterionId), [
    "wcag-sc-1.1.1",
    "wcag-sc-2.4.11",
  ]);

  const special = ingest({
    candidateDocument: wcagTable([
      {
        sourceRowIndex: 1,
        cells: [
          "4.1.1 Parsing (Level A) WCAG 2.0 and 2.1 – Always answer ‘Supports’ WCAG 2.2 (obsolete and removed) - Does not apply",
          "Supports",
          "Official retired criterion label.",
        ],
      },
      {
        sourceRowIndex: 2,
        cells: [
          "2.1.4 Character Key Shortcuts (Level A 2.1 and 2.2) Also applies to: EN 301 549 Criteria 9.2.1.4 Revised Section 508 – Does not apply",
          "Supports",
          "Official cross-standard mapping tail.",
        ],
      },
    ]),
    declaredWcagVersions: ["2.0", "2.1", "2.2"],
  });
  assert.equal(special.status, "complete");
  assert.deepEqual(special.rows.map(({ criterionId }) => criterionId), [
    "wcag-sc-4.1.1",
    "wcag-sc-2.1.4",
  ]);

  const inventedSuffix = ingest({
    candidateDocument: wcagTable([
      {
        sourceRowIndex: 1,
        cells: ["1.1.1 Non-text Content (Level A) Also applies to: invented standard 9.9", "Supports", ""],
      },
    ]),
  });
  assert.equal(inventedSuffix.status, "rejected");
  assert.equal(inventedSuffix.rejection.code, "WCAG_ROWS_AMBIGUOUS");

  for (const injected of [
    "1.1.1 Non-text Content Revised Section 508 - this is not an official mapping",
    "1.1.1 Non-text Content (Level A) Also applies to: EN 301 549 Criteria malicious invented suffix",
    "1.1.1 Non-text Content (Level A) Also applies to:",
  ]) {
    const rejected = ingest({
      candidateDocument: wcagTable([{ sourceRowIndex: 1, cells: [injected, "Supports", ""] }]),
    });
    assert.equal(rejected.status, "rejected");
    assert.equal(rejected.rejection.code, "WCAG_ROWS_AMBIGUOUS");
  }
});

test("an apparent WCAG row with a non-allowlisted title rejects instead of guessing", () => {
  const result = ingest({
    candidateDocument: wcagTable([
      { sourceRowIndex: 1, cells: ["1.1.1 Similar but invented title", "Supports", ""] },
    ]),
  });

  assert.equal(result.status, "rejected");
  assert.equal(result.rejection.code, "WCAG_ROWS_AMBIGUOUS");
  assert.equal(result.rejection.stage, "row-matching");
});

test("permuted or extended WCAG header roles reject instead of swapping evidence", () => {
  for (const headers of [
    ["Criteria", "Remarks and Explanations", "Conformance Level"],
    ["Criteria", "Conformance Level", "Remarks and Explanations", "Unmapped column"],
  ]) {
    const result = ingest({
      candidateDocument: {
        bodyProse: [],
        tables: [{
          tableId: "misordered",
          sourceOrder: 0,
          context: "WCAG 2.2",
          headers,
          rows: [{
            sourceRowIndex: 1,
            cells: ["1.1.1 Non-text Content", "Actual remarks", "Supports", "Extra"].slice(0, headers.length),
          }],
        }],
      },
    });
    assert.equal(result.status, "rejected");
    assert.equal(result.rejection.code, "WCAG_ROWS_AMBIGUOUS");
  }

  for (const headers of [
    ["Criteria", "not conformance garbage", "not remarks garbage"],
    ["Criteria", "remarks conformance", "evidence of unrelated data"],
    ["WCAG Criterion", "Conformance-ish", "Explanations maybe"],
  ]) {
    const result = ingest({
      candidateDocument: {
        bodyProse: [],
        tables: [{
          tableId: "invalid-header-aliases",
          sourceOrder: 0,
          context: "WCAG 2.2",
          headers,
          rows: [{ sourceRowIndex: 1, cells: ["1.1.1 Non-text Content", "Supports", "Evidence"] }],
        }],
      },
    });
    assert.equal(result.status, "rejected");
    assert.equal(result.rejection.code, "WCAG_ROWS_AMBIGUOUS");
  }
});

test("canonical WCAG section identity wins over incidental crosswalk mentions", () => {
  for (const context of [
    "WCAG 2.2 Report with EN 301 549 mappings",
    "WCAG 2.2 Report | Section 508 does not apply",
  ]) {
    const result = ingest({
      candidateDocument: {
        bodyProse: [],
        tables: [{
          tableId: "wcag-with-crosswalk-context",
          sourceOrder: 0,
          context,
          headers: ["Criteria", "Conformance Level", "Remarks and Explanations"],
          rows: [{ sourceRowIndex: 1, cells: ["1.1.1 Non-text Content", "Supports", "Evidence"] }],
        }],
      },
    });
    assert.equal(result.status, "complete");
    assert.equal(result.rows[0].sourceConformance, "Supports");
  }
});

test("duplicate criteria are recorded once and never duplicated in rows", () => {
  const candidateDocument = fixtureCandidateDocument();
  candidateDocument.tables[1].rows.push({
    sourceRowIndex: 56,
    cells: ["1.1.1 Non-text Content", "Partially Supports", "Duplicate synthetic row."],
  });
  const result = ingest({ candidateDocument });

  assert.equal(result.status, "complete");
  assert.equal(result.rows.filter(({ criterionId }) => criterionId === "wcag-sc-1.1.1").length, 1);
  assert.deepEqual(result.duplicates, [
    {
      criterionId: "wcag-sc-1.1.1",
      keptRowId: "row-001",
      duplicateRows: [
        {
          rowId: "row-056",
          criterionId: "wcag-sc-1.1.1",
          sourceCriterionLabel: "1.1.1 Non-text Content",
          sourceConformance: "Partially Supports",
          sourceRemarks: "Duplicate synthetic row.",
          sourceTableIndex: 1,
          sourceRowIndex: 56,
          aliasMatch: "exact-sc-plus-official-title",
        },
      ],
    },
  ]);
  assert.ok(
    result.excludedRows.some(
      ({ sourceRowIndex, reasonCode }) =>
        sourceRowIndex === 56 && reasonCode === "DUPLICATE_CRITERION",
    ),
  );
});

test("catalog activeIn and declared levels determine expected coverage", () => {
  const result = ingest({
    candidateDocument: wcagTable([
      { sourceRowIndex: 1, cells: ["4.1.1 Parsing", "Supports", "WCAG 2.1 row."] },
    ]),
    declaredWcagVersions: ["2.1"],
    declaredLevels: ["A"],
  });

  assert.equal(result.status, "complete");
  assert.ok(result.coverage.expectedCriterionIds.includes("wcag-sc-4.1.1"));
  assert.ok(!result.coverage.expectedCriterionIds.includes("wcag-sc-4.1.3"));
  assert.deepEqual(result.coverage.extractedCriterionIds, ["wcag-sc-4.1.1"]);
  assert.ok(!result.coverage.missingCriterionIds.includes("wcag-sc-4.1.1"));
});

test("candidate document limits fail closed with RESOURCE_LIMIT_EXCEEDED", () => {
  const tooManyTables = Array.from(
    { length: INGESTION_LIMITS.maxTables + 1 },
    (_, sourceOrder) => ({
      tableId: `table-${sourceOrder}`,
      sourceOrder,
      context: "",
      headers: [],
      rows: [],
    }),
  );
  const result = ingest({ candidateDocument: { bodyProse: [], tables: tooManyTables } });

  assert.equal(result.status, "rejected");
  assert.equal(result.rejection.code, "RESOURCE_LIMIT_EXCEEDED");
  assert.equal(result.rejection.stage, "resource-limit");

  const oversizedExcludedLabel = ingest({
    candidateDocument: {
      bodyProse: [`1.1.1 ${"x".repeat(INGESTION_LIMITS.maxCriterionLabelCharacters)}`],
      tables: wcagTable([
        { sourceRowIndex: 1, cells: ["1.1.1 Non-text Content", "Supports", ""] },
      ]).tables,
    },
  });
  assert.equal(oversizedExcludedLabel.status, "rejected");
  assert.equal(oversizedExcludedLabel.rejection.code, "RESOURCE_LIMIT_EXCEEDED");
});

test("result collection bounds reject before schema validation can mask the limit", () => {
  const duplicateRows = Array.from(
    // One retained occurrence plus the full duplicate allowance plus one.
    { length: INGESTION_LIMITS.maxDuplicatesPerCriterion + 2 },
    (_, index) => ({
      sourceRowIndex: index + 1,
      cells: ["1.1.1 Non-text Content", "Supports", `Duplicate ${index + 1}`],
    }),
  );
  const duplicateResult = ingest({ candidateDocument: wcagTable(duplicateRows) });
  assert.equal(duplicateResult.status, "rejected");
  assert.equal(duplicateResult.rejection.code, "RESOURCE_LIMIT_EXCEEDED");
  assert.equal(duplicateResult.rejection.stage, "resource-limit");

  const bodyProse = Array.from(
    { length: INGESTION_LIMITS.maxBodyProseItems },
    (_, index) => `1.1.1 body occurrence ${index}`,
  );
  const nonWcagRows = Array.from(
    { length: INGESTION_LIMITS.maxExcludedRows - bodyProse.length + 1 },
    (_, index) => ({
      sourceRowIndex: index + 1,
      cells: [`508.${index + 1}`, "Supports", "Excluded"],
    }),
  );
  const exclusionResult = ingest({
    candidateDocument: {
      bodyProse,
      tables: [
        ...Array.from({ length: Math.ceil(nonWcagRows.length / INGESTION_LIMITS.maxRowsPerTable) }, (_, tableIndex) => ({
          tableId: `section-508-${tableIndex}`,
          sourceOrder: tableIndex,
          context: "Revised Section 508 Report",
          headers: ["Criteria", "Conformance Level", "Remarks and Explanations"],
          rows: nonWcagRows
            .slice(tableIndex * INGESTION_LIMITS.maxRowsPerTable, (tableIndex + 1) * INGESTION_LIMITS.maxRowsPerTable)
            .map((row, rowIndex) => ({ ...row, sourceRowIndex: rowIndex + 1 })),
        })),
        {
          tableId: "wcag-final",
          sourceOrder: Math.ceil(nonWcagRows.length / INGESTION_LIMITS.maxRowsPerTable),
          context: "WCAG 2.2 Report",
          headers: ["Criteria", "Conformance Level", "Remarks and Explanations"],
          rows: [{ sourceRowIndex: 1, cells: ["1.1.1 Non-text Content", "Supports", "Evidence"] }],
        },
      ],
    },
  });
  assert.equal(exclusionResult.status, "rejected");
  assert.equal(exclusionResult.rejection.code, "RESOURCE_LIMIT_EXCEEDED");
  assert.equal(exclusionResult.rejection.stage, "resource-limit");
});

test("a structurally valid source without an eligible WCAG table is rejected", () => {
  const candidateDocument = fixtureCandidateDocument();
  candidateDocument.tables = [candidateDocument.tables[0]];
  const result = ingest({ candidateDocument });

  assert.equal(result.status, "rejected");
  assert.equal(result.rejection.code, "WCAG_TABLE_NOT_FOUND");
  assert.equal(result.rejection.stage, "table-detection");
});

test("unsupported source types and declared WCAG versions use stable codes", () => {
  const unsupportedType = ingest({ sourceType: "rtf" });
  assert.equal(unsupportedType.status, "rejected");
  assert.equal(unsupportedType.sourceType, "unknown");
  assert.equal(unsupportedType.rejection.code, "SOURCE_TYPE_UNSUPPORTED");

  const unsupportedVersion = ingest({ declaredWcagVersions: ["3.0"] });
  assert.equal(unsupportedVersion.status, "rejected");
  assert.equal(unsupportedVersion.rejection.code, "VPAT_VERSION_UNSUPPORTED");
});
