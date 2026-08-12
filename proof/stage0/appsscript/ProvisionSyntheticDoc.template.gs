const STAGE0_GOOGLE_DOC_MODEL_ = /*__GOOGLE_DOC_MODEL__*/;
const STAGE0_GOOGLE_DOC_CANDIDATE_SHA256_ = /*__GOOGLE_DOC_CANDIDATE_SHA256__*/;
const STAGE0_GOOGLE_DOC_OVERFLOW_CHARACTERS_ = 10001;

/**
 * Creates exactly one private synthetic Google Doc for the authorized live
 * Stage 0 proof. This function is not called by the web app and must be run
 * manually only after the owner authorizes Google mutations.
 */
function provisionStage0SyntheticGoogleDoc_() {
  var properties = PropertiesService.getScriptProperties();
  var existingId = properties.getProperty('STAGE0_GOOGLE_DOC_ID');
  if (existingId) {
    try {
      stage0VerifySyntheticGoogleDoc_(existingId);
      return { schemaVersion: '1.0.0', created: false, alreadyConfigured: true };
    } catch (error) {
      throw new Error('The existing synthetic Google Doc binding is not accessible; resolve it before provisioning.');
    }
  }

  var document = DocumentApp.create('Northstar VPAT 2.5 · Stage 0 synthetic proof');
  var body = document.getBody();
  body.appendParagraph('Northstar Collaboration Suite').setHeading(DocumentApp.ParagraphHeading.TITLE);
  body.appendParagraph('Accessibility Conformance Report · VPAT 2.5');
  STAGE0_GOOGLE_DOC_MODEL_.bodyProse.forEach(function (paragraph) { body.appendParagraph(paragraph); });

  STAGE0_GOOGLE_DOC_MODEL_.candidateTables.forEach(function (tableModel) {
    body.appendParagraph(stage0SyntheticHeading_(tableModel.tableId)).setHeading(DocumentApp.ParagraphHeading.HEADING2);
    stage0AppendModelTable_(body, tableModel.headers, tableModel.rows);
    if (tableModel.tableId === 'table-wcag-22-a-aa') {
      body.appendParagraph('WCAG 2.2 duplicate-row test').setHeading(DocumentApp.ParagraphHeading.HEADING2);
      stage0AppendModelTable_(body, tableModel.headers, [{
        sourceRowIndex: 1,
        cells: [tableModel.rows[0].cells[0], 'Supports', 'Synthetic duplicate evidence retained for duplicate detection.']
      }]);
    }
  });

  body.appendParagraph('Decorative merged layout table').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  var merged = body.appendTable([
    ['Synthetic merged layout cell', '', ''],
    ['Left', 'Middle', 'Right']
  ]);
  // DocumentApp.merge() combines a cell with its preceding sibling. One merge
  // is enough to prove variable-width/merged serialization behavior.
  merged.getRow(0).getCell(1).merge();

  document.saveAndClose();
  stage0VerifySyntheticGoogleDoc_(document.getId());
  properties.setProperty('STAGE0_GOOGLE_DOC_ID', document.getId());
  return { schemaVersion: '1.0.0', created: true, alreadyConfigured: false };
}

function stage0VerifySyntheticGoogleDoc_(documentId) {
  var document = DocumentApp.openById(documentId);
  var file = DriveApp.getFileById(documentId);
  stage0RequirePrivateSyntheticFile_(file);
  if (
    document.getName() !== 'Northstar VPAT 2.5 · Stage 0 synthetic proof' ||
    file.getMimeType() !== 'application/vnd.google-apps.document'
  ) {
    throw new Error('The synthetic Google Doc binding has unexpected metadata.');
  }
  var candidateDocument = stage0SerializeGoogleDocumentById_(documentId);
  var serialized = JSON.stringify(stage0CanonicalJsonValue_(candidateDocument));
  var digest = stage0HexDigest_(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    serialized,
    Utilities.Charset.UTF_8
  ));
  if (digest !== STAGE0_GOOGLE_DOC_CANDIDATE_SHA256_) {
    throw new Error('The synthetic Google Doc differs from its build-bound candidate model.');
  }
}

