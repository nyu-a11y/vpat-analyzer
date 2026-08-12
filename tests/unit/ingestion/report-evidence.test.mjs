import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_FIELD_CHARACTERS,
  MAX_TOTAL_CHARACTERS,
  REPORT_EVIDENCE_FIELDS,
  extractReportEvidence,
} from "../../../src/ingestion/core/report-evidence.mjs";

test("report evidence selects only bounded rubric-relevant document metadata", () => {
  const evidence = extractReportEvidence({
    bodyProse: [
      "Voluntary Product Accessibility Template (VPAT)",
      "Version 2.5Rev",
      "Evaluation methods: expert review, manual keyboard testing, and automated axe-core testing.",
      "Assistive technology testing used NVDA and VoiceOver.",
      "Accessibility contact: accessibility@example.edu.",
      "Unrelated narrative that must not be copied into a provider field.",
    ],
    tables: [{
      context: "Product metadata",
      rows: [
        { cells: ["Product description", "Synthetic collaboration service version 4.2"] },
        { cells: ["Report date", "August 12, 2026"] },
        { cells: ["Tester familiarity", "Advanced product knowledge"] },
        { cells: ["Evaluation scope", "Web and desktop applications"] },
        { cells: ["Conformance terms", "Supports and Partially Supports are defined"] },
      ],
    }],
  });

  assert.deepEqual(Object.keys(evidence), [...REPORT_EVIDENCE_FIELDS]);
  assert.match(evidence.templateVersion, /VPAT|Version 2\.5/);
  assert.match(evidence.productDescription, /Synthetic collaboration service/);
  assert.match(evidence.reportDate, /August 12, 2026/);
  assert.match(evidence.contactInformation, /accessibility@example\.edu/);
  assert.match(evidence.evaluationMethods, /Evaluation methods/);
  assert.match(evidence.assistiveTechnologyTesting, /NVDA and VoiceOver/);
  assert.match(evidence.manualTesting, /manual keyboard testing/);
  assert.match(evidence.automatedTesting, /axe-core/);
  assert.match(evidence.testerFamiliarity, /Advanced product knowledge/);
  assert.match(evidence.conformanceDefinitions, /Partially Supports/);
  assert.match(evidence.scopeNotes, /Web and desktop/);
  assert.doesNotMatch(JSON.stringify(evidence), /Unrelated narrative/);
  assert.equal(Object.values(evidence).every(value => value.length <= MAX_FIELD_CHARACTERS), true);
  assert.ok(Object.values(evidence).reduce((total, value) => total + [...value].length, 0) <= MAX_TOTAL_CHARACTERS);
});
