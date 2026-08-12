import { readFileSync } from "node:fs";

const ROOT = new URL("../../../", import.meta.url);

export function loadJson(path) {
  return JSON.parse(readFileSync(new URL(path, ROOT), "utf8"));
}

export const catalog = loadJson("config/vpat-2.5-wcag-criteria.v1.json");
export const rubric = loadJson("config/quality-rubric.v1.json");
export const scoringRules = loadJson("config/scoring-rules.v1.json");

export function sampleIngestion(requestId = "request-domain-1", criterionIds = ["wcag-sc-1.1.1"]) {
  return {
    schemaVersion: "1.0.0",
    requestId,
    parserVersion: "1.0.0",
    catalogVersion: "1.0.0",
    sourceType: "docx",
    status: "complete",
    candidateTables: [],
    rows: criterionIds.map((criterionId, index) => ({
      rowId: `row-${index + 1}`,
      criterionId,
      sourceCriterionLabel: criterionId.replace("wcag-sc-", ""),
      sourceConformance: index === 0 ? "=literal source" : "Supports",
      sourceRemarks: index === 0 ? "+literal remarks" : `Evidence ${index + 1}`,
      sourceTableIndex: 0,
      sourceRowIndex: index + 1,
      aliasMatch: "exact-sc",
    })),
    excludedRows: [],
    duplicates: [],
    coverage: {
      declaredWcagVersions: ["2.2"],
      declaredLevels: ["A", "AA"],
      expectedCriterionIds: criterionIds,
      extractedCriterionIds: criterionIds,
      missingCriterionIds: [],
    },
  };
}

export function conformanceResponse(requestId = "request-domain-1", criterionIds = ["wcag-sc-1.1.1"]) {
  return {
    schemaVersion: "1.0.0",
    task: "conformance-analysis",
    requestId,
    catalogVersion: "1.0.0",
    promptVersion: "1.0.0",
    findings: criterionIds.map((criterionId, index) => ({
      criterionId,
      status: "Complete",
      normalizedConformance: index === 0 ? "Does Not Support" : "Supports",
      evidence: index === 0 ? "=literal provider evidence" : `Finding ${index + 1}`,
      confidence: 90,
      reviewRequired: false,
    })),
  };
}

export function qualityResponse(requestId = "request-domain-1", result = "Pass") {
  return {
    schemaVersion: "1.0.0",
    task: "quality-analysis",
    requestId,
    rubricVersion: "1.0.0",
    promptVersion: "1.0.0",
    findings: rubric.requirements.map((requirement) => ({
      requirementId: requirement.id,
      status: "Complete",
      result,
      evidence: requirement.id === "qr-e12" ? "@literal evidence" : `Evidence ${requirement.id}`,
      guidance: requirement.guidance,
      confidence: 85,
      reviewRequired: false,
    })),
  };
}

export function sourceDescriptor() {
  return {
    displayName: "Synthetic VPAT =1+1",
    sourceType: "docx",
    vpatVersion: "2.5",
    declaredWcagVersions: ["2.2"],
    declaredLevels: ["A", "AA"],
  };
}
