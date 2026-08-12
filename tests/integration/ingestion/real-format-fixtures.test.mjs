import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  AUTHORITATIVE_MIME_TYPES,
  ingestSourceBytes,
} from "../../../src/ingestion/browser/ingest-bytes.mjs";
import { validateIngestionResult } from "../../../src/ingestion/core/index.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const FIXTURE_DIR = resolve(ROOT, "tests/fixtures/synthetic/real-format");
const catalog = JSON.parse(
  readFileSync(resolve(ROOT, "config/vpat-2.5-wcag-criteria.v1.json"), "utf8"),
);
const expected = JSON.parse(
  readFileSync(resolve(ROOT, "tests/fixtures/synthetic/expected-wcag-rows.v1.json"), "utf8"),
);

function officialUnionLabel(criterion, index) {
  let suffix;
  if (criterion.sc === "4.1.1") {
    suffix = " (Level A) WCAG 2.0 and 2.1 – Always answer ‘Supports’ WCAG 2.2 (obsolete and removed) - Does not apply";
  } else if (criterion.activeIn.length === 1 && criterion.activeIn[0] === "2.2") {
    suffix = ` (Level ${criterion.level} 2.2 only)`;
  } else if (
    criterion.activeIn.length === 2 &&
    criterion.activeIn[0] === "2.1" &&
    criterion.activeIn[1] === "2.2"
  ) {
    suffix = ` (Level ${criterion.level} 2.1 and 2.2)`;
  } else {
    suffix = ` (Level ${criterion.level})`;
  }
  const crosswalk = (index + 1) % 9 === 0 && criterion.sc !== "4.1.1"
    ? " Also applies to: EN 301 549 Criteria 9.1.1.1 (Web) Revised Section 508 501 (Web)(Software)"
    : "";
  return `${criterion.sc} ${criterion.title}${suffix}${crosswalk}`;
}

function expectedUnionEvidence() {
  const conformanceCycle = ["Supports", "Partially Supports", "Does Not Support", "Not Applicable"];
  return catalog.criteria.map((criterion, index) => {
    let sourceRemarks;
    if (criterion.sc === "4.1.1") {
      sourceRemarks =
        "Synthetic cross-page evidence for SC 4.1.1 begins on one PDF page and continues after " +
        "the repeated WCAG header on the next page. The continuation stays entirely within the " +
        "criterion and remarks columns so the parser can preserve this literal evidence without " +
        "guessing, while the DOCX and searchable PDF remain exact normalized-evidence peers.";
    } else if ((index + 1) % 11 === 0) {
      sourceRemarks =
        `Synthetic wrapped union evidence for SC ${criterion.sc} exercises a variable-height row ` +
        "with enough literal detail to wrap across multiple visual lines without changing the source evidence.";
    } else {
      sourceRemarks = `Synthetic union evidence for SC ${criterion.sc} across the declared WCAG scope.`;
    }
    return {
      criterionId: criterion.id,
      sourceCriterionLabel: officialUnionLabel(criterion, index),
      sourceConformance: criterion.sc === "4.1.1" ? "" : conformanceCycle[index % conformanceCycle.length],
      sourceRemarks,
      aliasMatch: "exact-sc-plus-official-title",
    };
  });
}

function unionEvidenceProjection(result) {
  return result.rows.map(({
    criterionId,
    sourceCriterionLabel,
    sourceConformance,
    sourceRemarks,
    aliasMatch,
  }) => ({
    criterionId,
    sourceCriterionLabel,
    sourceConformance,
    sourceRemarks,
    aliasMatch,
  }));
}

function bytes(filename) {
  return new Uint8Array(readFileSync(resolve(FIXTURE_DIR, filename)));
}

function ingest(filename, mimeType, overrides = {}) {
  return ingestSourceBytes({
    requestId: `real-${filename}`,
    bytes: bytes(filename),
    mimeType,
    catalog,
    declaredWcagVersions: ["2.2"],
    declaredLevels: ["A", "AA"],
    ...overrides,
  });
}

function assertGoldenComplete(result) {
  assert.equal(result.status, "complete");
  assert.equal(result.rows.length, 55);
  assert.deepEqual(
    result.rows.map(({ criterionId }) => criterionId),
    expected.rows.map(({ criterionId }) => criterionId),
  );
  assert.equal(result.coverage.missingCriterionIds.length, 0);
  assert.equal(result.duplicates.length, 1);
  assert.equal(result.duplicates[0].criterionId, "wcag-sc-1.1.1");
  assert.ok(result.excludedRows.some(({ reasonCode }) => reasonCode === "BODY_PROSE"));
  assert.ok(result.excludedRows.some(({ reasonCode }) => reasonCode === "SECTION_508_ROW"));
  assert.ok(result.excludedRows.some(({ reasonCode }) => reasonCode === "EN_301_549_ROW"));
  assert.ok(result.excludedRows.some(({ reasonCode }) => reasonCode === "UNRECOGNIZED_CRITERION"));
  assert.ok(result.excludedRows.some(({ sourceLabel }) => sourceLabel === "=1+1"));
}

