import {
  deepFreeze,
  invalid,
  requireArray,
  requireClosedObject,
  requireInteger,
  requireString,
} from "./json-data.mjs";
import { QUALITY_REQUIREMENT_IDS } from "./quality-ids.mjs";

const INCOMPLETE_REASONS = new Set([
  "INGESTION_ERROR",
  "MISSING_FINDING",
  "PROVIDER_ERROR",
  "MALFORMED_RESPONSE",
  "EXPORT_ERROR",
]);
const GRADE_BANDS = Object.freeze([
  Object.freeze({ grade: "F", min: 0, max: 60 }),
  Object.freeze({ grade: "D", min: 61, max: 69 }),
  Object.freeze({ grade: "C", min: 70, max: 79 }),
  Object.freeze({ grade: "B", min: 80, max: 89 }),
  Object.freeze({ grade: "A-", min: 90, max: 94 }),
  Object.freeze({ grade: "A", min: 95, max: 100 }),
]);

function uniqueReasons(reasons) {
  const output = [];
  const seen = new Set();
  for (const reason of reasons) {
    requireString(reason, "$.incompleteReasons[]", {
      allowed: INCOMPLETE_REASONS,
      code: "INVALID_SCORE_INPUT",
    });
    if (!seen.has(reason)) {
      output.push(reason);
      seen.add(reason);
    }
  }
  return output;
}

export function incompleteScore(incompleteReasons) {
  const reasons = uniqueReasons(incompleteReasons);
  if (reasons.length === 0) reasons.push("MISSING_FINDING");
  return deepFreeze({
    status: "Incomplete",
    earnedWeight: null,
    possibleWeight: null,
    percentage: null,
    grade: null,
    incompleteReasons: reasons,
  });
}

export function gradeForPercentage(percentage, bands = GRADE_BANDS) {
  requireInteger(percentage, "$.percentage", {
    minimum: 0,
    maximum: 100,
    code: "INVALID_SCORE_INPUT",
  });
  const match = bands.find((band) => percentage >= band.min && percentage <= band.max);
  if (!match) invalid("INVALID_SCORE_INPUT", "$.percentage", "does not match a grade band");
  return match.grade;
}

function validateRubric(rubric) {
  requireClosedObject(
    rubric,
    "$.rubric",
    ["id", "version", "requirementCount", "primaryIdPolicy", "sourceAnomalies", "requirements"],
    "INVALID_SCORE_INPUT",
  );
  requireString(rubric.version, "$.rubric.version", {
    constant: "1.0.0",
    code: "INVALID_SCORE_INPUT",
  });
  requireInteger(rubric.requirementCount, "$.rubric.requirementCount", {
    minimum: 16,
    maximum: 16,
    code: "INVALID_SCORE_INPUT",
  });
  requireArray(rubric.requirements, "$.rubric.requirements", {
    minItems: 16,
    maxItems: 16,
    code: "INVALID_SCORE_INPUT",
  });
  const byId = new Map();
  rubric.requirements.forEach((requirement, index) => {
    if (!requirement || typeof requirement !== "object" || Array.isArray(requirement)) {
      invalid("INVALID_SCORE_INPUT", `$.rubric.requirements[${index}]`, "must be an object");
    }
    requireString(requirement.id, `$.rubric.requirements[${index}].id`, {
      constant: QUALITY_REQUIREMENT_IDS[index],
      code: "INVALID_SCORE_INPUT",
    });
    if (!requirement.impact || typeof requirement.impact !== "object") {
      invalid("INVALID_SCORE_INPUT", `$.rubric.requirements[${index}].impact`, "must be an object");
    }
    requireInteger(requirement.impact.weight, `$.rubric.requirements[${index}].impact.weight`, {
      minimum: 2,
      maximum: 5,
      code: "INVALID_SCORE_INPUT",
    });
    byId.set(requirement.id, requirement);
  });
  return byId;
}

function validateRules(scoringRules) {
  if (!scoringRules || typeof scoringRules !== "object" || Array.isArray(scoringRules)) {
    invalid("INVALID_SCORE_INPUT", "$.scoringRules", "must be an object");
  }
  requireString(scoringRules.version, "$.scoringRules.version", {
    constant: "1.0.0",
    code: "INVALID_SCORE_INPUT",
  });
  requireString(scoringRules.rubricVersion, "$.scoringRules.rubricVersion", {
    constant: "1.0.0",
    code: "INVALID_SCORE_INPUT",
  });
  requireInteger(scoringRules.requiredRequirementCount, "$.scoringRules.requiredRequirementCount", {
    minimum: 16,
    maximum: 16,
    code: "INVALID_SCORE_INPUT",
  });
  requireInteger(scoringRules.totalPossibleWeight, "$.scoringRules.totalPossibleWeight", {
    minimum: 60,
    maximum: 60,
    code: "INVALID_SCORE_INPUT",
  });
  const bands = requireArray(scoringRules.bands, "$.scoringRules.bands", {
    minItems: 6,
    maxItems: 6,
    code: "INVALID_SCORE_INPUT",
  });
  bands.forEach((band, index) => {
    const expected = GRADE_BANDS[index];
    if (band.grade !== expected.grade || band.min !== expected.min || band.max !== expected.max) {
      invalid("INVALID_SCORE_INPUT", `$.scoringRules.bands[${index}]`, "does not match scoring v1");
    }
  });
  return bands;
}

export function scoreQualityFindings(options) {
  const rubricById = validateRubric(options.rubric);
  const bands = validateRules(options.scoringRules);
  const findings = requireArray(options.findings, "$.findings", {
    minItems: 0,
    maxItems: 16,
    code: "INVALID_SCORE_INPUT",
  });
  const byId = new Map();
  let malformed = false;
  findings.forEach((finding, index) => {
    if (!finding || typeof finding !== "object" || Array.isArray(finding)) {
      invalid("INVALID_SCORE_INPUT", `$.findings[${index}]`, "must be an object");
    }
    const id = finding.requirementId;
    if (!rubricById.has(id) || byId.has(id)) malformed = true;
    byId.set(id, finding);
  });

  const operationalReasons = uniqueReasons(options.operationalReasons ?? []);
  const missingOrIncomplete = QUALITY_REQUIREMENT_IDS.some(
    (id) => !byId.has(id) || byId.get(id).status !== "Complete",
  );
  if (malformed || missingOrIncomplete || operationalReasons.length > 0) {
    return incompleteScore([
      ...operationalReasons,
      ...(malformed || missingOrIncomplete ? ["MISSING_FINDING"] : []),
    ]);
  }

  let earnedWeight = 0;
  for (const id of QUALITY_REQUIREMENT_IDS) {
    const finding = byId.get(id);
    if (finding.result !== "Pass" && finding.result !== "Fail") {
      return incompleteScore(["MISSING_FINDING"]);
    }
    if (finding.result === "Pass") earnedWeight += rubricById.get(id).impact.weight;
  }
  const possibleWeight = 60;
  const percentage = Math.floor((earnedWeight / possibleWeight) * 100 + 0.5);
  return deepFreeze({
    status: "Complete",
    earnedWeight,
    possibleWeight,
    percentage,
    grade: gradeForPercentage(percentage, bands),
  });
}

export { GRADE_BANDS, INCOMPLETE_REASONS };
