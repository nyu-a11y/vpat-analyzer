import { SERVER_LIMITS, ServerContractError, requireRequestId, utf8ByteLength } from './server-contracts.mjs';

export function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonicalJson(value[key]);
    return result;
  }, {});
}

export function recordKeyForRequest(requestId, digestText) {
  requireRequestId(requestId);
  return digestText(requestId).slice(0, 32);
}

export function encodePropertyRecord(kind, requestId, value, { digestText, generation, encodeBase64 }) {
  if (!/^[a-z][a-z0-9-]{0,30}$/.test(kind) || !/^[a-f0-9]{12,64}$/.test(generation)) {
    throw new ServerContractError('INVALID_REQUEST');
  }
  requireRequestId(requestId);
  const serialized = JSON.stringify(canonicalJson(value));
  const byteLength = utf8ByteLength(serialized);
  if (byteLength > SERVER_LIMITS.maxStoredJsonBytes) throw new ServerContractError('RESOURCE_LIMIT_EXCEEDED');
  const base64 = encodeBase64(serialized);
  const chunks = [];
  for (let offset = 0; offset < base64.length; offset += SERVER_LIMITS.propertyChunkChars) {
    chunks.push(base64.slice(offset, offset + SERVER_LIMITS.propertyChunkChars));
  }
  if (chunks.length < 1 || chunks.length > SERVER_LIMITS.maxPropertyChunks) {
    throw new ServerContractError('RESOURCE_LIMIT_EXCEEDED');
  }
  return {
    manifest: {
      schemaVersion: '1.0.0',
      kind,
      requestId,
      generation,
      byteLength,
      chunkCount: chunks.length,
      sha256: digestText(serialized)
    },
    chunks
  };
}

export function decodePropertyRecord(manifest, chunks, digestText, decodeBase64) {
  if (!manifest || manifest.schemaVersion !== '1.0.0' || !Number.isInteger(manifest.chunkCount)) {
    throw new ServerContractError('REQUEST_NOT_FOUND');
  }
  if (manifest.chunkCount < 1 || manifest.chunkCount > SERVER_LIMITS.maxPropertyChunks || chunks.length !== manifest.chunkCount) {
    throw new ServerContractError('REQUEST_NOT_FOUND');
  }
  let serialized;
  try {
    serialized = decodeBase64(chunks.join(''));
  } catch {
    throw new ServerContractError('REQUEST_NOT_FOUND');
  }
  if (utf8ByteLength(serialized) !== manifest.byteLength || digestText(serialized) !== manifest.sha256) {
    throw new ServerContractError('REQUEST_NOT_FOUND');
  }
  try {
    return JSON.parse(serialized);
  } catch {
    throw new ServerContractError('REQUEST_NOT_FOUND');
  }
}

export class PropertyRecordStore {
  constructor(properties, { digestText, generation, encodeBase64, decodeBase64 }) {
    this.properties = properties;
    this.digestText = digestText;
    this.generation = generation;
    this.encodeBase64 = encodeBase64;
    this.decodeBase64 = decodeBase64;
  }

  put(kind, requestId, value) {
    const key = recordKeyForRequest(requestId, this.digestText);
    const generation = this.generation();
    const encoded = encodePropertyRecord(kind, requestId, value, {
      digestText: this.digestText,
      generation,
      encodeBase64: this.encodeBase64
    });
    const prefix = `vpat:${kind}:${key}:${generation}`;
    const entries = {};
    encoded.chunks.forEach((chunk, index) => { entries[`${prefix}:c:${index}`] = chunk; });
    entries[`${prefix}:manifest`] = JSON.stringify(encoded.manifest);
    this.properties.setMany(entries);
    this.properties.set(`vpat:${kind}:${key}:head`, generation);
    return encoded.manifest;
  }

  get(kind, requestId) {
    const key = recordKeyForRequest(requestId, this.digestText);
    const generation = this.properties.get(`vpat:${kind}:${key}:head`);
    if (!generation) return null;
    const prefix = `vpat:${kind}:${key}:${generation}`;
    const manifestText = this.properties.get(`${prefix}:manifest`);
    if (!manifestText) throw new ServerContractError('REQUEST_NOT_FOUND');
    let manifest;
    try { manifest = JSON.parse(manifestText); } catch { throw new ServerContractError('REQUEST_NOT_FOUND'); }
    if (manifest.requestId !== requestId || manifest.kind !== kind) throw new ServerContractError('REQUEST_NOT_FOUND');
    const chunks = Array.from({ length: manifest.chunkCount }, (_, index) => this.properties.get(`${prefix}:c:${index}`));
    if (chunks.some((chunk) => typeof chunk !== 'string')) throw new ServerContractError('REQUEST_NOT_FOUND');
    return { manifest, value: decodePropertyRecord(manifest, chunks, this.digestText, this.decodeBase64) };
  }
}
