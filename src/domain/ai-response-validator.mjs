import {
  DomainValidationError,
  deepFreeze,
  invalid,
  parseBoundedJson,
  requireArray,
  requireBoolean,
  requireClosedObject,
  requireInteger,
  requireString,
} from "./json-data.mjs";
import { DOMAIN_VERSIONS } from "./versions.mjs";
import { QUALITY_REQUIREMENT_IDS } from "./quality-ids.mjs";

const CONFORMANCE_RESPONSE_PROPERTIES = Object.freeze([
  "schemaVersion",
  "task",
  "requestId",
  "catalogVersion",
  "promptVersion",
  "findings",
]);
const QUALITY_RESPONSE_PROPERTIES = Object.freeze([
  "schemaVersion",
  "task",
  "requestId",
  "rubricVersion",
  "promptVersion",
  "findings",
]);
const CONFORMANCE_COMPLETE_PROPERTIES = Object.freeze([
  "criterionId",
  "status",
  "normalizedConformance",
  "evidence",
  "confidence",
  "reviewRequired",
]);
const CONFORMANCE_INCOMPLETE_PROPERTIES = Object.freeze([
  ...CONFORMANCE_COMPLETE_PROPERTIES,
  "incompleteReason",
]);
const QUALITY_COMPLETE_PROPERTIES = Object.freeze([
  "requirementId",
  "status",
  "result",
  "evidence",
  "guidance",
  "confidence",
  "reviewRequired",
]);
const QUALITY_INCOMPLETE_PROPERTIES = Object.freeze([
  ...QUALITY_COMPLETE_PROPERTIES,
  "incompleteReason",
]);

const CRITERION_ID_PATTERN = /^wcag-sc-[1-4]\.[1-9][0-9]*\.[1-9][0-9]*$/;
const CONFORMANCE_VALUES = new Set([
  "Supports",
  "Partially Supports",
  "Does Not Support",
  "Not Applicable",
  "Not Evaluated",
]);
const CONFORMANCE_INCOMPLETE_REASONS = new Set([
  "INSUFFICIENT_EVIDENCE",
  "CONTRADICTORY_EVIDENCE",
  "UNRECOGNIZED_CONFORMANCE_TERM",
]);
const QUALITY_RESULTS = new Set(["Pass", "Fail"]);
const QUALITY_INCOMPLETE_REASONS = new Set([
  "MISSING_INPUT_EVIDENCE",
  "CONTRADICTORY_INPUT_EVIDENCE",
  "TRUNCATED_INPUT_EVIDENCE",
]);

export class ProviderResponseValidationError extends DomainValidationError {
  constructor(path, reason) {
    super(
      "MALFORMED_RESPONSE",
      path,
      reason,
      "The analysis response was incomplete or malformed. No quality grade was assigned.",
    );
    this.name = "ProviderResponseValidationError";
  }
}

function asProviderError(error) {
  if (error instanceof ProviderResponseValidationError) return error;
  if (error instanceof DomainValidationError) {
    return new ProviderResponseValidationError(error.path, error.message.replace(/^[^:]+: /, ""));
  }
  return error;
}

function validateExpectedIds(expectedIds, path, pattern, minimum, maximum) {
  requireArray(expectedIds, path, {
    minItems: minimum,
    maxItems: maximum,
    code: "MALFORMED_RESPONSE",
  });
  const seen = new Set();
  expectedIds.forEach((id, index) => {
    requireString(id, `${path}[${index}]`, {
      minLength: 1,
      maxLength: 128,
      pattern,
      code: "MALFORMED_RESPONSE",
    });
    if (seen.has(id)) invalid("MALFORMED_RESPONSE", `${path}[${index}]`, "must be unique");
    seen.add(id);
  });
  return seen;
}

function validateEnvelope(response, properties, expected) {
  requireClosedObject(response, "$", properties);
  requireString(response.schemaVersion, "$.schemaVersion", { constant: "1.0.0" });
  requireString(response.task, "$.task", { constant: expected.task });
  requireString(response.requestId, "$.requestId", {
    minLength: 1,
    maxLength: 128,
    constant: expected.requestId,
  });
  requireString(response[expected.versionField], `$.${expected.versionField}`, {
    constant: expected.version,
  });
  requireString(response.promptVersion, "$.promptVersion", {
    constant: expected.promptVersion,
  });
}

function validateEvidence(value, path) {
  requireString(value, path, { minLength: 1, maxLength: 4000 });
}

