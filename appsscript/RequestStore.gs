var VPAT_PROPERTY_CHUNK_CHARS_ = 7000;
var VPAT_MAX_PROPERTY_CHUNKS_ = 32;
var VPAT_MAX_STORED_JSON_BYTES_ = 200 * 1024;
var VPAT_MAX_USER_PROPERTY_BUDGET_BYTES_ = 450 * 1024;

function vpatRecordKey_(requestId) {
  return vpatSha256Text_(vpatRequireRequestId_(requestId)).slice(0, 32);
}

function vpatRecordPrefix_(kind, requestId, generation) {
  vpatRequire_(/^[a-z][a-z0-9-]{0,30}$/.test(kind), 'INTERNAL_ERROR');
  return 'vpat:' + kind + ':' + vpatRecordKey_(requestId) + (generation ? ':' + generation : '');
}

function vpatPutUserRecord_(kind, requestId, value) {
  vpatRequireRequestId_(requestId);
  var serialized = JSON.stringify(vpatCanonicalJsonValue_(value));
  var byteLength = vpatUtf8Length_(serialized);
  vpatRequire_(byteLength <= VPAT_MAX_STORED_JSON_BYTES_, 'RESOURCE_LIMIT_EXCEEDED');
  var compressed = Utilities.gzip(Utilities.newBlob(serialized, 'application/json'));
  var compressedBytes = compressed.getBytes();
  var base64 = Utilities.base64Encode(compressedBytes);
  var chunks = [];
  for (var offset = 0; offset < base64.length; offset += VPAT_PROPERTY_CHUNK_CHARS_) {
    chunks.push(base64.slice(offset, offset + VPAT_PROPERTY_CHUNK_CHARS_));
  }
  vpatRequire_(chunks.length > 0 && chunks.length <= VPAT_MAX_PROPERTY_CHUNKS_, 'RESOURCE_LIMIT_EXCEEDED');
  var properties = PropertiesService.getUserProperties();
  var headKey = vpatRecordPrefix_(kind, requestId, null) + ':head';
  var oldGeneration = properties.getProperty(headKey);
  var generation = vpatSha256Text_(Utilities.getUuid() + ':' + Date.now()).slice(0, 20);
  var prefix = vpatRecordPrefix_(kind, requestId, generation);
  var manifest = {
    schemaVersion: '1.0.0',
    kind: kind,
    requestId: requestId,
    generation: generation,
    byteLength: byteLength,
    compressedBytes: compressedBytes.length,
    chunkCount: chunks.length,
    encoding: 'gzip-json-v1',
    sha256: vpatSha256Text_(serialized)
  };
  var entries = {};
  chunks.forEach(function (chunk, index) { entries[prefix + ':c:' + index] = chunk; });
  entries[prefix + ':manifest'] = JSON.stringify(manifest);
  entries[headKey] = generation;
  var currentProperties = properties.getProperties();
  var currentBytes = Object.keys(currentProperties).reduce(function (total, key) {
    return total + vpatUtf8Length_(key) + vpatUtf8Length_(currentProperties[key]);
  }, 0);
  var nextBytes = Object.keys(entries).reduce(function (total, key) {
    return total + vpatUtf8Length_(key) + vpatUtf8Length_(entries[key]);
  }, 0);
  vpatRequire_(
    currentBytes + nextBytes <= VPAT_MAX_USER_PROPERTY_BUDGET_BYTES_,
    'RESOURCE_LIMIT_EXCEEDED'
  );
  properties.setProperties(entries, false);
  if (oldGeneration && oldGeneration !== generation) {
    vpatDeleteRecordGeneration_(properties, kind, requestId, oldGeneration);
  }
  return manifest;
}

