import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { acquireVerifiedSourceBytes } from '../../../src/app/client/browser-ingestion.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function makeTransport(bytes, options = {}) {
  const requestId = 'request-transport';
  const chunkBytes = 16 * 1024;
  const chunkCount = Math.ceil(bytes.byteLength / chunkBytes);
  return {
    requestId,
    rpc: async (command, payload) => {
      if (command === 'beginSourceBytes') {
        return {
          schemaVersion: '1.0.0',
          requestId,
          metadata: {
            id: payload.fileId,
            sourceType: 'pdf',
            mimeType: 'application/pdf',
          },
          sha256: options.wholeDigest || digest(bytes),
          byteLength: bytes.byteLength,
          chunkBytes,
          chunkCount,
        };
      }
      if (command === 'readSourceByteBatch') {
        const chunks = [];
        const end = Math.min(payload.startChunkIndex + payload.requestedCount, chunkCount);
        for (let index = payload.startChunkIndex; index < end; index += 1) {
          const start = index * chunkBytes;
          const chunk = bytes.slice(start, Math.min(start + chunkBytes, bytes.byteLength));
          chunks.push({
            chunkIndex: index,
            byteLength: chunk.byteLength,
            base64: Buffer.from(chunk).toString('base64'),
            sha256: options.badChunkIndex === index ? '0'.repeat(64) : digest(chunk),
          });
        }
        return {
          schemaVersion: '1.0.0',
          requestId,
          chunkCount,
          startChunkIndex: payload.startChunkIndex,
          chunks,
        };
      }
      throw new Error(`Unexpected command ${command}`);
    },
  };
}

test('source acquisition reassembles 16 KiB batches and verifies every SHA-256 binding', async () => {
  const bytes = new Uint8Array(18 * 16 * 1024 + 7).map((_, index) => index % 251);
  const transport = makeTransport(bytes);
  const acquired = await acquireVerifiedSourceBytes({
    requestId: transport.requestId,
    fileId: 'file-transport',
    rpc: transport.rpc,
  });
  assert.deepEqual(acquired.bytes, bytes);
  assert.equal(acquired.descriptor.chunkCount, 19);
});

test('source acquisition rejects a corrupted chunk before parser execution', async () => {
  const bytes = new Uint8Array(20_000).fill(7);
  const transport = makeTransport(bytes, { badChunkIndex: 1 });
  await assert.rejects(
    acquireVerifiedSourceBytes({ requestId: transport.requestId, fileId: 'file-transport', rpc: transport.rpc }),
    error => error.code === 'SOURCE_MALFORMED' && /chunk failed SHA-256/.test(error.message),
  );
});

test('source acquisition rejects a whole-file digest mismatch after verified chunks', async () => {
  const bytes = new Uint8Array(20_000).fill(11);
  const transport = makeTransport(bytes, { wholeDigest: 'f'.repeat(64) });
  await assert.rejects(
    acquireVerifiedSourceBytes({ requestId: transport.requestId, fileId: 'file-transport', rpc: transport.rpc }),
    error => error.code === 'SOURCE_MALFORMED' && /reassembled source/.test(error.message),
  );
});