test("real DOCX fixture produces the 55-row golden result and explicit exclusions", async () => {
  assertGoldenComplete(
    await ingest("northstar-vpat-2.5.docx", AUTHORITATIVE_MIME_TYPES.docx),
  );
});

test("real searchable PDF fixture has cross-format golden parity", async () => {
  assertGoldenComplete(
    await ingest("northstar-vpat-2.5-searchable.pdf", AUTHORITATIVE_MIME_TYPES.pdf),
  );
});

test("full-union DOCX and searchable PDF preserve all 87 normalized evidence rows exactly", async () => {
  const scope = {
    declaredWcagVersions: undefined,
    declaredLevels: undefined,
  };
  const [docx, pdf] = await Promise.all([
    ingest("northstar-vpat-2.5-scope-union.docx", AUTHORITATIVE_MIME_TYPES.docx, scope),
    ingest("northstar-vpat-2.5-scope-union.pdf", AUTHORITATIVE_MIME_TYPES.pdf, scope),
  ]);
  const expectedEvidence = expectedUnionEvidence();

  for (const result of [docx, pdf]) {
    assert.equal(result.status, "complete");
    assert.equal(result.rows.length, 87);
    assert.equal(result.duplicates.length, 0);
    assert.deepEqual(result.coverage.declaredWcagVersions, ["2.0", "2.1", "2.2"]);
    assert.deepEqual(result.coverage.declaredLevels, ["A", "AA", "AAA"]);
    assert.deepEqual(
      result.coverage.expectedCriterionIds,
      catalog.criteria.map(({ id }) => id),
    );
    assert.deepEqual(result.coverage.extractedCriterionIds, result.coverage.expectedCriterionIds);
    assert.deepEqual(result.coverage.missingCriterionIds, []);
    assert.deepEqual(unionEvidenceProjection(result), expectedEvidence);
    assert.equal(
      result.rows.find(({ criterionId }) => criterionId === "wcag-sc-4.1.1").sourceConformance,
      "",
    );
  }

  assert.deepEqual(unionEvidenceProjection(pdf), unionEvidenceProjection(docx));
  assert.match(
    pdf.rows.find(({ criterionId }) => criterionId === "wcag-sc-4.1.1").sourceRemarks,
    /begins on one PDF page and continues after the repeated WCAG header on the next page/,
  );
});

const PDF_REJECTION_CASES = [
  ["northstar-vpat-2.5-image-only.pdf", "PDF_NON_SEARCHABLE"],
  ["northstar-vpat-2.5-insufficient-text.pdf", "PDF_INSUFFICIENT_TEXT"],
  ["northstar-vpat-2.5-malformed.pdf", "SOURCE_MALFORMED"],
  ["northstar-vpat-2.5-encrypted.pdf", "PDF_ENCRYPTED"],
  ["northstar-vpat-2.5-ambiguous.pdf", "WCAG_ROWS_AMBIGUOUS"],
];

for (const [filename, code] of PDF_REJECTION_CASES) {
  test(`${filename} rejects with ${code}`, async () => {
    const result = await ingest(filename, AUTHORITATIVE_MIME_TYPES.pdf);
    assert.equal(result.status, "rejected");
    assert.equal(result.rejection.code, code);
  });
}

test("real PDF page limit rejects without partial output", async () => {
  const result = await ingest(
    "northstar-vpat-2.5-resource-limit.pdf",
    AUTHORITATIVE_MIME_TYPES.pdf,
    { limits: { pdf: { maxPages: 2 } } },
  );
  assert.equal(result.status, "rejected");
  assert.equal(result.rejection.code, "RESOURCE_LIMIT_EXCEEDED");
});

test("real DOCX crossing the default XML-node limit rejects schema-validly without partial output", async () => {
  const filename = "northstar-vpat-2.5-resource-limit.docx";
  const fixtureBytes = bytes(filename);
  assert.ok(fixtureBytes.byteLength < 25 * 1024 * 1024);

  const result = await ingest(filename, AUTHORITATIVE_MIME_TYPES.docx);
  assert.equal(result.status, "rejected");
  assert.equal(result.rejection.code, "RESOURCE_LIMIT_EXCEEDED");
  assert.equal(result.rejection.stage, "resource-limit");
  assert.equal(result.rejection.safeMessage, "The DOCX exceeds the XML-node limit.");
  assert.equal(validateIngestionResult(result), result);
  assert.deepEqual(
    Object.keys(result).sort(),
    [
      "catalogVersion",
      "parserVersion",
      "rejection",
      "requestId",
      "schemaVersion",
      "sourceType",
      "status",
    ],
  );
  for (const partialKey of [
    "candidateTables",
    "rows",
    "excludedRows",
    "duplicates",
    "coverage",
  ]) {
    assert.equal(Object.hasOwn(result, partialKey), false);
  }
});

