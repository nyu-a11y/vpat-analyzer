function doGet() {
  vpatRequireNyuUser_();
  var template = HtmlService.createTemplateFromFile('Index');
  template.bootstrapJson = JSON.stringify({
    schemaVersion: '1.0.0',
    serverVersion: VPAT_SERVER_VERSION_,
    allowedSourceTypes: ['google-doc', 'docx', 'pdf'],
    maxSourceBytes: VPAT_MAX_SOURCE_BYTES_
  }).replace(/</g, '\\u003c');
  return template.evaluate()
    .setTitle('NYU VPAT Analyzer')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function rpcCommand(requestJson) {
  try {
    vpatRequireNyuUser_();
    var envelope = vpatParseJson_(requestJson);
    var result = vpatDispatchRpc_(envelope);
    return vpatSerializeJson_({ schemaVersion: '1.0.0', ok: true, data: result });
  } catch (error) {
    return vpatSerializeJson_(vpatSafeRpcError_(error));
  }
}

function vpatDispatchRpc_(envelope) {
  vpatRequireClosedObject_(envelope, ['schemaVersion', 'command', 'payload'], 'INVALID_REQUEST');
  vpatRequire_(envelope.schemaVersion === '1.0.0', 'INVALID_REQUEST');
  vpatRequire_(typeof envelope.command === 'string', 'INVALID_REQUEST');
  var payload = envelope.payload;
  vpatRequire_(payload && typeof payload === 'object' && !Array.isArray(payload), 'INVALID_REQUEST');
  var payloadProperties = {
    listSources: ['query', 'pageSize', 'pageToken'],
    inspectSource: ['requestId', 'fileId'],
    beginSourceBytes: ['requestId', 'fileId'],
    readSourceByteBatch: ['requestId', 'startChunkIndex', 'requestedCount'],
    serializeGoogleDoc: ['requestId', 'fileId'],
    beginAnalysis: ['requestId', 'fileId'],
    advanceAnalysis: ['requestId', 'cursor', 'clientResult'],
    retryExport: ['requestId', 'analysisId'],
    resume: ['requestId'],
    resumeActive: []
  };
  vpatRequire_(Object.prototype.hasOwnProperty.call(payloadProperties, envelope.command), 'INVALID_REQUEST');
  vpatRequireOnlyProperties_(payload, payloadProperties[envelope.command], 'INVALID_REQUEST');
  switch (envelope.command) {
    case 'listSources':
      return vpatListEligibleDriveSources_(payload);
    case 'inspectSource':
      return vpatCreateRequestForSource_(payload.fileId, payload.requestId);
    case 'beginSourceBytes':
      return vpatBeginSourceBytes_(payload.requestId, payload.fileId);
    case 'readSourceByteBatch':
      return vpatReadSourceByteBatch_(payload.requestId, payload.startChunkIndex, payload.requestedCount);
    case 'serializeGoogleDoc':
      return vpatSerializeGoogleDoc_(payload.requestId, payload.fileId);
    case 'beginAnalysis':
      return vpatBeginAnalysis_(payload.requestId);
    case 'advanceAnalysis':
      return vpatAdvanceAnalysis_(payload);
    case 'retryExport':
      return vpatRetryExport_(payload.requestId);
    case 'resume':
      return vpatResumeRequest_(payload.requestId);
    case 'resumeActive':
      return vpatResumeActiveRequest_();
    default:
      vpatThrow_('INVALID_REQUEST');
  }
}
