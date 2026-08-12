import {
  ingestBinarySource,
  ingestSerializedGoogleDoc,
} from '../../ingestion/browser/public-api.mjs';
import { validateIngestionResult } from '../../ingestion/core/index.mjs';

const CHUNK_BATCH_SIZE = 16;
const HEX_DIGEST_PATTERN = /^[a-f0-9]{64}$/;

function transportError(message) {
  const error = new Error(message);
  error.code = 'SOURCE_MALFORMED';
  error.safeMessage = 'The source could not be transferred safely from Google Drive.';
  error.retryable = true;
  return error;
}

function decodeBase64(value) {
  if (typeof value !== 'string') throw transportError('A source chunk was not encoded correctly.');
  let binary;
  try {
    binary = globalThis.atob(value);
  } catch {
    throw transportError('A source chunk was not valid base64.');
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function hex(bytes) {
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

async function sha256(bytes) {
  if (!globalThis.crypto?.subtle) throw transportError('SHA-256 verification is not available.');
  return hex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)));
}

function assertDescriptor(descriptor, requestId) {
  if (!descriptor || descriptor.schemaVersion !== '1.0.0' || descriptor.requestId !== requestId) {
    throw transportError('The source descriptor did not match the active request.');
  }
  if (!Number.isInteger(descriptor.byteLength) || descriptor.byteLength < 1 ||
      !Number.isInteger(descriptor.chunkBytes) || descriptor.chunkBytes !== 16 * 1024 ||
      !Number.isInteger(descriptor.chunkCount) || descriptor.chunkCount < 1 ||
      descriptor.chunkCount !== Math.ceil(descriptor.byteLength / descriptor.chunkBytes) ||
      !HEX_DIGEST_PATTERN.test(String(descriptor.sha256))) {
    throw transportError('The source descriptor was malformed.');
  }
  if (!['docx', 'pdf'].includes(descriptor.metadata?.sourceType) || typeof descriptor.metadata?.mimeType !== 'string') {
    throw transportError('The source descriptor had an unsupported type.');
  }
  return descriptor;
}

export async function acquireVerifiedSourceBytes({ requestId, fileId, rpc }) {
  const descriptor = assertDescriptor(await rpc('beginSourceBytes', { requestId, fileId }), requestId);
  const bytes = new Uint8Array(descriptor.byteLength);
  let offset = 0;
  for (let startChunkIndex = 0; startChunkIndex < descriptor.chunkCount; startChunkIndex += CHUNK_BATCH_SIZE) {
    const batch = await rpc('readSourceByteBatch', {
      requestId,
      startChunkIndex,
      requestedCount: CHUNK_BATCH_SIZE,
    });
    const expectedCount = Math.min(CHUNK_BATCH_SIZE, descriptor.chunkCount - startChunkIndex);
    if (!batch || batch.schemaVersion !== '1.0.0' || batch.requestId !== requestId ||
        batch.chunkCount !== descriptor.chunkCount || batch.startChunkIndex !== startChunkIndex ||
        !Array.isArray(batch.chunks) || batch.chunks.length !== expectedCount) {
      throw transportError('A source chunk batch did not match the descriptor.');
    }
    for (let batchIndex = 0; batchIndex < batch.chunks.length; batchIndex += 1) {
      const chunk = batch.chunks[batchIndex];
      const expectedIndex = startChunkIndex + batchIndex;
      const decoded = decodeBase64(chunk?.base64);
      const expectedLength = Math.min(descriptor.chunkBytes, descriptor.byteLength - offset);
      if (chunk?.chunkIndex !== expectedIndex || chunk?.byteLength !== expectedLength || decoded.byteLength !== expectedLength ||
          !HEX_DIGEST_PATTERN.test(String(chunk?.sha256)) || await sha256(decoded) !== chunk.sha256) {
        throw transportError('A source chunk failed SHA-256 verification.');
      }
      bytes.set(decoded, offset);
      offset += decoded.byteLength;
    }
  }
  if (offset !== descriptor.byteLength || await sha256(bytes) !== descriptor.sha256) {
    throw transportError('The reassembled source failed SHA-256 verification.');
  }
  return { descriptor, bytes };
}

export async function performBrowserIngestion({ requestId, source, rpc }) {
  if (!requestId || !source?.id || typeof rpc !== 'function') throw transportError('The ingestion request was incomplete.');
  let result;
  if (source.sourceType === 'google-doc' || source.type === 'GOOGLE DOC') {
    const serialized = await rpc('serializeGoogleDoc', { requestId, fileId: source.id });
    if (!serialized || serialized.schemaVersion !== '1.0.0' || serialized.requestId !== requestId || !serialized.document ||
        !HEX_DIGEST_PATTERN.test(String(serialized.sourceSha256 || serialized.sha256))) {
      throw transportError('The serialized Google Doc did not match the active request.');
    }
    result = ingestSerializedGoogleDoc({ requestId, candidateDocument: serialized.document });
    return {
      result: validateIngestionResult(result),
      sourceSha256: serialized.sourceSha256 || serialized.sha256,
    };
  } else {
    const { descriptor, bytes } = await acquireVerifiedSourceBytes({ requestId, fileId: source.id, rpc });
    result = await ingestBinarySource({
      requestId,
      bytes,
      mimeType: descriptor.metadata.mimeType,
    });
    return {
      result: validateIngestionResult(result),
      sourceSha256: descriptor.sha256,
    };
  }
}
