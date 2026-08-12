function serializeGoogleDocCase() {
  return stage0SerializeBoundGoogleDocCase_(
    'STAGE0_GOOGLE_DOC_ID',
    'live-google-doc-primary'
  );
}

function serializeGoogleDocOverflowCase() {
  return stage0SerializeBoundGoogleDocCase_(
    'STAGE0_GOOGLE_DOC_OVERFLOW_ID',
    'live-google-doc-overflow'
  );
}

function stage0SerializeBoundGoogleDocCase_(propertyKey, requestId) {
  try {
    return stage0SerializeGoogleDocCase_(propertyKey);
  } catch (error) {
    if (error && error.stage0ResourceLimit) {
      return {
        schemaVersion: '1.0.0',
        requestId: requestId,
        parserVersion: '1.0.0',
        catalogVersion: '1.0.0',
        sourceType: 'google-doc',
        status: 'rejected',
        rejection: {
          code: 'RESOURCE_LIMIT_EXCEEDED',
          stage: 'resource-limit',
          safeMessage: 'The Google Doc exceeds a deterministic ingestion resource limit.'
        }
      };
    }
    throw error;
  }
}

function stage0SerializeGoogleDocCase_(propertyKey) {
  var documentId = PropertiesService.getScriptProperties().getProperty(propertyKey);
  if (!documentId) throw new Error('Synthetic Google Doc binding is not configured.');
  return stage0SerializeGoogleDocumentById_(documentId);
}

function stage0SerializeGoogleDocumentById_(documentId) {
  stage0RequirePrivateSyntheticFile_(DriveApp.getFileById(documentId));
  var body = DocumentApp.openById(documentId).getBody();
  var bodyProse = [];
  var tables = [];
  var headingAncestry = [];
  var nearestProse = '';
  var limits = {
    maxBodyProseItems: 2048,
    maxTables: 128,
    maxRows: 5000,
    maxCells: 20000,
    maxCellsPerRow: 32,
    maxBodyProseCharacters: 10000,
    maxContextCharacters: 2000,
    maxHeaderCharacters: 500,
    maxCriterionLabelCharacters: 1000,
    maxConformanceCharacters: 2000,
    maxCellCharacters: 10000,
    maxTotalCharacters: 2000000
  };
  var state = { limits: limits, bodyProseItems: 0, tableCount: 0, rowCount: 0, cellCount: 0, totalCharacters: 0 };
  for (var index = 0; index < body.getNumChildren(); index += 1) {
    var element = body.getChild(index);
    var type = element.getType();
    if (type === DocumentApp.ElementType.PARAGRAPH || type === DocumentApp.ElementType.LIST_ITEM) {
      var paragraph = type === DocumentApp.ElementType.PARAGRAPH
        ? element.asParagraph()
        : element.asListItem();
      var paragraphText = stage0BoundText_(paragraph.getText(), limits.maxBodyProseCharacters, state);
      if (paragraphText) {
        state.bodyProseItems += 1;
        stage0RequireLimit_(state.bodyProseItems <= limits.maxBodyProseItems);
        bodyProse.push(paragraphText);
        if (type === DocumentApp.ElementType.PARAGRAPH) {
          var headingLevel = stage0HeadingLevel_(paragraph.getHeading());
          if (headingLevel !== null) {
            headingAncestry = headingAncestry.slice(0, headingLevel);
            headingAncestry[headingLevel - 1] = paragraphText;
            nearestProse = '';
          } else {
            nearestProse = paragraphText;
          }
        } else {
          nearestProse = paragraphText;
        }
      }
      continue;
    }
    if (type !== DocumentApp.ElementType.TABLE) continue;
    state.tableCount += 1;
    stage0RequireLimit_(state.tableCount <= limits.maxTables);
    var table = element.asTable();
    if (table.getNumRows() === 0) continue;
    var rows = [];
    var headers = stage0SerializeDocRow_(table.getRow(0), state, true);
    for (var rowIndex = 1; rowIndex < table.getNumRows(); rowIndex += 1) {
      state.rowCount += 1;
      stage0RequireLimit_(state.rowCount <= limits.maxRows);
      rows.push({ sourceRowIndex: rowIndex, cells: stage0SerializeDocRow_(table.getRow(rowIndex), state, false) });
    }
    tables.push({
      tableId: 'google-doc-table-' + (tables.length + 1),
      sourceOrder: tables.length,
      context: stage0TableContext_(headingAncestry, nearestProse, state),
      headers: headers,
      rows: rows
    });
  }
  return {
    bodyProse: bodyProse,
    tables: tables,
    metadata: {
      adapter: 'document-app',
      parserVersion: '1.0.0',
      tableCount: tables.length,
      bodyProseCount: bodyProse.length
    }
  };
}

