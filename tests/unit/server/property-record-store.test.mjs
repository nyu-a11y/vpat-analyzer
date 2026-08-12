import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PropertyRecordStore } from '../../../src/app/server/property-record-store.mjs';

const digestText = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const codec = {
  encodeBase64: (value) => Buffer.from(value, 'utf8').toString('base64'),
  decodeBase64: (value) => Buffer.from(value, 'base64').toString('utf8')
};

class FakeProperties {
  values = new Map();
  get(key) { return this.values.get(key) ?? null; }
  set(key, value) { this.values.set(key, value); }
  setMany(entries) { for (const [key, value] of Object.entries(entries)) this.set(key, value); }
}

test('chunked property records round-trip Unicode JSON with an integrity manifest', () => {
  const properties = new FakeProperties();
  const store = new PropertyRecordStore(properties, {
    digestText, generation: () => 'abcdef1234567890', ...codec
  });
  const value = { requestId: 'req-store-1', evidence: '=literal 😀'.repeat(1000) };
  const manifest = store.put('analysis', 'req-store-1', value);
  assert.ok(manifest.chunkCount > 1);
  assert.deepEqual(store.get('analysis', 'req-store-1').value, value);
});

test('record corruption fails closed instead of returning partial analysis', () => {
  const properties = new FakeProperties();
  const store = new PropertyRecordStore(properties, {
    digestText, generation: () => 'abcdef1234567890', ...codec
  });
  store.put('analysis', 'req-store-2', { stable: true });
  const chunkKey = [...properties.values.keys()].find((key) => key.endsWith(':c:0'));
  properties.set(chunkKey, 'corrupted');
  assert.throws(() => store.get('analysis', 'req-store-2'), (error) => error.code === 'REQUEST_NOT_FOUND');
});
