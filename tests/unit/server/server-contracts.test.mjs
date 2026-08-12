import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SERVER_LIMITS,
  ServerContractError,
  parseJsonBoundary,
  safeErrorEnvelope,
  serializeJsonBoundary,
  utf8ByteLength
} from '../../../src/app/server/server-contracts.mjs';

test('JSON RPC boundary accepts only bounded plain JSON and reports safe errors', () => {
  assert.deepEqual(parseJsonBoundary('{"a":[1,true,null]}'), { a: [1, true, null] });
  assert.equal(utf8ByteLength('A😀é'), 7);
  assert.throws(() => parseJsonBoundary('{oops'), (error) => error.code === 'INVALID_REQUEST');
  assert.throws(
    () => parseJsonBoundary('{"payload":{"__proto__":{"polluted":true}}}'),
    (error) => error.code === 'INVALID_REQUEST'
  );
  assert.throws(() => parseJsonBoundary(JSON.stringify({ a: 'x'.repeat(20) }), 10), (error) => error.code === 'REQUEST_TOO_LARGE');
  assert.throws(() => serializeJsonBoundary({ a: 'x'.repeat(20) }, 10), (error) => error.code === 'RESPONSE_TOO_LARGE');
  assert.deepEqual(safeErrorEnvelope(new Error('secret token=abc')), {
    ok: false,
    error: { code: 'INTERNAL_ERROR', safeMessage: 'The operation could not be completed.', retryable: false }
  });
  assert.equal(safeErrorEnvelope(new ServerContractError('PROVIDER_ERROR', { retryable: true })).error.retryable, true);
});

test('bounded final-analysis envelopes fit while oversized RPC input fails closed', () => {
  const measuredFinalPayload = JSON.stringify({ payload: 'x'.repeat(384_000) });
  assert.equal(parseJsonBoundary(measuredFinalPayload).payload.length, 384_000);
  const oversized = JSON.stringify({ payload: 'x'.repeat(SERVER_LIMITS.maxRpcRequestBytes) });
  assert.throws(() => parseJsonBoundary(oversized), (error) => error.code === 'REQUEST_TOO_LARGE');
});