function vpatGetUserRecord_(kind, requestId) {
  vpatRequireRequestId_(requestId);
  var properties = PropertiesService.getUserProperties();
  var headKey = vpatRecordPrefix_(kind, requestId, null) + ':head';
  var generation = properties.getProperty(headKey);
  if (!generation) return null;
  var prefix = vpatRecordPrefix_(kind, requestId, generation);
  var manifestText = properties.getProperty(prefix + ':manifest');
  vpatRequire_(Boolean(manifestText), 'REQUEST_NOT_FOUND');
  var manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch (error) {
    vpatThrow_('REQUEST_NOT_FOUND');
  }
  vpatRequire_(
    manifest.schemaVersion === '1.0.0' && manifest.kind === kind && manifest.requestId === requestId &&
    manifest.generation === generation && Number.isInteger(manifest.chunkCount) &&
    manifest.chunkCount > 0 && manifest.chunkCount <= VPAT_MAX_PROPERTY_CHUNKS_,
    'REQUEST_NOT_FOUND'
  );
  var chunks = [];
  for (var index = 0; index < manifest.chunkCount; index += 1) {
    var chunk = properties.getProperty(prefix + ':c:' + index);
    vpatRequire_(typeof chunk === 'string', 'REQUEST_NOT_FOUND');
    chunks.push(chunk);
  }
  var serialized;
  try {
    vpatRequire_(manifest.encoding === 'gzip-json-v1', 'REQUEST_NOT_FOUND');
    var compressedBytes = Utilities.base64Decode(chunks.join(''));
    vpatRequire_(compressedBytes.length === manifest.compressedBytes, 'REQUEST_NOT_FOUND');
    serialized = Utilities.ungzip(Utilities.newBlob(compressedBytes, 'application/gzip')).getDataAsString('UTF-8');
  } catch (error) {
    vpatThrow_('REQUEST_NOT_FOUND');
  }
  vpatRequire_(
    vpatUtf8Length_(serialized) === manifest.byteLength && vpatSha256Text_(serialized) === manifest.sha256,
    'REQUEST_NOT_FOUND'
  );
  var value;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    vpatThrow_('REQUEST_NOT_FOUND');
  }
  return { manifest: manifest, value: value };
}

function vpatDeleteRecordGeneration_(properties, kind, requestId, generation) {
  var prefix = vpatRecordPrefix_(kind, requestId, generation);
  var manifestText = properties.getProperty(prefix + ':manifest');
  if (!manifestText) return;
  var manifest;
  try { manifest = JSON.parse(manifestText); } catch (error) { manifest = null; }
  if (manifest && Number.isInteger(manifest.chunkCount)) {
    for (var index = 0; index < Math.min(manifest.chunkCount, VPAT_MAX_PROPERTY_CHUNKS_); index += 1) {
      properties.deleteProperty(prefix + ':c:' + index);
    }
  }
  properties.deleteProperty(prefix + ':manifest');
}

function vpatWithUserLock_(callback) {
  var lock = LockService.getUserLock();
  if (!lock.tryLock(15000)) vpatThrow_('INTERNAL_ERROR', true);
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function vpatResumeRequest_(requestId) {
  vpatRequireRequestId_(requestId);
  vpatRequireActiveRequest_(requestId);
  var requestRecord = vpatGetUserRecord_('request', requestId);
  vpatRequire_(Boolean(requestRecord), 'REQUEST_NOT_FOUND');
  var request = requestRecord.value;
  var receipt = vpatGetUserRecord_('receipt', requestId);
  if (receipt) {
    var completedAnalysis = vpatGetUserRecord_('analysis', requestId);
    return {
      requestId: requestId,
      status: 'complete',
      result: completedAnalysis
        ? vpatClientCompletedResult_(completedAnalysis.value.analysisOutput, receipt.value)
        : { receipt: receipt.value }
    };
  }
  if (request.status === 'pending') return vpatPendingResponseForRecord_(request);
  if (request.status === 'retryable-error' || request.status === 'error') return request.lastResponse;
  if (request.status === 'export-error') return vpatTerminalResponseForRecord_(request);
  var analysis = vpatGetUserRecord_('analysis', requestId);
  var claim = vpatGetUserRecord_('export-claim', requestId);
  if (analysis && claim) {
    return {
      requestId: requestId,
      status: 'export-error',
      result: vpatClientCompletedResult_(analysis.value.analysisOutput, null),
      detail: VPAT_SAFE_ERRORS_.EXPORT_COMPLETION_AMBIGUOUS
    };
  }
  if (analysis) {
    return {
      requestId: requestId,
      status: 'export-error',
      result: vpatClientCompletedResult_(analysis.value.analysisOutput, null),
      detail: VPAT_SAFE_ERRORS_.EXPORT_FAILED
    };
  }
  if (request.status === 'selected') {
    return { requestId: requestId, status: 'selected', source: vpatClientSourceDescriptor_(request.source) };
  }
  return request.lastResponse || { requestId: requestId, status: 'ready' };
}

function vpatResumeActiveRequest_() {
  var activeRequestId = PropertiesService.getUserProperties().getProperty('vpat:active-request-id');
  if (!activeRequestId) return { status: 'ready' };
  var response = vpatResumeRequest_(activeRequestId);
  if (response.status === 'ready' || response.source) return response;
  var requestRecord = vpatGetUserRecord_('request', activeRequestId);
  if (!requestRecord || !requestRecord.value.source) return response;
  return Object.assign({}, response, {
    source: vpatClientSourceDescriptor_(requestRecord.value.source)
  });
}
