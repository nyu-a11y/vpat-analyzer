export const SERVER_LIMITS = Object.freeze({
  maxRpcRequestBytes: 1024 * 1024,
  maxRpcResponseBytes: 1024 * 1024,
  maxSourceBytes: 25 * 1024 * 1024,
  sourceChunkBytes: 16 * 1024,
  maxChunkBatch: 16,
  maxSearchResults: 50,
  propertyChunkChars: 7000,
  maxPropertyChunks: 32,
  maxStoredJsonBytes: 200 * 1024,
  maxUserPropertyBudgetBytes: 450 * 1024,
  maxProviderRows: 87,
  maxProviderTextChars: 4000,
  maxProviderResponseBytes: 96 * 1024,
  maxProviderContextItems: 128,
  maxProviderContextChars: 20000
});

export const SOURCE_MIME_TYPES = Object.freeze({
  'application/vnd.google-apps.document': 'google-doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/pdf': 'pdf'
});

export const EXPORT_TAB_NAMES = Object.freeze([
  'Overview',
  'Line-item Review',
  'Quality Requirements',
  'Scoring',
  'Methodology & disclaimer'
]);

export const SAFE_ERROR_MESSAGES = Object.freeze({
  INVALID_REQUEST: 'The request could not be understood.',
  REQUEST_TOO_LARGE: 'The request exceeds a safe processing limit.',
  RESPONSE_TOO_LARGE: 'The response exceeds a safe processing limit.',
  NYU_ACCESS_REQUIRED: 'Sign in with an eligible NYU Google account.',
  SOURCE_INACCESSIBLE: 'The selected Drive file is not accessible.',
  SOURCE_UNSUPPORTED: 'Choose a Google Doc, DOCX, or searchable PDF.',
  SOURCE_TOO_LARGE: 'The selected file exceeds the 25 MB source limit.',
  SOURCE_CHANGED: 'The selected Drive file changed during acquisition. Select it again.',
  SOURCE_BINDING_CONFLICT: 'This analysis request is already bound to a different source.',
  RESOURCE_LIMIT_EXCEEDED: 'The document exceeds a deterministic processing limit.',
  PROVIDER_NOT_CONFIGURED: 'Analysis is not configured for this deployment.',
  PROVIDER_ERROR: 'The analysis provider could not complete the request.',
  PROVIDER_RESPONSE_INVALID: 'The analysis provider returned an invalid response.',
  REQUEST_NOT_FOUND: 'The analysis request is no longer available.',
  REQUEST_IN_PROGRESS: 'This analysis step is already in progress.',
  ANALYSIS_OUTPUT_INVALID: 'The completed analysis failed deterministic validation.',
  ANALYSIS_IMMUTABLE: 'The completed analysis output cannot be changed.',
  EXPORT_MODEL_INVALID: 'The completed analysis could not be prepared for export.',
  EXPORT_COMPLETION_AMBIGUOUS: 'The spreadsheet result is being reconciled. Try export again later.',
  EXPORT_FAILED: 'The spreadsheet could not be created.',
  INTERNAL_ERROR: 'The operation could not be completed.'
});

export class ServerContractError extends Error {
  constructor(code, options = {}) {
    super(SAFE_ERROR_MESSAGES[code] || SAFE_ERROR_MESSAGES.INTERNAL_ERROR);
    this.name = 'ServerContractError';
    this.code = Object.prototype.hasOwnProperty.call(SAFE_ERROR_MESSAGES, code) ? code : 'INTERNAL_ERROR';
    this.retryable = Boolean(options.retryable);
  }
}

export function requireRequestId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new ServerContractError('INVALID_REQUEST');
  }
  return value;
}

export function utf8ByteLength(value) {
  const text = String(value);
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length &&
      text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

export function assertPlainJson(value, path = '$') {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new ServerContractError('INVALID_REQUEST');
    return value;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPlainJson(item, `${path}[${index}]`));
    return value;
  }
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new ServerContractError('INVALID_REQUEST');
  }
  for (const [key, item] of Object.entries(value)) {
    if (
      typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key) ||
      item === undefined || typeof item === 'function' || typeof item === 'bigint'
    ) {
      throw new ServerContractError('INVALID_REQUEST');
    }
    assertPlainJson(item, `${path}.${key}`);
  }
  return value;
}

export function parseJsonBoundary(serialized, limit = SERVER_LIMITS.maxRpcRequestBytes) {
  if (typeof serialized !== 'string' || utf8ByteLength(serialized) > limit) {
    throw new ServerContractError(typeof serialized === 'string' ? 'REQUEST_TOO_LARGE' : 'INVALID_REQUEST');
  }
  let value;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new ServerContractError('INVALID_REQUEST');
  }
  assertPlainJson(value);
  return value;
}

export function serializeJsonBoundary(value, limit = SERVER_LIMITS.maxRpcResponseBytes) {
  assertPlainJson(value);
  const serialized = JSON.stringify(value);
  if (utf8ByteLength(serialized) > limit) throw new ServerContractError('RESPONSE_TOO_LARGE');
  return serialized;
}

export function safeErrorEnvelope(error) {
  const known = error instanceof ServerContractError;
  const code = known ? error.code : 'INTERNAL_ERROR';
  return {
    ok: false,
    error: {
      code,
      safeMessage: SAFE_ERROR_MESSAGES[code],
      retryable: known && error.retryable
    }
  };
}