function stage0ProbeGoogleDocAccess_() {
  var properties = PropertiesService.getScriptProperties();
  var propertyKeys = ['STAGE0_GOOGLE_DOC_ID', 'STAGE0_GOOGLE_DOC_OVERFLOW_ID'];
  for (var index = 0; index < propertyKeys.length; index += 1) {
    var documentId = properties.getProperty(propertyKeys[index]);
    if (!documentId) throw new Error('Synthetic Google Doc binding is not configured.');
    stage0RequirePrivateSyntheticFile_(DriveApp.getFileById(documentId));
    DocumentApp.openById(documentId).getBody();
  }
}

function stage0HeadingLevel_(heading) {
  var levels = {};
  levels[DocumentApp.ParagraphHeading.TITLE] = 1;
  levels[DocumentApp.ParagraphHeading.HEADING1] = 2;
  levels[DocumentApp.ParagraphHeading.HEADING2] = 3;
  levels[DocumentApp.ParagraphHeading.HEADING3] = 4;
  levels[DocumentApp.ParagraphHeading.HEADING4] = 5;
  levels[DocumentApp.ParagraphHeading.HEADING5] = 6;
  levels[DocumentApp.ParagraphHeading.HEADING6] = 7;
  return Object.prototype.hasOwnProperty.call(levels, heading) ? levels[heading] : null;
}

function stage0TableContext_(headingAncestry, nearestProse, state) {
  var values = headingAncestry.filter(function (value) { return Boolean(value); });
  if (nearestProse && values.indexOf(nearestProse) < 0) values.push(nearestProse);
  return stage0BoundText_(values.join(' > '), state.limits.maxContextCharacters, state);
}

function stage0BoundText_(value, limit, state) {
  var normalized = String(value || '').replace(/\s+/g, ' ').trim();
  stage0RequireLimit_(normalized.length <= limit);
  state.totalCharacters += normalized.length;
  stage0RequireLimit_(state.totalCharacters <= state.limits.maxTotalCharacters);
  return normalized;
}

function stage0SerializeDocRow_(row, state, isHeader) {
  var cells = [];
  stage0RequireLimit_(row.getNumCells() <= state.limits.maxCellsPerRow);
  for (var cellIndex = 0; cellIndex < row.getNumCells(); cellIndex += 1) {
    state.cellCount += 1;
    stage0RequireLimit_(state.cellCount <= state.limits.maxCells);
    var cellLimit = isHeader
      ? state.limits.maxHeaderCharacters
      : cellIndex === 0
        ? state.limits.maxCriterionLabelCharacters
        : cellIndex === 1
          ? state.limits.maxConformanceCharacters
          : state.limits.maxCellCharacters;
    cells.push(stage0BoundText_(row.getCell(cellIndex).getText(), cellLimit, state));
  }
  return cells;
}

function stage0RequireLimit_(condition) {
  if (condition) return;
  var error = new Error('The Google Doc exceeds a deterministic ingestion resource limit.');
  error.stage0ResourceLimit = true;
  throw error;
}
