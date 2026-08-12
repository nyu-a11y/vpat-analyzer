import assert from 'node:assert/strict';
import test from 'node:test';

import {
  finalizeProductionAnalysis,
  mapProductionCompletedResult,
} from '../../../src/app/client/finalize-analysis.mjs';
import {
  conformanceResponse,
  qualityResponse,
  sampleIngestion,
} from '../domain/fixtures.mjs';

test('production finalizer builds immutable analysis and exact five-tab export model', () => {
  const requestId = 'request-client-finalize';
  const ids = ['wcag-sc-1.1.1', 'wcag-sc-1.2.1'];
  const finalized = finalizeProductionAnalysis({
    requestId,
    source: { name: 'Literal <source>.docx', sourceType: 'docx' },
    ingestion: sampleIngestion(requestId, ids),
    conformanceResponse: conformanceResponse(requestId, ids),
    qualityResponse: qualityResponse(requestId),
  });
  assert.equal(Object.isFrozen(finalized.analysisOutput), true);
  assert.deepEqual(finalized.exportModel.tabs.map(tab => tab.name), [
    'Overview',
    'Line-item Review',
    'Quality Requirements',
    'Scoring',
    'Methodology & disclaimer',
  ]);
  assert.equal(finalized.analysisOutput.source.displayName, 'Literal <source>.docx');
});

test('production completed result maps domain output and receipt to review presentation', () => {
  const requestId = 'request-client-map';
  const ids = ['wcag-sc-1.1.1'];
  const finalized = finalizeProductionAnalysis({
    requestId,
    source: { name: 'Literal <source>.docx', sourceType: 'docx' },
    ingestion: sampleIngestion(requestId, ids),
    conformanceResponse: conformanceResponse(requestId, ids),
    qualityResponse: qualityResponse(requestId),
  });
  const mapped = mapProductionCompletedResult({
    localPreview: true,
    analysisOutput: finalized.analysisOutput,
    receipt: { spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/synthetic-test-id/edit' },
  }, { id: 'source-1', name: 'Fallback.docx' });
  assert.equal(mapped.summary.grade, 'A');
  assert.equal(mapped.summary.criteriaReviewed, 1);
  assert.equal(mapped.wcagItems[0].authorRemarks, '+literal remarks');
  assert.equal(mapped.qualityItems.length, 16);
  assert.equal(mapped.sheet.url, 'https://docs.google.com/spreadsheets/d/synthetic-test-id/edit');
  assert.equal(mapped.localPreview, false);
});

test('UI-ready server summary is normalized without changing finding arrays', () => {
  const wcagItems = [{ id: 'wcag-sc-1.1.1' }];
  const qualityItems = Array.from({ length: 16 }, (_, index) => ({ id: `qr-${index}` }));
  const mapped = mapProductionCompletedResult({
    analysisId: 'analysis-1',
    summary: {
      analysisStatus: 'Complete',
      scoreSummary: { grade: 'B', percentage: 82 },
      counts: { criteria: 55, qualityRequirements: 16 },
    },
    source: {
      displayName: 'Literal <server source>.docx',
      sourceType: 'docx',
      vpatVersion: '2.5',
      declaredWcagVersions: ['2.2'],
      declaredLevels: ['A', 'AA'],
    },
    wcagItems,
    qualityItems,
  }, { id: 'drive-source-1', sizeLabel: '1.5 MB' });
  assert.deepEqual(mapped.summary, {
    analysisStatus: 'Complete',
    grade: 'B',
    score: 82,
    criteriaReviewed: 55,
    qualityRequirements: 16,
  });
  assert.strictEqual(mapped.wcagItems, wcagItems);
  assert.strictEqual(mapped.qualityItems, qualityItems);
  assert.equal(mapped.localPreview, false);
  assert.deepEqual(mapped.source, {
    displayName: 'Literal <server source>.docx',
    sourceType: 'docx',
    vpatVersion: '2.5',
    declaredWcagVersions: ['2.2'],
    declaredLevels: ['A', 'AA'],
    id: 'drive-source-1',
    name: 'Literal <server source>.docx',
    type: 'DOCX',
    sizeLabel: '1.5 MB',
    wcagVersion: '2.2',
    levels: ['A', 'AA'],
  });
});
