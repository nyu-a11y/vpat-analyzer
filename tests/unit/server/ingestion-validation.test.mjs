import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import catalog from '../../../config/vpat-2.5-wcag-criteria.v1.json' with { type: 'json' };
import rubric from '../../../config/quality-rubric.v1.json' with { type: 'json' };
import { buildQualityEvidence } from '../../../src/app/client/quality-evidence.mjs';
import { ingestStructuredSource } from '../../../src/ingestion/browser/ingest-bytes.mjs';

const appsscript = [
  'appsscript/ServerCommon.gs',
  'appsscript/AnalysisOrchestrator.gs',
].map((path) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')).join('\n');
const sourceFixture = JSON.parse(readFileSync(
  new URL('../../fixtures/synthetic/google-docs-candidate-tables.v1.json', import.meta.url),
  'utf8'
));

function makeContext() {
  const context = {
    VPAT_WCAG_CATALOG_: structuredClone(catalog),
    VPAT_QUALITY_RUBRIC_: structuredClone(rubric),
    VPAT_QUALITY_REQUIREMENT_IDS_: rubric.requirements.map(({ id }) => id),
    Utilities: {
      newBlob(value) {
        return { getBytes: () => [...Buffer.from(String(value), 'utf8')] };
      },
    },
  };
  vm.createContext(context);
  new vm.Script(appsscript).runInContext(context);
  return context;
}

function completeIngestion(requestId = 'req-server-ingestion') {
  return ingestStructuredSource({
    requestId,
    sourceType: 'google-doc',
    candidateDocument: {
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
    },
    catalog,
    declaredWcagVersions: ['2.2'],
    declaredLevels: ['A', 'AA'],
  });
}

test('Apps Script accepts the validated 55-row result and independently enforces canonical scope', () => {
  const context = makeContext();
  const ingestion = completeIngestion();
  const record = {
    requestId: ingestion.requestId,
    source: { sourceType: 'google-doc' },
  };
  assert.equal(context.vpatValidateSubmittedIngestion_(ingestion, record), ingestion);

  const omittedExpectedCriterion = structuredClone(ingestion);
  omittedExpectedCriterion.coverage.expectedCriterionIds.pop();
  omittedExpectedCriterion.coverage.missingCriterionIds.pop();
  assert.throws(
    () => context.vpatValidateSubmittedIngestion_(omittedExpectedCriterion, record),
    (error) => error.vpatCode === 'INVALID_REQUEST'
  );

  const undeclaredField = structuredClone(ingestion);
  undeclaredField.serverShouldTrustThis = true;
  assert.throws(
    () => context.vpatValidateSubmittedIngestion_(undeclaredField, record),
    (error) => error.vpatCode === 'INVALID_REQUEST'
  );
});

test('rejected ingestion is source-bound and replaces client text with a server-safe message', () => {
  const context = makeContext();
  const requestId = 'req-rejected-ingestion';
  const rejected = {
    schemaVersion: '1.0.0',
    requestId,
    parserVersion: '1.0.0',
    catalogVersion: '1.0.0',
    sourceType: 'unknown',
    status: 'rejected',
    rejection: {
      code: 'SOURCE_TYPE_UNSUPPORTED',
      stage: 'classification',
      safeMessage: 'Client-controlled text is not returned.',
    },
  };
  const normalized = context.vpatValidateSubmittedIngestion_(rejected, {
    requestId,
    source: { sourceType: 'pdf' },
  });
  assert.equal(normalized.rejection.safeMessage, 'The authoritative source format is unsupported or inconsistent.');
});

test('server reconstructs the exact bounded quality evidence, including link minimization', () => {
  const context = makeContext();
  const ingestion = completeIngestion('req-quality-evidence');
  ingestion.rows[0].sourceRemarks = 'See https://private.example.invalid/path and data:text/plain,private for details.';
  const source = { name: 'Synthetic https://private.example.invalid VPAT', sourceType: 'google-doc' };
  const clientEvidence = buildQualityEvidence({ source, ingestion });
  const serverEvidence = context.vpatBuildExpectedQualityEvidence_({ source }, ingestion);
  assert.deepEqual(JSON.parse(JSON.stringify(serverEvidence)), clientEvidence);
  assert.doesNotMatch(JSON.stringify(serverEvidence), /private\.example\.invalid|data:text/);
});
