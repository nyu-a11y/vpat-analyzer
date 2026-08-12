import {
  SERVER_LIMITS,
  SOURCE_MIME_TYPES,
  ServerContractError,
  requireRequestId
} from './server-contracts.mjs';

export function escapeDriveQueryLiteral(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function sourceTypeForMime(mimeType) {
  const sourceType = SOURCE_MIME_TYPES[mimeType];
  if (!sourceType) throw new ServerContractError('SOURCE_UNSUPPORTED');
  return sourceType;
}

export function buildEligibleDriveQuery(searchText = '') {
  const mimeClause = Object.keys(SOURCE_MIME_TYPES)
    .map((mime) => `mimeType = '${escapeDriveQueryLiteral(mime)}'`)
    .join(' or ');
  const trimmed = String(searchText).replace(/\s+/g, ' ').trim().slice(0, 120);
  const nameClause = trimmed ? ` and name contains '${escapeDriveQueryLiteral(trimmed)}'` : '';
  return `trashed = false and (${mimeClause})${nameClause}`;
}

export function validateSourceMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') throw new ServerContractError('SOURCE_INACCESSIBLE');
  const id = String(metadata.id || '');
  const name = String(metadata.name || '').trim();
  if (!/^[A-Za-z0-9_-]{8,200}$/.test(id) || !name || name.length > 512 || metadata.trashed === true) {
    throw new ServerContractError('SOURCE_INACCESSIBLE');
  }
  const sourceType = sourceTypeForMime(metadata.mimeType);
  const size = sourceType === 'google-doc' ? null : Number(metadata.size);
  if (sourceType !== 'google-doc' && (!Number.isInteger(size) || size <= 0)) {
    throw new ServerContractError('SOURCE_INACCESSIBLE');
  }
  if (size !== null && size > SERVER_LIMITS.maxSourceBytes) {
    throw new ServerContractError('SOURCE_TOO_LARGE');
  }
  return Object.freeze({
    id,
    name,
    mimeType: metadata.mimeType,
    sourceType,
    size,
    updatedAt: typeof metadata.updatedAt === 'string' ? metadata.updatedAt : null
  });
}

export function describeByteSource({ requestId, metadata, byteLength, sha256 }) {
  requireRequestId(requestId);
  const source = validateSourceMetadata(metadata);
  if (source.sourceType === 'google-doc') throw new ServerContractError('SOURCE_UNSUPPORTED');
  if (!Number.isInteger(byteLength) || byteLength !== source.size || byteLength > SERVER_LIMITS.maxSourceBytes) {
    throw new ServerContractError('SOURCE_CHANGED');
  }
  if (!/^[a-f0-9]{64}$/.test(String(sha256))) throw new ServerContractError('INTERNAL_ERROR');
  return {
    schemaVersion: '1.0.0',
    requestId,
    source,
    byteLength,
    sha256,
    chunkBytes: SERVER_LIMITS.sourceChunkBytes,
    chunkCount: Math.ceil(byteLength / SERVER_LIMITS.sourceChunkBytes)
  };
}

export function chunkByteBatch(bytes, startChunkIndex, requestedCount, digestChunk, encodeBase64) {
  const input = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes || []);
  if (input.byteLength <= 0 || input.byteLength > SERVER_LIMITS.maxSourceBytes) {
    throw new ServerContractError('SOURCE_TOO_LARGE');
  }
  const chunkCount = Math.ceil(input.byteLength / SERVER_LIMITS.sourceChunkBytes);
  if (!Number.isInteger(startChunkIndex) || startChunkIndex < 0 || startChunkIndex >= chunkCount) {
    throw new ServerContractError('INVALID_REQUEST');
  }
  if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > SERVER_LIMITS.maxChunkBatch) {
    throw new ServerContractError('INVALID_REQUEST');
  }
  const chunks = [];
  const end = Math.min(startChunkIndex + requestedCount, chunkCount);
  for (let index = startChunkIndex; index < end; index += 1) {
    const start = index * SERVER_LIMITS.sourceChunkBytes;
    const chunk = input.slice(start, Math.min(start + SERVER_LIMITS.sourceChunkBytes, input.byteLength));
    chunks.push({
      chunkIndex: index,
      byteLength: chunk.byteLength,
      base64: encodeBase64(chunk),
      sha256: digestChunk(chunk)
    });
  }
  return { chunkCount, startChunkIndex, chunks };
}
