import assert from 'node:assert/strict';
import test from 'node:test';

import { assertClientBridge, createGoogleScriptBridge } from '../../../src/app/client/bridge.mjs';
import { PROCESSING_STAGES } from '../../../src/app/client/model.mjs';
import { SYNTHETIC_SOURCE, createSyntheticClientBridge } from '../../../src/app/client/synthetic-adapter.mjs';

function createRunner(responses) {
  let successHandler = () => {};
  let failureHandler = () => {};
  const calls = [];
  const runner = {
    calls,
    withSuccessHandler(handler) {
      successHandler = handler;
      return runner;
    },
    withFailureHandler(handler) {
      failureHandler = handler;
      return runner;
    },
  };

  for (const [method, queue] of Object.entries(responses)) {
    runner[method] = payload => {
      calls.push([method, payload]);
      const response = queue.shift();
      queueMicrotask(() => {
        if (response instanceof Error) failureHandler(response);
        else successHandler(response);
      });
    };
  }
  return runner;
}

test('bridge contract rejects missing production operations', () => {
  assert.throws(() => assertClientBridge({}), /listDriveFiles/);
});

test('production bridge never falls back when the Apps Script runtime is unavailable', () => {
  assert.throws(() => createGoogleScriptBridge({ runner: null }), /google\.script\.run is not available/);
});

test('production bridge reconciles the server-owned active request without persisting a Drive ID locally', async () => {
  const runner = createRunner({
    rpcCommand: [JSON.stringify({
      ok: true,
      data: {
        requestId: 'request-active',
        status: 'selected',
        source: { id: 'drive-source-1', name: 'Active VPAT.docx', sourceType: 'docx', size: 1024 },
      },
    })],
  });
  const bridge = createGoogleScriptBridge({ runner });
  const resumed = await bridge.resumeActive();
  assert.deepEqual(resumed, {
    requestId: 'request-active',
    status: 'selected',
    source: {
      id: 'drive-source-1',
      name: 'Active VPAT.docx',
      sourceType: 'docx',
      size: 1024,
      type: 'DOCX',
      sizeLabel: '1 KB',
    },
  });
  assert.deepEqual(JSON.parse(runner.calls[0][1]), {
    schemaVersion: '1.0.0',
    command: 'resumeActive',
    payload: {},
  });
});

test('RPC codec serializes requests and exposes only the server safe error message', async () => {
  const runner = createRunner({
    rpcCommand: [JSON.stringify({
      schemaVersion: '1.0.0',
      ok: false,
      error: {
        code: 'ACCESS_REQUIRED',
        kind: 'nyu-access',
        safeMessage: 'NYU access is required.',
        message: 'Internal unsafe detail',
        retryable: false,
      },
    })],
  });
  const bridge = createGoogleScriptBridge({ runner });
  await assert.rejects(bridge.listDriveFiles({ query: 'literal <query>' }), error => {
    assert.equal(error.message, 'NYU access is required.');
    assert.equal(error.safeMessage, 'NYU access is required.');
    assert.equal(error.kind, 'nyu-access');
    assert.equal(error.retryable, false);
    return true;
  });
  assert.deepEqual(JSON.parse(runner.calls[0][1]), {
    schemaVersion: '1.0.0',
    command: 'listSources',
    payload: { query: 'literal <query>' },
  });
});

