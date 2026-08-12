import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPortkeyRequest,
  minimizeProviderPayload,
  parsePortkeyResponse,
  readProviderConfiguration
} from '../../../src/app/server/provider-port.mjs';

const versions = { catalogVersion: '1.0.0', rubricVersion: '1.0.0', schemaVersion: '1.0.0' };

test('provider configuration comes only from the injected Script Properties port and remains Gemini-routed', () => {
  const values = new Map([
    ['VPAT_PORTKEY_API_KEY', 'portkey-secret'],
    ['VPAT_PORTKEY_VIRTUAL_KEY', 'google-credential-reference'],
    ['VPAT_GEMINI_MODEL', '@google/gemini-production-alias']
  ]);
  const config = readProviderConfiguration({ get: (key) => values.get(key) });
  assert.equal(config.endpoint, 'https://api.portkey.ai/v1/chat/completions');
  assert.equal(config.model, '@google/gemini-production-alias');
  assert.throws(() => readProviderConfiguration({ get: () => null }), (error) => error.code === 'PROVIDER_NOT_CONFIGURED');
});

test('provider minimization excludes binaries, Drive references, secrets, and arbitrary fields', () => {
  const payload = minimizeProviderPayload('conformance', {
    requestId: 'req-provider-1', promptVersion: '1.0.0', contractVersions: versions,
    expectedCriteria: [{ criterionId: 'wcag-sc-1.1.1', sc: '1.1.1', title: 'Non-text Content', level: 'A', sourceCriterionLabel: '1.1.1 Non-text Content', sourceConformance: 'Supports', sourceRemarks: '=literal evidence', rawPageImage: 'SECRET' }],
    sourceBinary: 'SECRET', sourceRef: 'private-drive-id', apiKey: 'SECRET'
  });
  assert.deepEqual(Object.keys(payload).sort(), ['catalogVersion', 'confidenceThreshold', 'contractVersions', 'expectedCriteria', 'promptVersion', 'requestId']);
  assert.deepEqual(Object.keys(payload.expectedCriteria[0]).sort(), ['criterionId', 'level', 'sc', 'sourceConformance', 'sourceCriterionLabel', 'sourceRemarks', 'title']);
  assert.doesNotMatch(JSON.stringify(payload), /SECRET|private-drive-id/);
});

test('Portkey request is schema constrained and sends the minimized payload', () => {
  const config = {
    endpoint: 'https://api.portkey.ai/v1/chat/completions', apiKey: 'pk', virtualKey: 'vk', model: 'gemini-alias'
  };
  const request = buildPortkeyRequest('conformance', {
    requestId: 'req-provider-2', promptVersion: '1.0.0', contractVersions: versions,
    expectedCriteria: [{ criterionId: 'wcag-sc-1.1.1', sc: '1.1.1', title: 'Non-text Content', level: 'A', sourceCriterionLabel: '1.1.1 Non-text Content', sourceConformance: 'Supports', sourceRemarks: 'Evidence' }]
  }, config, {
    systemPrompts: {
      conformance: 'Versioned conformance system prompt fixture.',
      quality: 'Versioned quality system prompt fixture.'
    }
  });
  assert.equal(request.headers['x-portkey-provider'], 'google');
  assert.equal(request.body.messages[0].content, 'Versioned conformance system prompt fixture.');
  assert.equal(request.body.response_format.type, 'json_schema');
  assert.equal(request.body.response_format.json_schema.strict, true);
  assert.equal(request.body.response_format.json_schema.schema.type, 'object');
  assert.throws(
    () => buildPortkeyRequest('conformance', {
      requestId: 'req-provider-2', promptVersion: '1.0.0', contractVersions: versions,
      expectedCriteria: [{ criterionId: 'wcag-sc-1.1.1', sc: '1.1.1', title: 'Non-text Content', level: 'A', sourceCriterionLabel: '1.1.1 Non-text Content', sourceConformance: 'Supports', sourceRemarks: 'Evidence' }]
    }, config),
    (error) => error.code === 'PROVIDER_NOT_CONFIGURED'
  );
});

test('provider failures and malformed bodies are safe operational errors', () => {
  assert.throws(() => parsePortkeyResponse(429, '{}'), (error) => error.code === 'PROVIDER_ERROR' && error.retryable);
  assert.throws(() => parsePortkeyResponse(200, '{nope'), (error) => error.code === 'PROVIDER_RESPONSE_INVALID');
  assert.deepEqual(parsePortkeyResponse(200, JSON.stringify({ choices: [{ message: { content: '{"findings":[]}' } }] })), { findings: [] });
});
