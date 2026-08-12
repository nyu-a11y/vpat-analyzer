import assert from "node:assert/strict";
import test from "node:test";

import { gradeForPercentage, incompleteScore, scoreQualityFindings } from "../../../src/domain/scoring.mjs";
import { qualityResponse, rubric, scoringRules } from "./fixtures.mjs";

test("grade bands cover exact boundaries", () => {
  const cases = [[0, "F"], [60, "F"], [61, "D"], [69, "D"], [70, "C"], [79, "C"], [80, "B"], [89, "B"], [90, "A-"], [94, "A-"], [95, "A"], [100, "A"]];
  cases.forEach(([percentage, grade]) => assert.equal(gradeForPercentage(percentage), grade));
});

test("completed Pass/Fail findings produce deterministic weighted grade", () => {
  const findings = qualityResponse().findings;
  findings.find(({ requirementId }) => requirementId === "qr-e12").result = "Fail";
  const score = scoreQualityFindings({ findings, rubric, scoringRules });
  assert.deepEqual(score, {
    status: "Complete",
    earnedWeight: 56,
    possibleWeight: 60,
    percentage: 93,
    grade: "A-",
  });
});

test("all completed Fail is a legitimate F, while incomplete/provider errors have null grade", () => {
  const allFail = scoreQualityFindings({
    findings: qualityResponse("request-domain-1", "Fail").findings,
    rubric,
    scoringRules,
  });
  assert.equal(allFail.status, "Complete");
  assert.equal(allFail.grade, "F");
  const missing = scoreQualityFindings({
    findings: qualityResponse().findings.slice(1),
    rubric,
    scoringRules,
    operationalReasons: ["PROVIDER_ERROR"],
  });
  assert.deepEqual(missing, {
    status: "Incomplete",
    earnedWeight: null,
    possibleWeight: null,
    percentage: null,
    grade: null,
    incompleteReasons: ["PROVIDER_ERROR", "MISSING_FINDING"],
  });
  assert.equal(Object.isFrozen(incompleteScore(["EXPORT_ERROR"])), true);
});