test('Apps Script bridge accepts each persisted stage in a separate begin/advance response', async () => {
  const requestId = 'request-1';
  const stages = PROCESSING_STAGES.map((_, stageIndex) => ({ type: 'STAGE_CHANGED', requestId, stageIndex }));
  const result = { analysisId: 'analysis-1', summary: { grade: 'B', score: 82 } };
  const runner = createRunner({
    rpcCommand: [
      JSON.stringify({ ok: true, data: { status: 'pending', cursor: 'cursor-1', event: stages[0] } }),
      JSON.stringify({ ok: true, data: { status: 'pending', cursor: 'cursor-2', event: stages[1] } }),
      JSON.stringify({ ok: true, data: { status: 'pending', cursor: 'cursor-3', event: stages[2] } }),
      JSON.stringify({ ok: true, data: { status: 'pending', cursor: 'cursor-4', event: stages[3] } }),
      JSON.stringify({ ok: true, data: { status: 'pending', cursor: 'cursor-5', event: stages[4] } }),
      JSON.stringify({ ok: true, data: { status: 'complete', outcome: { requestId, status: 'complete', result } } }),
    ],
  });
  const bridge = createGoogleScriptBridge({
    runner,
    finalizeAnalysis: () => ({ analysisOutput: {}, exportModel: {} }),
  });
  const accepted = [];
  const outcome = await bridge.startAnalysis({
    requestId,
    source: SYNTHETIC_SOURCE,
    onEvent: event => accepted.push(event.stageIndex),
  });

  assert.deepEqual(accepted, [0, 1, 2, 3, 4]);
  assert.deepEqual(outcome, { requestId, status: 'complete', result });
  assert.deepEqual(runner.calls.map(([method]) => method), Array(6).fill('rpcCommand'));
  assert.deepEqual(runner.calls.map(([, envelope]) => JSON.parse(envelope).command), [
    'beginAnalysis',
    'advanceAnalysis',
    'advanceAnalysis',
    'advanceAnalysis',
    'advanceAnalysis',
    'advanceAnalysis',
  ]);
});

test('production bridge serializes the exact persisted ingestion, quality, and final-analysis protocol', async () => {
  const requestId = 'request-protocol';
  const source = { ...SYNTHETIC_SOURCE, sourceType: 'docx' };
  const ingestion = {
    status: 'complete',
    sourceType: 'docx',
    coverage: {
      expectedCriterionIds: ['wcag-sc-1.1.1'],
      declaredWcagVersions: ['2.2'],
      declaredLevels: ['A', 'AA'],
    },
    rows: [{
      criterionId: 'wcag-sc-1.1.1',
      sourceCriterionLabel: '1.1.1 Non-text Content',
      sourceConformance: 'Supports',
      sourceRemarks: 'Text alternatives are documented.',
    }],
  };
  const conformanceResponse = { kind: 'conformance-response' };
  const qualityResponse = { kind: 'quality-response' };
  const finalObjects = { analysisOutput: { requestId }, exportModel: { requestId } };
  const stages = PROCESSING_STAGES.map((_, stageIndex) => ({ type: 'STAGE_CHANGED', requestId, stageIndex }));
  const runner = createRunner({
    rpcCommand: [
      JSON.stringify({ ok: true, result: { status: 'pending', cursor: 0, event: stages[0], action: { type: 'INGEST_SOURCE', source } } }),
      JSON.stringify({ ok: true, result: { status: 'pending', cursor: 1, event: stages[1] } }),
      JSON.stringify({ ok: true, result: { status: 'pending', cursor: 2, event: stages[2] } }),
      JSON.stringify({ ok: true, result: { status: 'pending', cursor: 3, event: stages[3], stageData: { conformanceResponse } } }),
      JSON.stringify({ ok: true, result: { status: 'pending', cursor: 4, event: stages[4], stageData: { qualityResponse } } }),
      JSON.stringify({ ok: true, result: { requestId, status: 'complete', result: { analysisId: requestId, summary: {}, source: {}, wcagItems: [], qualityItems: [] } } }),
    ],
  });
  const finalizerInputs = [];
  const bridge = createGoogleScriptBridge({
    runner,
    performIngestion: async () => ({ result: ingestion, sourceSha256: 'a'.repeat(64) }),
    finalizeAnalysis: input => {
      finalizerInputs.push(input);
      return finalObjects;
    },
  });

  await bridge.startAnalysis({ requestId, source, onEvent() {} });

  const payloads = runner.calls.map(([, serialized]) => JSON.parse(serialized).payload);
  assert.deepEqual(payloads[1].clientResult, {
    type: 'INGESTION_RESULT',
    result: ingestion,
    sourceSha256: 'a'.repeat(64),
  });
  assert.deepEqual(payloads[2], { requestId, cursor: 1 });
  assert.deepEqual(payloads[3], { requestId, cursor: 2 });
  assert.equal(payloads[4].clientResult.type, 'QUALITY_EVIDENCE');
  assert.equal(payloads[4].clientResult.expectedRequirements.length, 16);
  assert.deepEqual(payloads[5].clientResult, { type: 'FINAL_ANALYSIS', ...finalObjects });
  assert.deepEqual(finalizerInputs, [{
    requestId,
    source,
    ingestion,
    conformanceResponse,
    qualityResponse,
  }]);
});

