import {
  deepFreeze,
  invalid,
  requireArray,
  requireClosedObject,
  requireString,
} from "./json-data.mjs";
import { QUALITY_REQUIREMENT_IDS } from "./quality-ids.mjs";
import { incompleteScore, scoreQualityFindings } from "./scoring.mjs";
import { DOMAIN_VERSIONS, exportProvenance } from "./versions.mjs";

const SOURCE_PROPERTIES = Object.freeze([
  "displayName",
  "sourceType",
  "vpatVersion",
  "declaredWcagVersions",
  "declaredLevels",
]);
const SOURCE_TYPES = new Set(["google-doc", "docx", "pdf"]);
const WCAG_VERSIONS = new Set(["2.0", "2.1", "2.2"]);
const WCAG_LEVELS = new Set(["A", "AA", "AAA"]);

function validateUniqueStringArray(value, path, allowed) {
  requireArray(value, path, {
    minItems: 1,
    maxItems: 3,
    code: "INVALID_ANALYSIS_OUTPUT",
  });
  const seen = new Set();
  value.forEach((item, index) => {
    requireString(item, `${path}[${index}]`, {
      allowed,
      code: "INVALID_ANALYSIS_OUTPUT",
    });
    if (seen.has(item)) invalid("INVALID_ANALYSIS_OUTPUT", `${path}[${index}]`, "must be unique");
    seen.add(item);
  });
  return [...value];
}

function validateSource(source) {
  requireClosedObject(source, "$.source", SOURCE_PROPERTIES, "INVALID_ANALYSIS_OUTPUT");
  requireString(source.displayName, "$.source.displayName", {
    minLength: 1,
    maxLength: 512,
    code: "INVALID_ANALYSIS_OUTPUT",
  });
  requireString(source.sourceType, "$.source.sourceType", {
    allowed: SOURCE_TYPES,
    code: "INVALID_ANALYSIS_OUTPUT",
  });
  requireString(source.vpatVersion, "$.source.vpatVersion", {
    constant: "2.5",
    code: "INVALID_ANALYSIS_OUTPUT",
  });
  return {
    displayName: source.displayName,
    sourceType: source.sourceType,
    vpatVersion: "2.5",
    declaredWcagVersions: validateUniqueStringArray(
      source.declaredWcagVersions,
      "$.source.declaredWcagVersions",
      WCAG_VERSIONS,
    ),
    declaredLevels: validateUniqueStringArray(
      source.declaredLevels,
      "$.source.declaredLevels",
      WCAG_LEVELS,
    ),
  };
}

function validateVersions(provenance) {
  const expected = exportProvenance();
  requireClosedObject(
    provenance,
    "$.provenance",
    Object.keys(expected),
    "INVALID_ANALYSIS_OUTPUT",
  );
  for (const key of Object.keys(expected)) {
    requireString(provenance[key], `$.provenance.${key}`, {
      constant: expected[key],
      code: "INVALID_ANALYSIS_OUTPUT",
    });
  }
  return { ...expected };
}

function indexUnique(items, idField, expectedIds, path) {
  const byId = new Map();
  items.forEach((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      invalid("INVALID_ANALYSIS_OUTPUT", `${path}[${index}]`, "must be an object");
    }
    const id = item[idField];
    if (!expectedIds.has(id)) {
      invalid("INVALID_ANALYSIS_OUTPUT", `${path}[${index}].${idField}`, "is not expected");
    }
    if (byId.has(id)) {
      invalid("INVALID_ANALYSIS_OUTPUT", `${path}[${index}].${idField}`, "must be unique");
    }
    byId.set(id, item);
  });
  return byId;
}