function validateConformanceFinding(finding, index, expectedIds, confidenceThreshold) {
  const path = `$.findings[${index}]`;
  if (finding === null || typeof finding !== "object" || Array.isArray(finding)) {
    invalid("MALFORMED_RESPONSE", path, "must be an object");
  }
  const statusDescriptor = Object.getOwnPropertyDescriptor(finding, "status");
  if (!statusDescriptor?.enumerable || !("value" in statusDescriptor)) {
    invalid("MALFORMED_RESPONSE", `${path}.status`, "must be a JSON data property");
  }
  const complete = statusDescriptor.value === "Complete";
  const incomplete = statusDescriptor.value === "Incomplete";
  if (!complete && !incomplete) invalid("MALFORMED_RESPONSE", `${path}.status`, "must be Complete or Incomplete");
  requireClosedObject(
    finding,
    path,
    complete ? CONFORMANCE_COMPLETE_PROPERTIES : CONFORMANCE_INCOMPLETE_PROPERTIES,
  );
  requireString(finding.criterionId, `${path}.criterionId`, {
    minLength: 1,
    maxLength: 128,
    pattern: CRITERION_ID_PATTERN,
  });
  if (!expectedIds.has(finding.criterionId)) {
    invalid("MALFORMED_RESPONSE", `${path}.criterionId`, "is not an expected criterion ID");
  }
  validateEvidence(finding.evidence, `${path}.evidence`);
  requireBoolean(finding.reviewRequired, `${path}.reviewRequired`);

  if (complete) {
    requireString(finding.normalizedConformance, `${path}.normalizedConformance`, {
      allowed: CONFORMANCE_VALUES,
    });
    requireInteger(finding.confidence, `${path}.confidence`, { minimum: 0, maximum: 100 });
    return {
      criterionId: finding.criterionId,
      status: "Complete",
      normalizedConformance: finding.normalizedConformance,
      evidence: finding.evidence,
      confidence: finding.confidence,
      reviewRequired: finding.reviewRequired || finding.confidence < confidenceThreshold,
    };
  }

  if (finding.normalizedConformance !== null) {
    invalid("MALFORMED_RESPONSE", `${path}.normalizedConformance`, "must be null when incomplete");
  }
  if (finding.confidence !== null) {
    invalid("MALFORMED_RESPONSE", `${path}.confidence`, "must be null when incomplete");
  }
  if (finding.reviewRequired !== true) {
    invalid("MALFORMED_RESPONSE", `${path}.reviewRequired`, "must be true when incomplete");
  }
  requireString(finding.incompleteReason, `${path}.incompleteReason`, {
    allowed: CONFORMANCE_INCOMPLETE_REASONS,
  });
  return {
    criterionId: finding.criterionId,
    status: "Incomplete",
    normalizedConformance: null,
    evidence: finding.evidence,
    confidence: null,
    reviewRequired: true,
    incompleteReason: finding.incompleteReason,
  };
}

function validateQualityFinding(finding, index, expectedIds, confidenceThreshold) {
  const path = `$.findings[${index}]`;
  if (finding === null || typeof finding !== "object" || Array.isArray(finding)) {
    invalid("MALFORMED_RESPONSE", path, "must be an object");
  }
  const statusDescriptor = Object.getOwnPropertyDescriptor(finding, "status");
  if (!statusDescriptor?.enumerable || !("value" in statusDescriptor)) {
    invalid("MALFORMED_RESPONSE", `${path}.status`, "must be a JSON data property");
  }
  const complete = statusDescriptor.value === "Complete";
  const incomplete = statusDescriptor.value === "Incomplete";
  if (!complete && !incomplete) invalid("MALFORMED_RESPONSE", `${path}.status`, "must be Complete or Incomplete");
  requireClosedObject(
    finding,
    path,
    complete ? QUALITY_COMPLETE_PROPERTIES : QUALITY_INCOMPLETE_PROPERTIES,
  );
  requireString(finding.requirementId, `${path}.requirementId`, {
    minLength: 1,
    maxLength: 128,
  });
  if (!expectedIds.has(finding.requirementId)) {
    invalid("MALFORMED_RESPONSE", `${path}.requirementId`, "is not an expected requirement ID");
  }
  validateEvidence(finding.evidence, `${path}.evidence`);
  requireString(finding.guidance, `${path}.guidance`, { minLength: 1, maxLength: 4000 });
  requireBoolean(finding.reviewRequired, `${path}.reviewRequired`);

  if (complete) {
    requireString(finding.result, `${path}.result`, { allowed: QUALITY_RESULTS });
    requireInteger(finding.confidence, `${path}.confidence`, { minimum: 0, maximum: 100 });
    return {
      requirementId: finding.requirementId,
      status: "Complete",
      result: finding.result,
      evidence: finding.evidence,
      guidance: finding.guidance,
      confidence: finding.confidence,
      reviewRequired: finding.reviewRequired || finding.confidence < confidenceThreshold,
    };
  }

  if (finding.result !== "Incomplete") {
    invalid("MALFORMED_RESPONSE", `${path}.result`, "must be Incomplete when status is Incomplete");
  }
  if (finding.confidence !== null) {
    invalid("MALFORMED_RESPONSE", `${path}.confidence`, "must be null when incomplete");
  }
  if (finding.reviewRequired !== true) {
    invalid("MALFORMED_RESPONSE", `${path}.reviewRequired`, "must be true when incomplete");
  }
  requireString(finding.incompleteReason, `${path}.incompleteReason`, {
    allowed: QUALITY_INCOMPLETE_REASONS,
  });
  return {
    requirementId: finding.requirementId,
    status: "Incomplete",
    result: "Incomplete",
    evidence: finding.evidence,
    guidance: finding.guidance,
    confidence: null,
    reviewRequired: true,
    incompleteReason: finding.incompleteReason,
  };
}