test('production bridge resumes a persisted provider stage from server-restored deterministic stage data', async () => {
  const requestId = 'request-resume';
  const source = { ...SYNTHETIC_SOURCE, sourceType: 'docx' };
  const ingestion = {
    status: 'complete',
    sourceType: 'docx',
    coverage: {
      expectedCriterionIds: ['wcag-sc-1.1.1'],
      declaredWcagVersions: ['2.2'],
      declaredLevels: ['A'],
    },
    rows: [{ sourceCriterionLabel: '1.1.1', sourceConformance: 'Supports', sourceRemarks: 'Documented.' }],
  };
  const conformanceResponse = { resumed: 'conformance' };
  const qualityResponse = { resumed: 'quality' };
  const stage = stageIndex => ({ type: 'STAGE_CHANGED', requestId, stageIndex });
  const runner = createRunner({
    rpcCommand: [
      JSON.stringify({ ok: true, result: { status: 'pending', cursor: 2, event: stage(2), stageData: { ingestionResult: ingestion } } }),
      JSON.stringify({ ok: true, result: { status: 'pending', cursor: 3, event: stage(3), stageData: { ingestionResult: ingestion, conformanceResponse } } }),
      JSON.stringify({ ok: true, result: { status: 'pending', cursor: 4, event: stage(4), stageData: { ingestionResult: ingestion, conformanceResponse, qualityResponse } } }),
      JSON.stringify({ ok: true, result: { requestId, status: 'complete', result: { analysisId: requestId, summary: {}, source: {}, wcagItems: [], qualityItems: [] } } }),
    ],
  });
  const finalizerInputs = [];
  const bridge = createGoogleScriptBridge({
    runner,
    finalizeAnalysis: input => {
      finalizerInputs.push(input);
      return { analysisOutput: { requestId }, exportModel: { requestId } };
    },
  });

  await bridge.startAnalysis({ requestId, source, onEvent() {} });

  assert.deepEqual(finalizerInputs, [{ requestId, source, ingestion, conformanceResponse, qualityResponse }]);
  const payloads = runner.calls.map(([, serialized]) => JSON.parse(serialized).payload);
  assert.deepEqual(payloads[1], { requestId, cursor: 2 });
  assert.equal(payloads[2].clientResult.type, 'QUALITY_EVIDENCE');
  assert.equal(payloads[3].clientResult.type, 'FINAL_ANALYSIS');
});

test('synthetic adapter drives the same five-event core-flow contract', async () => {
  const bridge = createSyntheticClientBridge({ stageDelay: 0 });
  const files = await bridge.listDriveFiles({ query: 'northstar' });
  const source = files.find(file => file.id === SYNTHETIC_SOURCE.id);
  const validation = await bridge.validateSource({ requestId: 'synthetic-request', source });
  assert.equal(validation.status, 'selected');

  const stages = [];
  const outcome = await bridge.startAnalysis({
    requestId: 'synthetic-request',
    source,
    onEvent: event => stages.push(event.stageIndex),
  });
  assert.deepEqual(stages, [0, 1, 2, 3, 4]);
  assert.equal(outcome.status, 'complete');
  assert.equal(outcome.result.summary.grade, 'B');
  assert.equal(outcome.result.wcagItems.length, 5);
});

test('synthetic non-searchable PDF rejects without OCR fallback', async () => {
  const bridge = createSyntheticClientBridge({ stageDelay: 0 });
  const [file] = await bridge.listDriveFiles({ query: 'scanned' });
  const validation = await bridge.validateSource({ requestId: 'pdf-request', source: file });
  assert.deepEqual(validation, {
    requestId: 'pdf-request',
    status: 'rejected',
    kind: 'non-searchable-pdf',
  });
});
