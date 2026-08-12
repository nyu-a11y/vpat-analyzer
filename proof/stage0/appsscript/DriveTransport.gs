function beginFixture(caseKey) {
  var definition = stage0CaseDefinition_(caseKey);
  if (definition.accessProof) stage0VerifyInaccessibleAttestation_(definition);
  var fileId = PropertiesService.getScriptProperties().getProperty(definition.propertyKey);
  if (!fileId) throw new Error('Synthetic fixture binding is not configured.');
  var file;
  try {
    file = DriveApp.getFileById(fileId);
  } catch (error) {
    if (definition.accessProof) return stage0InaccessibleResult_(definition.caseKey);
    throw new Error('A required synthetic fixture is not accessible to the executing user.');
  }
  if (definition.accessProof) throw new Error('The inaccessible-source sentinel is unexpectedly accessible.');
  stage0RequirePrivateSyntheticFile_(file);
  if (file.getMimeType() !== definition.mimeType) throw new Error('A bound synthetic fixture has the wrong MIME type.');
  var blob = file.getBlob();
  var bytes = blob.getBytes();
  if (bytes.length <= 0 || bytes.length > STAGE0_MAX_SOURCE_BYTES) throw new Error('Synthetic fixture exceeds the transport byte limit.');
  var digest = stage0HexDigest_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes));
  if (bytes.length !== definition.expectedBytes || digest !== definition.expectedSha256) {
    throw new Error('A bound synthetic fixture differs from the committed fixture.');
  }
  var chunkCount = Math.ceil(bytes.length / STAGE0_CHUNK_BYTES);
  if (chunkCount > STAGE0_MAX_CHUNKS || chunkCount !== definition.expectedChunkCount) throw new Error('Synthetic fixture chunk binding is inconsistent.');
  return {
    schemaVersion: '1.0.0',
    status: 'complete',
    caseKey: definition.caseKey,
    sourceType: definition.sourceType,
    mimeType: definition.mimeType,
    byteLength: bytes.length,
    chunkBytes: STAGE0_CHUNK_BYTES,
    chunkCount: chunkCount,
    sha256: digest,
    buildId: STAGE0_HARNESS_CONFIG_.build.id
  };
}

function stage0VerifyInaccessibleAttestation_(definition) {
  var properties = PropertiesService.getScriptProperties();
  var verifiedAt = Number(properties.getProperty('STAGE0_INACCESSIBLE_SENTINEL_VERIFIED_AT'));
  var ageMs = Date.now() - verifiedAt;
  if (
    properties.getProperty('STAGE0_INACCESSIBLE_SENTINEL_BUILD_ID') !== STAGE0_HARNESS_CONFIG_.build.id ||
    properties.getProperty('STAGE0_INACCESSIBLE_SENTINEL_SHA256') !== definition.expectedSha256 ||
    properties.getProperty('STAGE0_INACCESSIBLE_SENTINEL_BYTES') !== String(definition.expectedBytes) ||
    !Number.isFinite(verifiedAt) ||
    verifiedAt <= 0 ||
    ageMs < 0 ||
    ageMs > STAGE0_INACCESSIBLE_ATTESTATION_MAX_AGE_MS
  ) {
    throw new Error('The inaccessible synthetic sentinel lacks a current build-bound secondary-account attestation.');
  }
}

function verifyStage0ExecutionIdentityBoundary() {
  var definitions = getStage0CaseDefinitions_();
  for (var index = 0; index < definitions.length; index += 1) {
    var definition = definitions[index];
    if (definition.accessProof) continue;
    var fileId = PropertiesService.getScriptProperties().getProperty(definition.propertyKey);
    if (!fileId) throw new Error('Synthetic fixture binding is not configured.');
    var file = DriveApp.getFileById(fileId);
    stage0RequirePrivateSyntheticFile_(file);
    if (file.getMimeType() !== definition.mimeType) throw new Error('A bound synthetic fixture has the wrong MIME type.');
  }
  stage0ProbeGoogleDocAccess_();
  var inaccessible = definitions.filter(function (item) { return item.accessProof; })[0];
  if (!inaccessible) throw new Error('The inaccessible-source case is not configured.');
  stage0VerifyInaccessibleAttestation_(inaccessible);
  var inaccessibleId = PropertiesService.getScriptProperties().getProperty(inaccessible.propertyKey);
  if (!inaccessibleId) throw new Error('Synthetic inaccessible fixture binding is not configured.');
  try {
    DriveApp.getFileById(inaccessibleId);
  } catch (error) {
    return {
      schemaVersion: '1.0.0',
      expectedAccessibleCount: definitions.filter(function (item) { return !item.accessProof; }).length + 2,
      accessibleCount: definitions.filter(function (item) { return !item.accessProof; }).length + 2,
      inaccessibleCount: 1,
      boundarySatisfied: true
    };
  }
  throw new Error('The current execution identity can access the inaccessible synthetic sentinel.');
}