function validateInputs(options) {
  requireString(options.requestId, "$.requestId", {
    minLength: 1,
    maxLength: 128,
    code: "INVALID_ANALYSIS_OUTPUT",
  });
  const ingestion = options.ingestionResult;
  if (!ingestion || typeof ingestion !== "object" || ingestion.status !== "complete") {
    invalid("INVALID_ANALYSIS_OUTPUT", "$.ingestionResult", "must be a complete ingestion result");
  }
  if (ingestion.requestId !== options.requestId) {
    invalid("INVALID_ANALYSIS_OUTPUT", "$.ingestionResult.requestId", "must match the request ID");
  }
  if (ingestion.catalogVersion !== DOMAIN_VERSIONS.catalogVersion) {
    invalid("INVALID_ANALYSIS_OUTPUT", "$.ingestionResult.catalogVersion", "must match catalog v1");
  }
  if (!ingestion.coverage || !Array.isArray(ingestion.coverage.expectedCriterionIds)) {
    invalid("INVALID_ANALYSIS_OUTPUT", "$.ingestionResult.coverage", "must contain expected criterion IDs");
  }
  const expectedCriterionIds = [...ingestion.coverage.expectedCriterionIds];
  const expectedCriterionSet = new Set(expectedCriterionIds);
  if (expectedCriterionIds.length === 0 || expectedCriterionSet.size !== expectedCriterionIds.length) {
    invalid("INVALID_ANALYSIS_OUTPUT", "$.ingestionResult.coverage.expectedCriterionIds", "must be nonempty and unique");
  }

  const conformance = options.conformanceResponse;
  if (
    !conformance ||
    conformance.task !== "conformance-analysis" ||
    conformance.requestId !== options.requestId ||
    conformance.catalogVersion !== DOMAIN_VERSIONS.catalogVersion ||
    conformance.promptVersion !== DOMAIN_VERSIONS.conformancePromptVersion
  ) {
    invalid("INVALID_ANALYSIS_OUTPUT", "$.conformanceResponse", "has a mismatched response envelope");
  }
  const conformanceFindings = requireArray(conformance.findings, "$.conformanceResponse.findings", {
    minItems: expectedCriterionIds.length,
    maxItems: expectedCriterionIds.length,
    code: "INVALID_ANALYSIS_OUTPUT",
  });
  const conformanceById = indexUnique(
    conformanceFindings,
    "criterionId",
    expectedCriterionSet,
    "$.conformanceResponse.findings",
  );
  for (const criterionId of expectedCriterionIds) {
    if (!conformanceById.has(criterionId)) {
      invalid(
        "INVALID_ANALYSIS_OUTPUT",
        "$.conformanceResponse.findings",
        `is missing ${criterionId}`,
      );
    }
  }

  const quality = options.qualityResponse;
  if (
    !quality ||
    quality.task !== "quality-analysis" ||
    quality.requestId !== options.requestId ||
    quality.rubricVersion !== DOMAIN_VERSIONS.rubricVersion ||
    quality.promptVersion !== DOMAIN_VERSIONS.qualityPromptVersion
  ) {
    invalid("INVALID_ANALYSIS_OUTPUT", "$.qualityResponse", "has a mismatched response envelope");
  }
  const qualityFindings = requireArray(quality.findings, "$.qualityResponse.findings", {
    minItems: 16,
    maxItems: 16,
    code: "INVALID_ANALYSIS_OUTPUT",
  });
  const qualityById = indexUnique(
    qualityFindings,
    "requirementId",
    new Set(QUALITY_REQUIREMENT_IDS),
    "$.qualityResponse.findings",
  );
  for (const requirementId of QUALITY_REQUIREMENT_IDS) {
    if (!qualityById.has(requirementId)) {
      invalid(
        "INVALID_ANALYSIS_OUTPUT",
        "$.qualityResponse.findings",
        `is missing ${requirementId}`,
      );
    }
  }
  return { ingestion, expectedCriterionIds, conformanceById, qualityById };
}

