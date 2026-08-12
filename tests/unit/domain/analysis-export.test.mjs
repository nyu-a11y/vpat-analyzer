import assert from "node:assert/strict";
import test from "node:test";

import { createAnalysisOutput } from "../../../src/domain/analysis-output.mjs";
import {
  EXPORT_TAB_DEFINITIONS,
  assertExportModel,
  buildExportModel,
  literalCell,
  trustedFormulaCell,
} from "../../../src/domain/export-model.mjs";
import { validateConformanceResponse, validateQualityResponse } from "../../../src/domain/ai-response-validator.mjs";
import { QUALITY_REQUIREMENT_IDS } from "../../../src/domain/quality-ids.mjs";
import {
  catalog,
  conformanceResponse,
  qualityResponse,
  rubric,
  sampleIngestion,
  scoringRules,
  sourceDescriptor,
} from "./fixtures.mjs";

function buildAnalysis(mutator) {
  const requestId = "request-domain-1";
  const ids = ["wcag-sc-1.1.1", "wcag-sc-1.2.1"];
  const conformance = conformanceResponse(requestId, ids);
  const quality = qualityResponse(requestId);
  mutator?.({ conformance, quality });
  return createAnalysisOutput({
    requestId,
    source: sourceDescriptor(),
    ingestionResult: sampleIngestion(requestId, ids),
    conformanceResponse: validateConformanceResponse(conformance, {
      requestId,
      expectedCriterionIds: ids,
    }),
    qualityResponse: validateQualityResponse(quality, {
      requestId,
      expectedRequirementIds: QUALITY_REQUIREMENT_IDS,
    }),
    catalog,
    rubric,
    scoringRules,
  });
}

test("AnalysisOutput is deeply immutable, stable-ID ordered, and keeps conformance distinct from quality failure", () => {
  const output = buildAnalysis();
  assert.equal(Object.isFrozen(output), true);
  assert.equal(Object.isFrozen(output.wcagFindings[0]), true);
  assert.deepEqual(output.wcagFindings.map(({ criterionId }) => criterionId), ["wcag-sc-1.1.1", "wcag-sc-1.2.1"]);
  assert.equal(output.wcagFindings[0].normalizedConformance, "Does Not Support");
  assert.equal(output.scoreSummary.grade, "A");
  assert.throws(() => { output.analysisStatus = "Incomplete"; }, TypeError);
});

test("an incomplete quality finding creates no F and no letter grade", () => {
  const output = buildAnalysis(({ quality }) => {
    quality.findings[0] = {
      requirementId: "qr-e12",
      status: "Incomplete",
      result: "Incomplete",
      evidence: "No provider result.",
      guidance: "Retry analysis.",
      confidence: null,
      reviewRequired: true,
      incompleteReason: "MISSING_INPUT_EVIDENCE",
    };
  });
  assert.equal(output.analysisStatus, "Incomplete");
  assert.equal(output.qualityFindings[0].result, "Incomplete");
  assert.equal(output.scoreSummary.grade, null);
});

test("an incomplete conformance finding creates no F and no letter grade", () => {
  const output = buildAnalysis(({ conformance }) => {
    conformance.findings[0] = {
      criterionId: "wcag-sc-1.1.1",
      status: "Incomplete",
      normalizedConformance: null,
      evidence: "No complete provider result.",
      confidence: null,
      reviewRequired: true,
      incompleteReason: "INSUFFICIENT_EVIDENCE",
    };
  });
  assert.equal(output.analysisStatus, "Incomplete");
  assert.equal(output.wcagFindings[0].status, "Incomplete");
  assert.equal(output.scoreSummary.status, "Incomplete");
  assert.equal(output.scoreSummary.grade, null);
  assert.equal(output.scoreSummary.percentage, null);
});

test("missing deterministic coverage creates no letter grade even if a provider marks every finding complete", () => {
  const requestId = "request-domain-1";
  const expectedIds = ["wcag-sc-1.1.1", "wcag-sc-1.2.1"];
  const ingestion = sampleIngestion(requestId, expectedIds);
  ingestion.rows = ingestion.rows.slice(0, 1);
  ingestion.coverage.extractedCriterionIds = [expectedIds[0]];
  ingestion.coverage.missingCriterionIds = [expectedIds[1]];
  const output = createAnalysisOutput({
    requestId,
    source: sourceDescriptor(),
    ingestionResult: ingestion,
    conformanceResponse: validateConformanceResponse(conformanceResponse(requestId, expectedIds), {
      requestId,
      expectedCriterionIds: expectedIds,
    }),
    qualityResponse: validateQualityResponse(qualityResponse(requestId), {
      requestId,
      expectedRequirementIds: QUALITY_REQUIREMENT_IDS,
    }),
    catalog,
    rubric,
    scoringRules,
  });
  assert.equal(output.analysisStatus, "Incomplete");
  assert.equal(output.scoreSummary.grade, null);
});

test("ExportModel contains exactly five fixed tabs and every untrusted string is a literal cell", () => {
  const model = buildExportModel(buildAnalysis());
  assert.deepEqual(
    model.tabs.map(({ tabId, name, order }) => ({ tabId, name, order })),
    EXPORT_TAB_DEFINITIONS,
  );
  const cells = model.tabs.flatMap((tab) => tab.sections.flatMap((section) => section.rows.flatMap((row) => row.cells)));
  assert.equal(cells.every((cell) => cell.kind === "literal"), true);
  assert.equal(cells.some((cell) => cell.value === "=literal source"), true);
  assert.equal(cells.some((cell) => cell.value === "+literal remarks"), true);
  assert.equal(cells.some((cell) => cell.value === "@literal evidence"), true);
  assert.equal(cells.some((cell) => cell.value === "=literal provider evidence"), true);
  assert.equal(Object.isFrozen(model.tabs[0].sections[0].rows[0].cells[0]), true);
});

test("literal cells do not reinterpret formula-like values and formula references fail closed", () => {
  for (const value of ["=SUM(A1:A2)", "+1", "-1", "@name", "\tformula", "\rformula", "\nformula", "https://example.invalid"] ) {
    assert.deepEqual(literalCell("source-value", value), {
      columnId: "source-value",
      kind: "literal",
      value,
    });
  }
  assert.deepEqual(trustedFormulaCell("score", "formula-score-earned-v1"), {
    columnId: "score",
    kind: "trusted-template-formula-reference",
    templateFormulaId: "formula-score-earned-v1",
  });
  assert.throws(() => trustedFormulaCell("score", "=IMPORTXML(A1)"), /allowed value/);
});

test("ExportModel validator rejects reordered/extra tabs and untrusted formula references", () => {
  const original = buildExportModel(buildAnalysis());
  const reordered = structuredClone(original);
  [reordered.tabs[0], reordered.tabs[1]] = [reordered.tabs[1], reordered.tabs[0]];
  assert.throws(() => assertExportModel(reordered), /required constant/);
  const extra = structuredClone(original);
  extra.tabs.push(extra.tabs[0]);
  assert.throws(() => assertExportModel(extra), /no more than 5/);
  const injected = structuredClone(original);
  injected.tabs[0].sections[0].rows[0].cells[0] = {
    columnId: "metric",
    kind: "trusted-template-formula-reference",
    templateFormulaId: "formula-unknown-v1",
  };
  assert.throws(() => assertExportModel(injected), /allowed value/);
});
