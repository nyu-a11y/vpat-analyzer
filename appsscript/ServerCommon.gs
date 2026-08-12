var VPAT_SERVER_VERSION_ = '1.0.0';
var VPAT_MAX_RPC_REQUEST_BYTES_ = 1024 * 1024;
var VPAT_MAX_RPC_RESPONSE_BYTES_ = 1024 * 1024;
var VPAT_MAX_PROVIDER_RESPONSE_BYTES_ = 96 * 1024;
var VPAT_MAX_SOURCE_BYTES_ = 25 * 1024 * 1024;
var VPAT_SOURCE_CHUNK_BYTES_ = 16 * 1024;
var VPAT_MAX_CHUNK_BATCH_ = 16;
var VPAT_MAX_SEARCH_RESULTS_ = 50;

var VPAT_SAFE_ERRORS_ = Object.freeze({
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

function vpatServerError_(code, retryable) {
  var safeCode = Object.prototype.hasOwnProperty.call(VPAT_SAFE_ERRORS_, code) ? code : 'INTERNAL_ERROR';
  var error = new Error(VPAT_SAFE_ERRORS_[safeCode]);
  error.vpatCode = safeCode;
  error.vpatRetryable = Boolean(retryable);
  return error;
}

function vpatThrow_(code, retryable) {
  throw vpatServerError_(code, retryable);
}

function vpatRequire_(condition, code, retryable) {
  if (!condition) vpatThrow_(code, retryable);
}

function vpatRequireClosedObject_(value, allowedProperties, code, retryable) {
  vpatRequire_(value && typeof value === 'object' && !Array.isArray(value), code, retryable);
  var allowed = {};
  allowedProperties.forEach(function (property) { allowed[property] = true; });
  var keys = Object.keys(value);
  vpatRequire_(keys.length === allowedProperties.length, code, retryable);
  keys.forEach(function (key) { vpatRequire_(allowed[key] === true, code, retryable); });
  allowedProperties.forEach(function (property) {
    vpatRequire_(Object.prototype.hasOwnProperty.call(value, property), code, retryable);
  });
  return value;
}

function vpatRequireOnlyProperties_(value, allowedProperties, code) {
  vpatRequire_(value && typeof value === 'object' && !Array.isArray(value), code);
  var allowed = {};
  allowedProperties.forEach(function (property) { allowed[property] = true; });
  Object.keys(value).forEach(function (key) { vpatRequire_(allowed[key] === true, code); });
  return value;
}

function vpatUtf8Length_(value) {
  return Utilities.newBlob(String(value), 'text/plain').getBytes().length;
}

function vpatParseJson_(serialized) {
  vpatRequire_(typeof serialized === 'string', 'INVALID_REQUEST');
  vpatRequire_(vpatUtf8Length_(serialized) <= VPAT_MAX_RPC_REQUEST_BYTES_, 'REQUEST_TOO_LARGE');
  var parsed;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    vpatThrow_('INVALID_REQUEST');
  }
  vpatRequire_(parsed && typeof parsed === 'object' && !Array.isArray(parsed), 'INVALID_REQUEST');
  vpatAssertJsonValue_(parsed, 0, { nodes: 0 });
  return parsed;
}

function vpatAssertJsonValue_(value, depth, budget) {
  budget.nodes += 1;
  vpatRequire_(depth <= 40 && budget.nodes <= 100000, 'INVALID_REQUEST');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    vpatRequire_(Number.isFinite(value), 'INVALID_REQUEST');
    return;
  }
  vpatRequire_(value && typeof value === 'object', 'INVALID_REQUEST');
  if (Array.isArray(value)) {
    value.forEach(function (item) { vpatAssertJsonValue_(item, depth + 1, budget); });
    return;
  }
  Object.keys(value).forEach(function (key) {
    vpatRequire_(['__proto__', 'prototype', 'constructor'].indexOf(key) < 0, 'INVALID_REQUEST');
    vpatAssertJsonValue_(value[key], depth + 1, budget);
  });
}

function vpatSerializeJson_(value) {
  var serialized;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    vpatThrow_('INTERNAL_ERROR');
  }
  vpatRequire_(vpatUtf8Length_(serialized) <= VPAT_MAX_RPC_RESPONSE_BYTES_, 'RESPONSE_TOO_LARGE');
  return serialized;
}

function vpatSafeRpcError_(error) {
  var code = error && Object.prototype.hasOwnProperty.call(VPAT_SAFE_ERRORS_, error.vpatCode)
    ? error.vpatCode
    : 'INTERNAL_ERROR';
  return {
    schemaVersion: '1.0.0',
    ok: false,
    error: {
      code: code,
      safeMessage: VPAT_SAFE_ERRORS_[code],
      retryable: Boolean(error && error.vpatRetryable && code !== 'INTERNAL_ERROR')
    }
  };
}

function vpatRequireRequestId_(value) {
  vpatRequire_(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value), 'INVALID_REQUEST');
  return value;
}

function vpatRequireNyuUser_() {
  var email = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  vpatRequire_(/@nyu\.edu$/.test(email), 'NYU_ACCESS_REQUIRED');
  return email;
}

function vpatHexDigest_(bytes) {
  return bytes.map(function (value) {
    var unsigned = value < 0 ? value + 256 : value;
    return ('0' + unsigned.toString(16)).slice(-2);
  }).join('');
}

function vpatSha256Bytes_(bytes) {
  return vpatHexDigest_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes));
}

function vpatSha256Text_(value) {
  return vpatHexDigest_(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value),
    Utilities.Charset.UTF_8
  ));
}

function vpatCanonicalJsonValue_(value) {
  if (Array.isArray(value)) return value.map(vpatCanonicalJsonValue_);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce(function (output, key) {
    output[key] = vpatCanonicalJsonValue_(value[key]);
    return output;
  }, {});
}

function vpatEscapeDriveQuery_(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function vpatIsoDate_(value) {
  var date = value instanceof Date ? value : new Date(value);
  vpatRequire_(!isNaN(date.getTime()), 'INTERNAL_ERROR');
  return date.toISOString();
}