test("real DOCX without a WCAG table rejects deterministically", async () => {
  const result = await ingest(
    "northstar-vpat-2.5-no-wcag.docx",
    AUTHORITATIVE_MIME_TYPES.docx,
  );
  assert.equal(result.status, "rejected");
  assert.equal(result.rejection.code, "WCAG_TABLE_NOT_FOUND");
});

test("real DOCX declaring VPAT 2.4 rejects before row analysis", async () => {
  const result = await ingest(
    "northstar-vpat-2.4.docx",
    AUTHORITATIVE_MIME_TYPES.docx,
  );
  assert.equal(result.status, "rejected");
  assert.equal(result.rejection.code, "VPAT_VERSION_UNSUPPORTED");
  assert.equal(result.rejection.stage, "classification");
});

test("authoritative MIME and signature must agree", async () => {
  const mismatch = await ingest(
    "northstar-vpat-2.5.docx",
    AUTHORITATIVE_MIME_TYPES.pdf,
  );
  assert.equal(mismatch.status, "rejected");
  assert.equal(mismatch.sourceType, "unknown");
  assert.equal(mismatch.rejection.code, "SOURCE_TYPE_UNSUPPORTED");

  const unsupported = await ingest("northstar-vpat.txt", "text/plain");
  assert.equal(unsupported.status, "rejected");
  assert.equal(unsupported.rejection.code, "SOURCE_TYPE_UNSUPPORTED");
});

test("VPAT identity ignores unrelated product-version prose", async () => {
  const source = JSON.parse(
    readFileSync(resolve(ROOT, "tests/fixtures/synthetic/google-docs-candidate-tables.v1.json"), "utf8"),
  );
  const tables = source.candidateTables.map(({ tableId, sourceOrder, headers, rows }) => ({
      tableId,
      sourceOrder,
      context: tableId === "table-wcag-22-a-aa" ? "WCAG 2.x Report" : "",
      headers,
      rows,
    }));
  const { ingestStructuredSource } = await import("../../../src/ingestion/browser/ingest-bytes.mjs");
  for (const bodyProse of [
    ["Voluntary Product Accessibility Template® (VPAT®)", "WCAG Edition", "Version 2.5Rev", "Product Version 2.4"],
    ["VPAT® Accessibility Conformance Report", "Product Version 2.4", "Template Version 2.5"],
    ["VPAT® Accessibility Conformance Report", "Product Version 2.4", "Version 2.5Rev"],
  ]) {
    const result = ingestStructuredSource({
      requestId: "version-identity",
      sourceType: "google-doc",
      candidateDocument: { bodyProse, tables },
      catalog,
      declaredWcagVersions: ["2.2"],
      declaredLevels: ["A", "AA"],
    });
    assert.equal(result.status, "complete", bodyProse.join(" | "));
  }
});

test("declared scope derives exact WCAG version and level lists", async () => {
  const { deriveDeclaredScope } = await import("../../../src/ingestion/browser/ingest-bytes.mjs");
  for (const [text, versions, levels] of [
    ["WCAG 2.0 and 2.1 · Levels A and AA", ["2.0", "2.1"], ["A", "AA"]],
    ["WCAG 2.0, 2.1, and 2.2 · Levels A, AA, and AAA", ["2.0", "2.1", "2.2"], ["A", "AA", "AAA"]],
    ["WCAG 2.1/2.2 · Level A/AA", ["2.1", "2.2"], ["A", "AA"]],
  ]) {
    assert.deepEqual(
      deriveDeclaredScope({ bodyProse: [text, "Product version 2.0"], tables: [] }),
      { declaredWcagVersions: versions, declaredLevels: levels },
    );
  }
});

test("VPAT patch versions do not alias to the supported 2.5 template", async () => {
  const source = JSON.parse(
    readFileSync(resolve(ROOT, "tests/fixtures/synthetic/google-docs-candidate-tables.v1.json"), "utf8"),
  );
  const { ingestStructuredSource } = await import("../../../src/ingestion/browser/ingest-bytes.mjs");
  for (const identity of ["VPAT 2.5.1", "VPAT Accessibility Report · Template Version 2.5.99"]) {
    const result = ingestStructuredSource({
      requestId: "unsupported-patch-version",
      sourceType: "google-doc",
      candidateDocument: {
        bodyProse: [identity],
        tables: source.candidateTables.map(({ tableId, sourceOrder, headers, rows }) => ({
          tableId,
          sourceOrder,
          context: tableId === "table-wcag-22-a-aa" ? "WCAG 2.2 Report" : "",
          headers,
          rows,
        })),
      },
      catalog,
    });
    assert.equal(result.status, "rejected");
    assert.equal(result.rejection.code, "VPAT_VERSION_UNSUPPORTED");
  }
});
