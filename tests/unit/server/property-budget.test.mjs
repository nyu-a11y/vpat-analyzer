import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import vm from 'node:vm';

import catalog from '../../../config/vpat-2.5-wcag-criteria.v1.json' with { type: 'json' };
import rubric from '../../../config/quality-rubric.v1.json' with { type: 'json' };
import scoringRules from '../../../config/scoring-rules.v1.json' with { type: 'json' };
import { createAnalysisOutput } from '../../../src/domain/analysis-output.mjs';
import { validateConformanceResponse, validateQualityResponse } from '../../../src/domain/ai-response-validator.mjs';
import { buildExportModel } from '../../../src/domain/export-model.mjs';
import { QUALITY_REQUIREMENT_IDS } from '../../../src/domain/quality-ids.mjs';
import { ingestStructuredSource } from '../../../src/ingestion/browser/ingest-bytes.mjs';
import { SERVER_LIMITS } from '../../../src/app/server/server-contracts.mjs';

const sourceFixture = JSON.parse(readFileSync(
  new URL('../../fixtures/synthetic/google-docs-candidate-tables.v1.json', import.meta.url),
  'utf8'
));

function propertyFootprint(value) {
  const serialized = JSON.stringify(value);
  const compressed = gzipSync(serialized);
  const base64Bytes = Math.ceil(compressed.byteLength / 3) * 4;
  const chunkCount = Math.ceil(base64Bytes / SERVER_LIMITS.propertyChunkChars);
  return { rawBytes: Buffer.byteLength(serialized), base64Bytes, chunkCount };
}