function stage0InaccessibleResult_(caseKey) {
  return {
    schemaVersion: '1.0.0',
    requestId: 'live-' + caseKey,
    parserVersion: '1.0.0',
    catalogVersion: '1.0.0',
    sourceType: 'unknown',
    status: 'rejected',
    rejection: {
      code: 'SOURCE_INACCESSIBLE',
      stage: 'access',
      safeMessage: 'The allowlisted synthetic source is not accessible to the executing user.'
    }
  };
}

function readFixtureChunkBatch(caseKey, startChunkIndex, requestedCount) {
  var definition = stage0CaseDefinition_(caseKey);
  if (definition.accessProof) throw new Error('The inaccessible-source sentinel has no readable chunks.');
  if (!Number.isInteger(startChunkIndex) || startChunkIndex < 0) throw new Error('Invalid synthetic fixture chunk index.');
  if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > STAGE0_CHUNK_BATCH_SIZE) throw new Error('Invalid synthetic fixture chunk batch size.');
  var fileId = PropertiesService.getScriptProperties().getProperty(definition.propertyKey);
  if (!fileId) throw new Error('Synthetic fixture binding is not configured.');
  var file = DriveApp.getFileById(fileId);
  stage0RequirePrivateSyntheticFile_(file);
  if (file.getMimeType() !== definition.mimeType) throw new Error('A bound synthetic fixture has the wrong MIME type.');
  var bytes = file.getBlob().getBytes();
  if (bytes.length <= 0 || bytes.length > STAGE0_MAX_SOURCE_BYTES) throw new Error('Synthetic fixture exceeds the transport byte limit.');
  var digest = stage0HexDigest_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes));
  if (bytes.length !== definition.expectedBytes || digest !== definition.expectedSha256) {
    throw new Error('A bound synthetic fixture differs from the committed fixture.');
  }
  var chunkCount = Math.ceil(bytes.length / STAGE0_CHUNK_BYTES);
  if (chunkCount > STAGE0_MAX_CHUNKS || chunkCount !== definition.expectedChunkCount || startChunkIndex >= chunkCount) throw new Error('Synthetic fixture chunk index is outside the allowed range.');
  var endChunkIndex = Math.min(startChunkIndex + requestedCount, chunkCount);
  var chunks = [];
  for (var chunkIndex = startChunkIndex; chunkIndex < endChunkIndex; chunkIndex += 1) {
    var start = chunkIndex * STAGE0_CHUNK_BYTES;
    var chunk = bytes.slice(start, Math.min(start + STAGE0_CHUNK_BYTES, bytes.length));
    chunks.push({
      chunkIndex: chunkIndex,
      byteLength: chunk.length,
      base64: Utilities.base64Encode(chunk),
      sha256: stage0HexDigest_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, chunk))
    });
  }
  return {
    schemaVersion: '1.0.0',
    caseKey: definition.caseKey,
    chunkCount: chunkCount,
    startChunkIndex: startChunkIndex,
    chunks: chunks
  };
}

function stage0RequirePrivateSyntheticFile_(file) {
  if (
    file.getSharingAccess() !== DriveApp.Access.PRIVATE ||
    file.getEditors().length !== 0 ||
    file.getViewers().length !== 0
  ) {
    throw new Error('A synthetic Stage 0 fixture is not private to its provisioning account.');
  }
}
