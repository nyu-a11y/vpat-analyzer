import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CLIENT_STATES,
  PROCESSING_STAGES,
  REVIEW_VIEWS,
  SHEET_TABS,
  createInitialState,
  reduceClientState,
} from '../../../src/app/client/model.mjs';

const source = Object.freeze({ id: 'file-1', name: '<b>Literal name</b>.docx', type: 'DOCX' });
const result = Object.freeze({
  analysisId: 'analysis-1',
  summary: Object.freeze({ grade: 'B', score: 82 }),
});

function selectedState(requestId = 'request-1') {
  let state = createInitialState();
  state = reduceClientState(state, { type: 'VALIDATION_STARTED', requestId, source });
  return reduceClientState(state, { type: 'VALIDATION_SUCCEEDED', requestId, source });
}

test('review views and exported Sheet tabs remain separate exact contracts', () => {
  assert.deepEqual(REVIEW_VIEWS.map(view => view.label), ['Summary', 'WCAG criteria', 'Report quality']);
  assert.deepEqual(SHEET_TABS, ['Overview', 'Line-item Review', 'Quality Requirements', 'Scoring', 'Methodology & disclaimer']);
});

test('processing advances only through monotonic event-backed stages', () => {
  let state = selectedState();
  state = reduceClientState(state, { type: 'ANALYSIS_STARTED', requestId: 'request-1' });
  assert.equal(state.status, CLIENT_STATES.PROCESSING);
  assert.equal(state.stageIndex, -1);

  state = reduceClientState(state, { type: 'STAGE_CHANGED', requestId: 'request-1', stageIndex: 0 });
  assert.equal(state.stageIndex, 0);
  const retrograde = reduceClientState(state, { type: 'STAGE_CHANGED', requestId: 'request-1', stageIndex: 0 });
  assert.strictEqual(retrograde, state);
  const skippedForward = reduceClientState(state, { type: 'STAGE_CHANGED', requestId: 'request-1', stageIndex: 3 });
  assert.equal(skippedForward.stageIndex, 3);
  assert.equal(PROCESSING_STAGES.length, 5);
});

test('stale callbacks are rejected by identity before any client effect', () => {
  let state = selectedState('active-request');
  state = reduceClientState(state, { type: 'ANALYSIS_STARTED', requestId: 'active-request' });
  const staleStage = reduceClientState(state, { type: 'STAGE_CHANGED', requestId: 'stale-request', stageIndex: 0 });
  assert.strictEqual(staleStage, state);
  const staleComplete = reduceClientState(state, { type: 'ANALYSIS_COMPLETED', requestId: 'stale-request', result });
  assert.strictEqual(staleComplete, state);

  const reset = reduceClientState(state, { type: 'RESET' });
  const lateComplete = reduceClientState(reset, { type: 'ANALYSIS_COMPLETED', requestId: 'active-request', result });
  assert.strictEqual(lateComplete, reset);
});

test('completed deterministic result replaces provisional source metadata with analyzed coverage', () => {
  let state = selectedState();
  state = reduceClientState(state, { type: 'ANALYSIS_STARTED', requestId: 'request-1' });
  const analyzedSource = { ...source, vpatVersion: '2.5', wcagVersion: '2.2', levels: ['A', 'AA'] };
  state = reduceClientState(state, {
    type: 'ANALYSIS_COMPLETED',
    requestId: 'request-1',
    result: { ...result, source: analyzedSource },
  });
  assert.strictEqual(state.source, analyzedSource);
});

test('operational analysis failures never retain or invent a grade', () => {
  let state = selectedState();
  state = reduceClientState(state, { type: 'ANALYSIS_STARTED', requestId: 'request-1' });
  state = reduceClientState(state, { type: 'ANALYSIS_FAILED', requestId: 'request-1', retryable: true });
  assert.equal(state.status, CLIENT_STATES.ANALYSIS_RETRYABLE);
  assert.equal(state.result, null);

  state = reduceClientState(state, { type: 'ANALYSIS_STARTED', requestId: 'request-1' });
  state = reduceClientState(state, { type: 'ANALYSIS_FAILED', requestId: 'request-1', retryable: false });
  assert.equal(state.status, CLIENT_STATES.ANALYSIS_PERMANENT);
  assert.equal(state.result, null);
});

test('export retry preserves immutable completed analysis and never enters analysis stages', () => {
  let state = selectedState();
  state = reduceClientState(state, { type: 'ANALYSIS_STARTED', requestId: 'request-1' });
  state = reduceClientState(state, { type: 'EXPORT_FAILED', requestId: 'request-1', result });
  assert.equal(state.status, CLIENT_STATES.EXPORT_ERROR);
  assert.strictEqual(state.result, result);

  state = reduceClientState(state, { type: 'EXPORT_RETRY_STARTED', requestId: 'request-1' });
  assert.equal(state.status, CLIENT_STATES.EXPORT_ERROR);
  assert.equal(state.exportRetrying, true);
  assert.strictEqual(state.result, result);

  state = reduceClientState(state, { type: 'EXPORT_RETRY_FAILED', requestId: 'request-1', detail: 'Try later' });
  assert.equal(state.status, CLIENT_STATES.EXPORT_ERROR);
  assert.equal(state.exportRetrying, false);
  assert.strictEqual(state.result, result);
});

test('validation result kinds produce explicit non-quality states', () => {
  const kinds = new Map([
    ['inaccessible', CLIENT_STATES.INACCESSIBLE],
    ['unsupported', CLIENT_STATES.UNSUPPORTED],
    ['non-searchable-pdf', CLIENT_STATES.NON_SEARCHABLE_PDF],
    ['no-wcag-tables', CLIENT_STATES.NO_WCAG_TABLES],
    ['nyu-access', CLIENT_STATES.NYU_ACCESS_ERROR],
  ]);
  for (const [kind, expected] of kinds) {
    let state = createInitialState();
    state = reduceClientState(state, { type: 'VALIDATION_STARTED', requestId: kind, source });
    state = reduceClientState(state, { type: 'VALIDATION_FAILED', requestId: kind, kind });
    assert.equal(state.status, expected);
    assert.equal(state.result, null);
  }
});

test('terminal ingestion rejection during processing preserves the exact error state without a grade', () => {
  let state = selectedState();
  state = reduceClientState(state, { type: 'ANALYSIS_STARTED', requestId: 'request-1' });
  state = reduceClientState(state, {
    type: 'ANALYSIS_REJECTED',
    requestId: 'request-1',
    kind: 'non-searchable-pdf',
    detail: 'Searchable text was not found.',
  });
  assert.equal(state.status, CLIENT_STATES.NON_SEARCHABLE_PDF);
  assert.equal(state.result, null);
  assert.equal(state.errorDetail, 'Searchable text was not found.');
});
