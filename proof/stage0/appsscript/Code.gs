const STAGE0_CHUNK_BYTES = 16 * 1024;
const STAGE0_CHUNK_BATCH_SIZE = 16;
const STAGE0_MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const STAGE0_MAX_CHUNKS = 1600;
const STAGE0_INACCESSIBLE_ATTESTATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('NYU VPAT Analyzer · Stage 0 synthetic ingestion proof');
}

function getHarnessManifest() {
  return {
    schemaVersion: '1.0.0',
    syntheticOnly: true,
    build: STAGE0_HARNESS_CONFIG_.build,
    fixtureCases: getStage0CaseDefinitions_().map(function (item) {
      return {
        caseKey: item.caseKey,
        sourceType: item.sourceType,
        mimeType: item.mimeType,
        expectedStatus: item.expectedStatus,
        expectedCode: item.expectedCode || null,
        expectedBytes: item.expectedBytes,
        expectedSha256: item.expectedSha256,
        expectedChunkCount: item.expectedChunkCount,
        expectedProjectionSha256: item.expectedProjectionSha256,
        maxObservedDurationMs: item.maxObservedDurationMs,
        parserLimits: item.parserLimits || {},
        accessProof: Boolean(item.accessProof)
      };
    }),
    googleDocCase: STAGE0_HARNESS_CONFIG_.googleDocCase,
    googleDocOverflowCase: STAGE0_HARNESS_CONFIG_.googleDocOverflowCase,
    transport: STAGE0_HARNESS_CONFIG_.transport,
    memory: STAGE0_HARNESS_CONFIG_.memory
  };
}

function echoIngestionResult(result) {
  var clone = stage0CanonicalJsonValue_(result);
  var serialized = JSON.stringify(clone);
  var utf8Bytes = Utilities.newBlob(serialized).getBytes();
  if (utf8Bytes.length > STAGE0_HARNESS_CONFIG_.transport.maxJsonBytes) throw new Error('JSON round-trip payload exceeds the harness limit.');
  return {
    schemaVersion: '1.0.0',
    result: clone,
    utf8Bytes: utf8Bytes.length,
    sha256: stage0HexDigest_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, serialized, Utilities.Charset.UTF_8))
  };
}

function stage0CanonicalJsonValue_(value) {
  if (Array.isArray(value)) return value.map(stage0CanonicalJsonValue_);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce(function (output, key) {
    output[key] = stage0CanonicalJsonValue_(value[key]);
    return output;
  }, {});
}

function getStage0CaseDefinitions_() {
  return STAGE0_HARNESS_CONFIG_.fixtureCases;
}

function stage0CaseDefinition_(caseKey) {
  var matches = getStage0CaseDefinitions_().filter(function (item) { return item.caseKey === caseKey; });
  if (matches.length !== 1) throw new Error('Unknown synthetic fixture case.');
  return matches[0];
}

function stage0HexDigest_(bytes) {
  return bytes.map(function (value) {
    var unsigned = value < 0 ? value + 256 : value;
    return ('0' + unsigned.toString(16)).slice(-2);
  }).join('');
}