export function createAnalysisOutput(options) {
  const { ingestion, expectedCriterionIds, conformanceById, qualityById } = validateInputs(options);
  const source = validateSource(options.source);
  const provenance = validateVersions(options.provenance ?? exportProvenance());

  const catalogCriteria = requireArray(options.catalog.criteria, "$.catalog.criteria", {
    minItems: 1,
    maxItems: 87,
    code: "INVALID_ANALYSIS_OUTPUT",
  });
  const criterionById = new Map(catalogCriteria.map((criterion) => [criterion.id, criterion]));
  const rowByCriterionId = new Map();
  for (const row of ingestion.rows) {
    if (!rowByCriterionId.has(row.criterionId)) rowByCriterionId.set(row.criterionId, row);
  }

  const wcagFindings = expectedCriterionIds.map((criterionId) => {
    const criterion = criterionById.get(criterionId);
    if (!criterion) {
      invalid("INVALID_ANALYSIS_OUTPUT", "$.catalog.criteria", `is missing ${criterionId}`);
    }
    const finding = conformanceById.get(criterionId);
    const row = rowByCriterionId.get(criterionId) ?? null;
    return {
      criterionId,
      sc: criterion.sc,
      title: criterion.title,
      level: criterion.level,
      rowId: row?.rowId ?? null,
      sourceCriterionLabel: row?.sourceCriterionLabel ?? null,
      sourceConformance: row?.sourceConformance ?? null,
      sourceRemarks: row?.sourceRemarks ?? null,
      status: finding.status,
      normalizedConformance: finding.normalizedConformance,
      evidence: finding.evidence,
      confidence: finding.confidence,
      reviewRequired: finding.reviewRequired,
      ...(finding.incompleteReason ? { incompleteReason: finding.incompleteReason } : {}),
    };
  });

  const rubricRequirements = requireArray(options.rubric.requirements, "$.rubric.requirements", {
    minItems: 16,
    maxItems: 16,
    code: "INVALID_ANALYSIS_OUTPUT",
  });
  const requirementById = new Map(rubricRequirements.map((requirement) => [requirement.id, requirement]));
  const qualityFindings = QUALITY_REQUIREMENT_IDS.map((requirementId) => {
    const requirement = requirementById.get(requirementId);
    if (!requirement) {
      invalid("INVALID_ANALYSIS_OUTPUT", "$.rubric.requirements", `is missing ${requirementId}`);
    }
    const finding = qualityById.get(requirementId);
    return {
      requirementId,
      aliases: [...requirement.aliases],
      title: requirement.title,
      type: requirement.type,
      impact: { weight: requirement.impact.weight, label: requirement.impact.label },
      status: finding.status,
      result: finding.result,
      evidence: finding.evidence,
      guidance: finding.guidance,
      confidence: finding.confidence,
      reviewRequired: finding.reviewRequired,
      ...(finding.incompleteReason ? { incompleteReason: finding.incompleteReason } : {}),
    };
  });

  const allFindingsComplete =
    ingestion.coverage.missingCriterionIds.length === 0 &&
    wcagFindings.every((finding) => finding.status === "Complete") &&
    qualityFindings.every((finding) => finding.status === "Complete");
  const qualityScore = scoreQualityFindings({
    findings: qualityFindings,
    rubric: options.rubric,
    scoringRules: options.scoringRules,
    operationalReasons: options.operationalReasons ?? [],
  });
  const scoreSummary = allFindingsComplete ? qualityScore : incompleteScore([
    ...(qualityScore.status === "Incomplete" ? qualityScore.incompleteReasons : []),
    "MISSING_FINDING",
  ]);

  const output = {
    schemaVersion: "1.0.0",
    requestId: options.requestId,
    analysisStatus: allFindingsComplete && scoreSummary.status === "Complete" ? "Complete" : "Incomplete",
    source,
    provenance,
    ingestion: {
      parserVersion: ingestion.parserVersion,
      expectedCriterionIds,
      missingCriterionIds: [...ingestion.coverage.missingCriterionIds],
    },
    wcagFindings,
    qualityFindings,
    scoreSummary,
    counts: {
      criteria: wcagFindings.length,
      qualityRequirements: qualityFindings.length,
      reviewRequired:
        wcagFindings.filter((finding) => finding.reviewRequired).length +
        qualityFindings.filter((finding) => finding.reviewRequired).length,
    },
  };
  return deepFreeze(output);
}

export function assertAnalysisOutput(value, requestId = value?.requestId) {
  if (!value || typeof value !== "object" || !Object.isFrozen(value)) {
    invalid("INVALID_ANALYSIS_OUTPUT", "$", "must be an immutable AnalysisOutput");
  }
  requireString(value.schemaVersion, "$.schemaVersion", {
    constant: "1.0.0",
    code: "INVALID_ANALYSIS_OUTPUT",
  });
  requireString(value.requestId, "$.requestId", {
    constant: requestId,
    code: "INVALID_ANALYSIS_OUTPUT",
  });
  if (!Array.isArray(value.wcagFindings) || !Array.isArray(value.qualityFindings)) {
    invalid("INVALID_ANALYSIS_OUTPUT", "$", "must contain finding arrays");
  }
  if (!Object.isFrozen(value.wcagFindings) || !Object.isFrozen(value.qualityFindings)) {
    invalid("INVALID_ANALYSIS_OUTPUT", "$", "must be deeply immutable");
  }
  return value;
}
