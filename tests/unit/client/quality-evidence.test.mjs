import assert from 'node:assert/strict';
import test from 'node:test';

import rubric from '../../../config/quality-rubric.v1.json' with { type: 'json' };
import { buildQualityEvidence } from '../../../src/app/client/quality-evidence.mjs';

const ALLOWED_FIELDS = new Set([
  'source-display-name',
  'source-type',
  'declared-wcag-versions',
  'declared-levels',
  'criterion-coverage',
  'criterion-answer-coverage',
  'conformance-terms-used',
  'conformance-term-definitions',
  'evaluation-methods',
  'assistive-technology-testing',
  'manual-testing',
  'automated-testing',
  'contact-information',
  'tester-familiarity',
  'product-description',
  'scope-notes',
  'remarks-coverage',
  'remarks-sample',
  'vpat-template-version',
  'report-date',
]);

const REPORT_EVIDENCE = Object.freeze({
  templateVersion: 'VPAT template version 2.5Rev',
  productDescription: 'Product description: Synthetic collaboration service version 4.2',
  reportDate: 'Report date: August 12, 2026',
  contactInformation: 'Accessibility contact: accessibility@example.edu',
  evaluationMethods: 'Evaluation methods: expert review and task-based testing',
  assistiveTechnologyTesting: 'Assistive technology testing: NVDA and VoiceOver',
  manualTesting: 'Manual testing: keyboard and zoom review',
  automatedTesting: 'Automated testing: axe-core',
  testerFamiliarity: 'Tester familiarity: advanced product knowledge',
  conformanceDefinitions: 'Conformance terms: Supports and Partially Supports are defined',
  scopeNotes: 'Evaluation scope: web application and supported desktop clients',
});

test('quality evidence preserves the exact immutable 16-requirement rubric contract', () => {
  const requirements = buildQualityEvidence({
    source: { name: 'Synthetic VPAT.docx', sourceType: 'docx' },
    ingestion: {
      status: 'complete',
      sourceType: 'docx',
      reportEvidence: REPORT_EVIDENCE,
      coverage: { declaredWcagVersions: ['2.2'], declaredLevels: ['A', 'AA'] },
      rows: [{
        sourceCriterionLabel: '1.1.1 Non-text Content',
        sourceConformance: 'Supports',
        sourceRemarks: 'Text alternatives are documented.',
      }],
    },
  });

  assert.equal(requirements.length, 16);
  assert.deepEqual(requirements.map(item => item.requirementId), rubric.requirements.map(item => item.id));
  for (const [index, item] of requirements.entries()) {
    const expected = rubric.requirements[index];
    assert.deepEqual(
      { aliases: item.aliases, title: item.title, type: item.type, impact: item.impact, description: item.description, guidance: item.guidance },
      { aliases: expected.aliases, title: expected.title, type: expected.type, impact: expected.impact, description: expected.description, guidance: expected.guidance },
    );
  }
});

test('a report with the allowlisted metadata projection can supply evidence for all 16 quality requirements', () => {
  const requirements = buildQualityEvidence({
    source: { name: 'Synthetic VPAT.docx', sourceType: 'docx' },
    ingestion: {
      status: 'complete',
      sourceType: 'docx',
      reportEvidence: REPORT_EVIDENCE,
      coverage: {
        declaredWcagVersions: ['2.2'],
        declaredLevels: ['A', 'AA'],
        expectedCriterionIds: ['wcag-sc-1.1.1'],
        missingCriterionIds: [],
      },
      rows: [{
        criterionId: 'wcag-sc-1.1.1',
        sourceCriterionLabel: '1.1.1 Non-text Content',
        sourceConformance: 'Supports',
        sourceRemarks: 'Text alternatives are documented.',
      }],
    },
  });
  assert.equal(requirements.every(requirement => requirement.evidence.length > 0), true);
});

test('quality evidence is deterministic, allowlisted, bounded, and carries no URL or binary fields', () => {
  const repeated = 'evidence '.repeat(2000);
  const input = {
    source: { name: repeated, sourceType: 'pdf' },
    ingestion: {
      status: 'complete',
      sourceType: 'pdf',
      reportEvidence: REPORT_EVIDENCE,
      coverage: { declaredWcagVersions: ['2.0', '2.1', '2.2'], declaredLevels: ['A', 'AA', 'AAA'] },
      rows: Array.from({ length: 40 }, (_, index) => ({
        sourceCriterionLabel: `criterion ${index} ${repeated}`,
        sourceConformance: `Supports ${repeated}`,
        sourceRemarks: `remarks ${index} https://example.invalid/private-${index} ${repeated}`,
      })),
    },
  };
  const first = buildQualityEvidence(input);
  const second = buildQualityEvidence(input);
  assert.deepEqual(first, second);

  const evidence = first.flatMap(requirement => requirement.evidence);
  assert.ok(first.every(requirement => requirement.evidence.length > 0));
  assert.ok(first.every(requirement => requirement.evidence.length <= 16));
  assert.ok(evidence.every(item => ALLOWED_FIELDS.has(item.fieldId)));
  assert.ok(evidence.every(item => item.value.length <= 4000));
  assert.ok(evidence.reduce((total, item) => total + item.value.length, 0) <= 20000);
  assert.ok(evidence.every(item => !/(?:https?|ftp):\/\/|\bwww\.|\bdata:/iu.test(item.value)));
  assert.ok(evidence.every(item => !['bodyProse', 'binary', 'image', 'url'].includes(item.fieldId)));
});
