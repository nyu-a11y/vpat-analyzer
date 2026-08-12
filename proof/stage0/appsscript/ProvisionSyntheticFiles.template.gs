const STAGE0_BINARY_FIXTURE_PAYLOADS_ = /*__FIXTURE_PAYLOADS__*/;
const STAGE0_INACCESSIBLE_SENTINEL_TEXT_ = /*__INACCESSIBLE_SENTINEL_TEXT__*/;

/**
 * Creates only missing private synthetic fixture files and binds their IDs in
 * Script Properties. Run manually only after the owner authorizes Google
 * mutations. Existing bindings are verified and are never silently replaced.
 */
function provisionStage0SyntheticBinaryFixtures_() {
  var properties = PropertiesService.getScriptProperties();
  var created = 0;
  var verified = 0;
  STAGE0_BINARY_FIXTURE_PAYLOADS_.forEach(function (fixture) {
    var existingId = properties.getProperty(fixture.propertyKey);
    if (existingId) {
      stage0VerifyFixtureFile_(DriveApp.getFileById(existingId), fixture);
      verified += 1;
      return;
    }
    var bytes = Utilities.base64Decode(fixture.base64);
    var digest = stage0HexDigest_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes));
    if (bytes.length !== fixture.expectedBytes || digest !== fixture.expectedSha256) {
      throw new Error('A packaged synthetic fixture does not match its committed binding.');
    }
    var blob = Utilities.newBlob(bytes, fixture.mimeType, fixture.filename);
    var file = DriveApp.createFile(blob);
    stage0VerifyFixtureFile_(file, fixture);
    properties.setProperty(fixture.propertyKey, file.getId());
    created += 1;
  });
  return {
    schemaVersion: '1.0.0',
    syntheticOnly: true,
    created: created,
    verified: verified,
    total: STAGE0_BINARY_FIXTURE_PAYLOADS_.length,
    containsFileIds: false
  };
}

function stage0VerifyFixtureFile_(file, fixture) {
  stage0RequirePrivateSyntheticFile_(file);
  if (file.getMimeType() !== fixture.mimeType) {
    throw new Error('A bound synthetic fixture has the wrong MIME type.');
  }
  var bytes = file.getBlob().getBytes();
  var digest = stage0HexDigest_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes));
  if (bytes.length !== fixture.expectedBytes || digest !== fixture.expectedSha256) {
    throw new Error('A bound synthetic fixture differs from the committed fixture.');
  }
}

/**
 * Run only as the authorized secondary NYU test account. The created file is
 * private to that account while the Script Property is shared by the project,
 * so the USER_ACCESSING web app must reject it for the primary proof account.
 */
function provisionStage0InaccessibleSentinelAsSecondaryAccount_() {
  var properties = PropertiesService.getScriptProperties();
  var propertyKey = 'STAGE0_INACCESSIBLE_FILE_ID';
  var existingId = properties.getProperty(propertyKey);
  if (existingId) {
    var existing = DriveApp.getFileById(existingId);
    stage0VerifyInaccessibleSentinel_(existing);
    stage0RecordInaccessibleAttestation_(properties);
    return {
      schemaVersion: '1.0.0',
      syntheticOnly: true,
      created: false,
      verified: true,
      containsFileIds: false
    };
  }
  var file = DriveApp.createFile(
    Utilities.newBlob(
      STAGE0_INACCESSIBLE_SENTINEL_TEXT_,
      'text/plain',
      'Stage 0 inaccessible synthetic sentinel.txt'
    )
  );
  stage0VerifyInaccessibleSentinel_(file);
  properties.setProperty(propertyKey, file.getId());
  stage0RecordInaccessibleAttestation_(properties);
  return {
    schemaVersion: '1.0.0',
    syntheticOnly: true,
    created: true,
    verified: true,
    containsFileIds: false
  };
}

function stage0RecordInaccessibleAttestation_(properties) {
  var definition = stage0CaseDefinition_('inaccessible-source');
  var bytes = Utilities.newBlob(STAGE0_INACCESSIBLE_SENTINEL_TEXT_).getBytes();
  var digest = stage0HexDigest_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes));
  if (bytes.length !== definition.expectedBytes || digest !== definition.expectedSha256) {
    throw new Error('The inaccessible synthetic sentinel model differs from its build binding.');
  }
  properties.setProperties({
    STAGE0_INACCESSIBLE_SENTINEL_BUILD_ID: STAGE0_HARNESS_CONFIG_.build.id,
    STAGE0_INACCESSIBLE_SENTINEL_SHA256: digest,
    STAGE0_INACCESSIBLE_SENTINEL_BYTES: String(bytes.length),
    STAGE0_INACCESSIBLE_SENTINEL_VERIFIED_AT: String(Date.now())
  }, false);
}

function stage0VerifyInaccessibleSentinel_(file) {
  stage0RequirePrivateSyntheticFile_(file);
  if (file.getMimeType() !== 'text/plain') {
    throw new Error('The inaccessible synthetic sentinel has the wrong MIME type.');
  }
  if (file.getBlob().getDataAsString('UTF-8') !== STAGE0_INACCESSIBLE_SENTINEL_TEXT_) {
    throw new Error('The inaccessible synthetic sentinel has unexpected content.');
  }
}