test('a synthetic 55-row production pipeline fits the conservative UserProperties budget', () => {
  const requestId = 'req-property-budget-55';
  const candidateDocument = {
    bodyProse: [
      'VPAT Accessibility Conformance Report · Template Version 2.5',
      ...sourceFixture.bodyProse,
    ],
    tables: sourceFixture.candidateTables.map(({ tableId, sourceOrder, headers, rows }) => ({
      tableId,
      sourceOrder,
      context: tableId === 'table-wcag-22-a-aa' ? 'WCAG 2.2 Report · Levels A and AA' : '',
      headers,
      rows,
    })),
  };
  const ingestion = ingestStructuredSource({
    requestId,
    sourceType: 'google-doc',
    candidateDocument,
    catalog,
    declaredWcagVersions: ['2.2'],
    declaredLevels: ['A', 'AA'],
  });
  assert.equal(ingestion.status, 'complete');
  assert.equal(ingestion.rows.length, 55);

  const criterionIds = ingestion.coverage.expectedCriterionIds;
  const conformance = validateConformanceResponse({
    schemaVersion: '1.0.0',
    task: 'conformance-analysis',
    requestId,
    catalogVersion: '1.0.0',
    promptVersion: '1.0.0',
    findings: criterionIds.map((criterionId, index) => ({
      criterionId,
      status: 'Complete',
      normalizedConformance: 'Supports',
      evidence: `Synthetic provider finding ${index + 1}: ${'distinct evidence '.repeat(20)}${criterionId}`,
      confidence: 90,
      reviewRequired: false,
    })),
  }, { requestId, expectedCriterionIds: criterionIds, confidenceThreshold: 70 });
  const quality = validateQualityResponse({
    schemaVersion: '1.0.0',
    task: 'quality-analysis',
    requestId,
    rubricVersion: '1.0.0',
    promptVersion: '1.0.0',
    findings: rubric.requirements.map((requirement, index) => ({
      requirementId: requirement.id,
      status: 'Complete',
      result: index < 12 ? 'Pass' : 'Fail',
      evidence: `Synthetic quality evidence ${index + 1}: ${'bounded detail '.repeat(20)}${requirement.id}`,
      guidance: requirement.guidance,
      confidence: 88,
      reviewRequired: false,
    })),
  }, { requestId, expectedRequirementIds: QUALITY_REQUIREMENT_IDS, confidenceThreshold: 70 });
  const source = {
    displayName: sourceFixture.document.displayName,
    sourceType: 'google-doc',
    vpatVersion: '2.5',
    declaredWcagVersions: ['2.2'],
    declaredLevels: ['A', 'AA'],
  };
  const analysisOutput = createAnalysisOutput({
    requestId,
    source,
    ingestionResult: ingestion,
    conformanceResponse: conformance,
    qualityResponse: quality,
    catalog,
    rubric,
    scoringRules,
  });
  const exportModel = buildExportModel(analysisOutput);
  const appsScriptContext = {
    VPAT_WCAG_CATALOG_: structuredClone(catalog),
    VPAT_QUALITY_RUBRIC_: structuredClone(rubric),
    VPAT_SCORING_RULES_: structuredClone(scoringRules),
    VPAT_QUALITY_REQUIREMENT_IDS_: [...QUALITY_REQUIREMENT_IDS],
  };
  vm.createContext(appsScriptContext);
  new vm.Script([
    'ServerCommon.gs',
    'AnalysisOrchestrator.gs',
    'SheetsExportAdapter.gs',
  ].map((file) => readFileSync(
    new URL(`../../../appsscript/${file}`, import.meta.url),
    'utf8'
  )).join('\n')).runInContext(appsScriptContext);
  const serverExpectedAnalysis = appsScriptContext.vpatExpectedAnalysisOutput_(
    { requestId, source: { name: source.displayName, sourceType: source.sourceType } },
    structuredClone(ingestion),
    structuredClone(conformance),
    structuredClone(quality)
  );
  assert.deepEqual(JSON.parse(JSON.stringify(serverExpectedAnalysis)), analysisOutput);
  assert.deepEqual(
    JSON.parse(JSON.stringify(appsScriptContext.vpatExpectedExportModel_(serverExpectedAnalysis))),
    exportModel
  );
  const missingIngestion = structuredClone(ingestion);
  const missingCriterionId = missingIngestion.rows.at(-1).criterionId;
  missingIngestion.rows = missingIngestion.rows.slice(0, -1);
  missingIngestion.coverage.extractedCriterionIds = missingIngestion.rows.map(row => row.criterionId);
  missingIngestion.coverage.missingCriterionIds = [missingCriterionId];
  const missingAnalysis = createAnalysisOutput({
    requestId,
    source,
    ingestionResult: missingIngestion,
    conformanceResponse: conformance,
    qualityResponse: quality,
    catalog,
    rubric,
    scoringRules,
  });
  const serverMissingAnalysis = appsScriptContext.vpatExpectedAnalysisOutput_(
    { requestId, source: { name: source.displayName, sourceType: source.sourceType } },
    structuredClone(missingIngestion),
    structuredClone(conformance),
    structuredClone(quality)
  );
  assert.deepEqual(JSON.parse(JSON.stringify(serverMissingAnalysis)), missingAnalysis);
  assert.equal(serverMissingAnalysis.analysisStatus, 'Incomplete');
  assert.equal(serverMissingAnalysis.scoreSummary.grade, null);
  const finalEnvelope = {
    schemaVersion: '1.0.0',
    command: 'advanceAnalysis',
    payload: {
      requestId,
      cursor: 4,
      clientResult: { type: 'FINAL_ANALYSIS', analysisOutput, exportModel },
    },
  };
  assert.ok(Buffer.byteLength(JSON.stringify(finalEnvelope)) < SERVER_LIMITS.maxRpcRequestBytes);
  const records = {
    request: {
      schemaVersion: '1.0.0', requestId, source, status: 'pending', cursor: 4, sequence: 5,
      attempts: { source: 1, ingestion: 1, conformance: 1, quality: 1, export: 1 },
      lastResponse: { requestId, status: 'pending', cursor: 4 },
    },
    source: {
      schemaVersion: '1.0.0', requestId, metadata: source, sha256: 'a'.repeat(64),
      byteLength: null, chunkBytes: null, chunkCount: null,
    },
    ingestion,
    conformance,
    quality,
    analysis: { schemaVersion: '1.0.0', requestId, analysisOutput },
  };
  const footprints = Object.values(records).map(propertyFootprint);
  for (const footprint of footprints) {
    assert.ok(footprint.rawBytes <= SERVER_LIMITS.maxStoredJsonBytes);
    assert.ok(footprint.chunkCount <= SERVER_LIMITS.maxPropertyChunks);
  }
  const aggregateBytes = footprints.reduce(
    (total, footprint) => total + footprint.base64Bytes + 500,
    0
  );
  assert.ok(aggregateBytes < SERVER_LIMITS.maxUserPropertyBudgetBytes);
});