/**
 * Creates a second private synthetic Google Doc whose single prose paragraph
 * exceeds the serializer's 10,000-character per-item limit by exactly one
 * normalized character. It is never passed to the parser: the live proof must
 * receive the schema-valid RESOURCE_LIMIT_EXCEEDED serializer rejection.
 */
function provisionStage0SyntheticGoogleDocOverflow_() {
  var properties = PropertiesService.getScriptProperties();
  var propertyKey = 'STAGE0_GOOGLE_DOC_OVERFLOW_ID';
  var existingId = properties.getProperty(propertyKey);
  if (existingId) {
    try {
      stage0VerifySyntheticGoogleDocOverflow_(DocumentApp.openById(existingId));
      return { schemaVersion: '1.0.0', created: false, alreadyConfigured: true };
    } catch (error) {
      throw new Error('The existing synthetic Google Doc overflow binding is invalid or inaccessible; resolve it before provisioning.');
    }
  }

  var document = DocumentApp.create('Northstar VPAT 2.5 · Stage 0 Google Doc overflow proof');
  var body = document.getBody();
  body.clear();
  body.appendParagraph('Stage 0 deterministic Google Doc overflow').setHeading(DocumentApp.ParagraphHeading.TITLE);
  body.appendParagraph(new Array(STAGE0_GOOGLE_DOC_OVERFLOW_CHARACTERS_ + 1).join('X'));
  document.saveAndClose();
  stage0VerifySyntheticGoogleDocOverflow_(DocumentApp.openById(document.getId()));
  properties.setProperty(propertyKey, document.getId());
  return { schemaVersion: '1.0.0', created: true, alreadyConfigured: false };
}

function stage0VerifySyntheticGoogleDocOverflow_(document) {
  var file = DriveApp.getFileById(document.getId());
  stage0RequirePrivateSyntheticFile_(file);
  if (
    document.getName() !== 'Northstar VPAT 2.5 · Stage 0 Google Doc overflow proof' ||
    file.getMimeType() !== 'application/vnd.google-apps.document'
  ) {
    throw new Error('The synthetic Google Doc overflow binding has unexpected metadata.');
  }
  var body = document.getBody();
  var childCount = body.getNumChildren();
  if (childCount < 2 || childCount > 3) {
    throw new Error('The synthetic Google Doc overflow fixture has an unexpected structure.');
  }
  for (var index = 0; index < childCount - 2; index += 1) {
    var leading = body.getChild(index);
    if (leading.getType() !== DocumentApp.ElementType.PARAGRAPH || leading.asParagraph().getText() !== '') {
      throw new Error('The synthetic Google Doc overflow fixture has unexpected leading content.');
    }
  }
  var title = body.getChild(childCount - 2);
  var overflow = body.getChild(childCount - 1);
  if (
    title.getType() !== DocumentApp.ElementType.PARAGRAPH ||
    title.asParagraph().getText() !== 'Stage 0 deterministic Google Doc overflow' ||
    overflow.getType() !== DocumentApp.ElementType.PARAGRAPH ||
    overflow.asParagraph().getText() !== new Array(STAGE0_GOOGLE_DOC_OVERFLOW_CHARACTERS_ + 1).join('X')
  ) {
    throw new Error('The synthetic Google Doc overflow fixture differs from its deterministic model.');
  }
}

function stage0AppendModelTable_(body, headers, rows) {
  var matrix = [headers].concat(rows.map(function (row) { return row.cells; }));
  body.appendTable(matrix);
}

function stage0SyntheticHeading_(tableId) {
  var headings = {
    'table-metadata': 'Product and report details',
    'table-wcag-22-a-aa': 'WCAG 2.2 Level A and AA',
    'table-section-508': 'Revised Section 508',
    'table-en-301-549': 'EN 301 549',
    'table-arbitrary-number': 'Internal release checklist',
    'table-literal-safety': 'Literal source-text safety'
  };
  return headings[tableId] || 'Synthetic non-WCAG table';
}
