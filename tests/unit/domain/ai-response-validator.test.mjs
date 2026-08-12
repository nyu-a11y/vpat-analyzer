import assert from "node:assert/strict";
import test from "node:test";

import {
  ProviderResponseValidationError,
  validateConformanceResponse,
  validateQualityResponse,
} from "../../../src/domain/ai-response-validator.mjs";
import { QUALITY_REQUIREMENT_IDS } from "../../../src/domain/quality-ids.mjs";
import { conformanceResponse, qualityResponse } from "./fixtures.mjs";

function clone(value) {
  return structuredClone(value);
}

test("conformance response validates exact envelope and orders exact expected IDs", () => {
  const ids = ["wcag-sc-1.1.1", "wcag-sc-1.2.1"];
  const response = conformanceResponse("request-a", [...ids].reverse());
  const validated = validateConformanceResponse(JSON.stringify(response), {
    requestId: "request-a",
    expectedCriterionIds: ids,
  });
  assert.deepEqual(validated.findings.map(({ criterionId }) => criterionId), ids);
  assert.equal(Object.isFrozen(validated), true);
  assert.equal(Object.isFrozen(validated.findings[0]), true);
});

test("quality response validates the immutable 16-ID sequence and derives review threshold", () => {
  const response = qualityResponse("request-q");
  response.findings.reverse();
  response.findings.find(({ requirementId }) => requirementId === "qr-e12").confidence = 69;
  const validated = validateQualityResponse(response, {
    requestId: "request-q",
    expectedRequirementIds: QUALITY_REQUIREMENT_IDS,
  });
  assert.deepEqual(validated.findings.map(({ requirementId }) => requirementId), QUALITY_REQUIREMENT_IDS);
  assert.equal(validated.findings[0].reviewRequired, true);
});

test("strict response validation rejects unknown, duplicate, missing, wrong-request, and wrong-version data", () => {
  const ids = ["wcag-sc-1.1.1", "wcag-sc-1.2.1"];
  const cases = [
    (value) => { value.findings[1].criterionId = "wcag-sc-9.9.9"; },
    (value) => { value.findings[1].criterionId = ids[0]; },
    (value) => { value.findings.pop(); },
    (value) => { value.requestId = "stale"; },
    (value) => { value.catalogVersion = "2.0.0"; },
    (value) => { value.findings[0].extra = true; },
    (value) => { value.findings[0].confidence = 101; },
  ];
  for (const mutate of cases) {
    const response = clone(conformanceResponse("request-a", ids));
    mutate(response);
    assert.throws(
      () => validateConformanceResponse(response, { requestId: "request-a", expectedCriterionIds: ids }),
      ProviderResponseValidationError,
    );
  }
});

test("incomplete quality finding cannot masquerade as Fail or carry a grade-making confidence", () => {
  const response = qualityResponse("request-q");
  response.findings[0] = {
    requirementId: "qr-e12",
    status: "Incomplete",
    result: "Fail",
    evidence: "Provider did not complete.",
    guidance: "Retry analysis.",
    confidence: null,
    reviewRequired: true,
    incompleteReason: "MISSING_INPUT_EVIDENCE",
  };
  assert.throws(
    () => validateQualityResponse(response, {
      requestId: "request-q",
      expectedRequirementIds: QUALITY_REQUIREMENT_IDS,
    }),
    /must be Incomplete/,
  );
});

test("bounded parser rejects prose, oversized input, excessive depth, and accessors", () => {
  const options = { requestId: "request-a", expectedCriterionIds: ["wcag-sc-1.1.1"] };
  assert.throws(() => validateConformanceResponse("Here is JSON: {}", options), /valid JSON/);
  assert.throws(
    () => validateConformanceResponse(" ".repeat(100) + "{}", { ...options, maxCharacters: 10 }),
    /character limit/,
  );
  const response = conformanceResponse("request-a");
  Object.defineProperty(response, "task", { enumerable: true, get() { throw new Error("ran"); } });
  assert.throws(() => validateConformanceResponse(response, options), /JSON data properties|JSON data property/);
});
