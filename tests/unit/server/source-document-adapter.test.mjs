import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  buildEligibleDriveQuery,
  chunkByteBatch,
  describeByteSource,
  escapeDriveQueryLiteral,
  validateSourceMetadata
} from '../../../src/app/server/source-document-adapter.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const base64 = (bytes) => Buffer.from(bytes).toString('base64');

test('Drive query accepts only eligible source MIME types and escapes search text', () => {
  assert.equal(escapeDriveQueryLiteral("O'Brien\\VPAT"), "O\\'Brien\\\\VPAT");
  const query = buildEligibleDriveQuery("O'Brien");
  assert.match(query, /application\/pdf/);
  assert.match(query, /application\/vnd\.google-apps\.document/);
  assert.match(query, /openxmlformats-officedocument\.wordprocessingml\.document/);
  assert.match(query, /name contains 'O\\'Brien'/);
  assert.match(query, /^trashed = false/);
});

test('source metadata validation is fail closed and enforces the 25 MiB limit', () => {
  const metadata = validateSourceMetadata({
    id: 'abcDEF_123456', name: 'Northstar VPAT.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    size: 1024, updatedAt: '2026-08-12T12:00:00.000Z'
  });
  assert.equal(metadata.sourceType, 'docx');
  assert.throws(() => validateSourceMetadata({ ...metadata, mimeType: 'text/plain' }), (error) => error.code === 'SOURCE_UNSUPPORTED');
  assert.throws(() => validateSourceMetadata({ ...metadata, size: 25 * 1024 * 1024 + 1 }), (error) => error.code === 'SOURCE_TOO_LARGE');
});

test('source byte acquisition uses bounded 16 KiB chunks and batches', () => {
  const bytes = Uint8Array.from({ length: 16 * 1024 * 2 + 7 }, (_, index) => index % 251);
  const batch = chunkByteBatch(bytes, 1, 16, digest, base64);
  assert.equal(batch.chunkCount, 3);
  assert.deepEqual(batch.chunks.map((chunk) => chunk.byteLength), [16 * 1024, 7]);
  assert.equal(batch.chunks[0].sha256, digest(bytes.slice(16 * 1024, 32 * 1024)));
  assert.throws(() => chunkByteBatch(bytes, 0, 17, digest, base64), (error) => error.code === 'INVALID_REQUEST');
});

test('byte descriptor binds request, metadata, digest, and chunk geometry', () => {
  const descriptor = describeByteSource({
    requestId: 'req-123',
    metadata: {
      id: 'abcDEF_123456', name: 'VPAT.pdf', mimeType: 'application/pdf', size: 20,
      updatedAt: '2026-08-12T12:00:00.000Z'
    },
    byteLength: 20,
    sha256: 'a'.repeat(64)
  });
  assert.equal(descriptor.source.sourceType, 'pdf');
  assert.equal(descriptor.chunkBytes, 16 * 1024);
  assert.equal(descriptor.chunkCount, 1);
});