function validateExactCoverage(findings, expectedIds, idField) {
  const findingById = new Map();
  findings.forEach((finding, index) => {
    const id = finding[idField];
    if (findingById.has(id)) {
      invalid("MALFORMED_RESPONSE", `$.findings[${index}].${idField}`, "duplicates a finding ID");
    }
    findingById.set(id, finding);
  });
  for (const id of expectedIds) {
    if (!findingById.has(id)) {
      invalid("MALFORMED_RESPONSE", "$.findings", `is missing expected ID ${id}`);
    }
  }
  if (findingById.size !== expectedIds.length) {
    invalid("MALFORMED_RESPONSE", "$.findings", "must contain exactly the expected IDs");
  }
  return expectedIds.map((id) => findingById.get(id));
}

export function validateConformanceResponse(input, options) {
  try {
    const expectedIds = [...options.expectedCriterionIds];
    const expectedIdSet = validateExpectedIds(
      expectedIds,
      "$.expectedCriterionIds",
      CRITERION_ID_PATTERN,
      1,
      87,
    );
    const response = parseBoundedJson(input, {
      maxCharacters: options.maxCharacters ?? 1_000_000,
      maxDepth: 10,
      maxNodes: 2000,
    });
    validateEnvelope(response, CONFORMANCE_RESPONSE_PROPERTIES, {
      task: "conformance-analysis",
      requestId: options.requestId,
      versionField: "catalogVersion",
      version: options.catalogVersion ?? DOMAIN_VERSIONS.catalogVersion,
      promptVersion: options.promptVersion ?? DOMAIN_VERSIONS.conformancePromptVersion,
    });
    const findings = requireArray(response.findings, "$.findings", {
      minItems: 1,
      maxItems: 87,
    }).map((finding, index) =>
      validateConformanceFinding(
        finding,
        index,
        expectedIdSet,
        options.confidenceThreshold ?? 70,
      ),
    );
    const ordered = validateExactCoverage(findings, expectedIds, "criterionId");
    return deepFreeze({
      schemaVersion: "1.0.0",
      task: "conformance-analysis",
      requestId: response.requestId,
      catalogVersion: response.catalogVersion,
      promptVersion: response.promptVersion,
      findings: ordered,
    });
  } catch (error) {
    throw asProviderError(error);
  }
}

export function validateQualityResponse(input, options) {
  try {
    const expectedIds = [...options.expectedRequirementIds];
    const expectedIdSet = validateExpectedIds(
      expectedIds,
      "$.expectedRequirementIds",
      /^qr-[a-z0-9]+$/,
      16,
      16,
    );
    if (expectedIds.some((id, index) => id !== QUALITY_REQUIREMENT_IDS[index])) {
      invalid(
        "MALFORMED_RESPONSE",
        "$.expectedRequirementIds",
        "must equal the versioned 16-item quality requirement ID sequence",
      );
    }
    const response = parseBoundedJson(input, {
      maxCharacters: options.maxCharacters ?? 1_000_000,
      maxDepth: 10,
      maxNodes: 1000,
    });
    validateEnvelope(response, QUALITY_RESPONSE_PROPERTIES, {
      task: "quality-analysis",
      requestId: options.requestId,
      versionField: "rubricVersion",
      version: options.rubricVersion ?? DOMAIN_VERSIONS.rubricVersion,
      promptVersion: options.promptVersion ?? DOMAIN_VERSIONS.qualityPromptVersion,
    });
    const findings = requireArray(response.findings, "$.findings", {
      minItems: 16,
      maxItems: 16,
    }).map((finding, index) =>
      validateQualityFinding(finding, index, expectedIdSet, options.confidenceThreshold ?? 70),
    );
    const ordered = validateExactCoverage(findings, expectedIds, "requirementId");
    return deepFreeze({
      schemaVersion: "1.0.0",
      task: "quality-analysis",
      requestId: response.requestId,
      rubricVersion: response.rubricVersion,
      promptVersion: response.promptVersion,
      findings: ordered,
    });
  } catch (error) {
    throw asProviderError(error);
  }
}
