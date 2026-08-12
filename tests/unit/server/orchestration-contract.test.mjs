import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const code = readFileSync(resolve(root, 'appsscript/AnalysisOrchestrator.gs'), 'utf8');

test('production orchestration is persisted and emits one truthful stage per RPC', () => {
  assert.match(code, /function vpatBeginAnalysis_\(requestId\)/);
  assert.match(code, /function vpatAdvanceAnalysis_\(payload\)/);
  assert.match(code, /vpatPutUserRecord_\('request'/);
  assert.match(code, /inFlight:\s*\{ cursor: cursor, token: token/);
  assert.match(code, /type: 'STAGE_CHANGED'/);
  assert.match(code, /stageIndex: stageIndex/);
  assert.doesNotMatch(code, /setTimeout|Utilities\.sleep/);
});

test('beginAnalysis emits the exact browser-ingestion action and cursor zero consumes its bound client result', () => {
  assert.match(code, /type: 'INGEST_SOURCE'/);
  assert.match(code, /beginCommand: 'beginSourceBytes'/);
  assert.match(code, /readCommand: 'readSourceByteBatch'/);
  assert.match(code, /clientResult\.type === 'INGESTION_RESULT'/);
  assert.match(code, /sourceBinding\.value\.sha256 === clientResult\.sourceSha256/);
  assert.match(code, /vpatValidateSubmittedIngestion_\(clientResult\.result, record\)/);
});

test('provider stages consume versioned catalog and quality-evidence contracts', () => {
  assert.match(code, /expectedCriteria:/);
  assert.match(code, /var criterion = vpatCatalogCriterion_\(criterionId\)/);
  assert.match(code, /level: criterion\.level/);
  assert.match(code, /qualityClientResult\.type === 'QUALITY_EVIDENCE'/);
  assert.match(code, /var expectedRequirements = vpatBuildExpectedQualityEvidence_\(record, qualityIngestionRecord\.value\)/);
  assert.match(code, /expectedRequirements: expectedRequirements/);
  assert.match(code, /vpatCanonicalJsonValue_\(qualityClientResult\.expectedRequirements\)/);
  assert.doesNotMatch(code, /contextItems:/);
});

test('conformance provider input covers every expected criterion and leaves missing-row evidence empty', () => {
  assert.match(code, /coverage\.expectedCriterionIds\.map\(function \(criterionId\)/);
  assert.match(code, /sourceCriterionLabel: row \? row\.sourceCriterionLabel : ''/);
  assert.match(code, /sourceConformance: row \? row\.sourceConformance : ''/);
  assert.match(code, /sourceRemarks: row \? row\.sourceRemarks : ''/);
});

test('export retry calls only the durable export boundary', () => {
  const retryStart = code.indexOf('function vpatRetryExport_');
  const retryEnd = code.indexOf('function vpatClientCompletedResult_', retryStart);
  const retry = code.slice(retryStart, retryEnd);
  assert.match(retry, /vpatExportStoredAnalysis_\(requestId\)/);
  assert.doesNotMatch(retry, /vpatAnalyzeWithProvider_|vpatReadSourceMetadata_|vpatSerializeGoogleDoc_|vpatBeginSourceBytes_/);
});

test('repeated or stale stage delivery cannot advance the active request twice', () => {
  assert.match(code, /if \(cursor < record\.cursor\) return \{ execute: false, response: vpatPendingResponseForRecord_\(record\) \}/);
  assert.match(code, /if \(!vpatIsActiveRequest_\(requestId\)\)/);
  assert.match(code, /record\.inFlight/);
  assert.match(code, /record\.cursor === cursor && record\.inFlight && record\.inFlight\.token === token/);
});

test('durable step output is reused after a post-effect transition failure', () => {
  assert.match(code, /function vpatDurableOutputKindForCursor_\(cursor\)/);
  assert.match(code, /if \(operation && !durableOutputExists\)/);
  assert.match(code, /var existingConformance = vpatGetUserRecord_\('conformance'/);
  assert.match(code, /var existingQuality = vpatGetUserRecord_\('quality'/);
  const conformanceStart = code.indexOf("var existingConformance = vpatGetUserRecord_('conformance'");
  const conformanceBranch = code.slice(conformanceStart, code.indexOf('if (cursor === 3)', conformanceStart));
  assert.match(conformanceBranch, /if \(existingConformance\)/);
  assert.match(conformanceBranch, /else \{\s*conformance = vpatAnalyzeWithProvider_/);
  assert.match(code, /var completedResponse = vpatCompleteAdvance_/);
  assert.match(code, /if \(outcome\.cleanupTransient\)/);
});

test('fresh pending resumes reconstruct durable stage inputs without duplicating them in request records', () => {
  assert.match(code, /return vpatPendingResponseForRecord_\(record\)/);
  const helperStart = code.indexOf('function vpatPendingResponseForRecord_');
  const helperEnd = code.indexOf('function vpatReleaseAdvanceClaim_', helperStart);
  const helper = code.slice(helperStart, helperEnd);
  assert.match(helper, /vpatGetUserRecord_\('ingestion'/);
  assert.match(helper, /vpatGetUserRecord_\('conformance'/);
  assert.match(helper, /vpatGetUserRecord_\('quality'/);
});

test('retryable provider failure resumes only its persisted cursor under bounded lineage', () => {
  assert.match(code, /status: canRetry \? 'retryable-error' : 'error'/);
  assert.match(code, /failedCursor: canRetry \? cursor : null/);
  assert.match(code, /attempts\[operation\] < VPAT_RETRY_LIMITS_\[operation\]/);
  assert.match(code, /if \(record\.status === 'retryable-error' && Number\.isInteger\(record\.failedCursor\)\)/);
  const retryStart = code.indexOf('function vpatRetryAnalysisFromFailureLocked_');
  const retryEnd = code.indexOf('function vpatRecordRetryableFailure_', retryStart);
  const retry = code.slice(retryStart, retryEnd);
  assert.doesNotMatch(retry, /vpatBeginSourceBytes_|vpatSerializeGoogleDoc_|vpatValidateSubmittedIngestion_/);
});
