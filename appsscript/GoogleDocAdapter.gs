var VPAT_GOOGLE_DOC_LIMITS_ = Object.freeze({
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
  maxTotalCharacters: 750000
});

function vpatSerializeGoogleDoc_(requestId, fileId) {
  requestId = vpatRequireRequestId_(requestId);
  var metadataBefore = vpatReadSourceMetadata_(fileId);
  vpatRequire_(metadataBefore.sourceType === 'google-doc', 'SOURCE_UNSUPPORTED');
  vpatRequireSelectedSource_(requestId, metadataBefore);
  var body;
  try {
    body = DocumentApp.openById(metadataBefore.id).getBody();
  } catch (error) {
    vpatThrow_('SOURCE_INACCESSIBLE');
  }
  var serialized = vpatSerializeGoogleDocBody_(body);
  var metadataAfter = vpatReadSourceMetadata_(fileId);
  vpatRequire_(metadataAfter.updatedAt === metadataBefore.updatedAt, 'SOURCE_CHANGED');
  var binding = {
    schemaVersion: '1.0.0',
    requestId: requestId,
    metadata: metadataAfter,
    sha256: vpatSha256Text_(JSON.stringify(vpatCanonicalJsonValue_(serialized))),
    byteLength: null,
    chunkBytes: null,
    chunkCount: null
  };
  vpatStoreSourceBinding_(binding);
  return {
    schemaVersion: '1.0.0',
    requestId: requestId,
    source: metadataAfter,
    sourceSha256: binding.sha256,
    document: serialized
  };
}

function vpatSerializeGoogleDocBody_(body) {
  var bodyProse = [];
  var tables = [];
  var headingAncestry = [];
  var nearestProse = '';
  var state = {
    limits: VPAT_GOOGLE_DOC_LIMITS_,
    bodyProseItems: 0,
    tableCount: 0,
    rowCount: 0,
    cellCount: 0,
    totalCharacters: 0
  };
  for (var index = 0; index < body.getNumChildren(); index += 1) {
    var element = body.getChild(index);
    var type = element.getType();
    if (type === DocumentApp.ElementType.PARAGRAPH || type === DocumentApp.ElementType.LIST_ITEM) {
      var paragraph = type === DocumentApp.ElementType.PARAGRAPH ? element.asParagraph() : element.asListItem();
      var paragraphText = vpatBoundDocText_(paragraph.getText(), state.limits.maxBodyProseCharacters, state);
      if (paragraphText) {
        state.bodyProseItems += 1;
        vpatDocLimit_(state.bodyProseItems <= state.limits.maxBodyProseItems);
        bodyProse.push(paragraphText);
        if (type === DocumentApp.ElementType.PARAGRAPH) {
          var headingLevel = vpatGoogleHeadingLevel_(paragraph.getHeading());
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
    vpatDocLimit_(state.tableCount <= state.limits.maxTables);
    var table = element.asTable();
    if (table.getNumRows() === 0) continue;
    var rows = [];
    var headers = vpatSerializeGoogleDocRow_(table.getRow(0), state, true);
    for (var rowIndex = 1; rowIndex < table.getNumRows(); rowIndex += 1) {
      state.rowCount += 1;
      vpatDocLimit_(state.rowCount <= state.limits.maxRows);
      rows.push({
        sourceRowIndex: rowIndex,
        cells: vpatSerializeGoogleDocRow_(table.getRow(rowIndex), state, false)
      });
    }
    tables.push({
      tableId: 'google-doc-table-' + (tables.length + 1),
      sourceOrder: tables.length,
      context: vpatGoogleDocTableContext_(headingAncestry, nearestProse, state),
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

function vpatSerializeGoogleDocRow_(row, state, isHeader) {
  vpatDocLimit_(row.getNumCells() <= state.limits.maxCellsPerRow);
  var cells = [];
  for (var cellIndex = 0; cellIndex < row.getNumCells(); cellIndex += 1) {
    var cell = row.getCell(cellIndex);
    vpatDocLimit_(!vpatGoogleDocCellHasNestedTable_(cell));
    state.cellCount += 1;
    vpatDocLimit_(state.cellCount <= state.limits.maxCells);
    var limit = isHeader
      ? state.limits.maxHeaderCharacters
      : cellIndex === 0
        ? state.limits.maxCriterionLabelCharacters
        : cellIndex === 1
          ? state.limits.maxConformanceCharacters
          : state.limits.maxCellCharacters;
    cells.push(vpatBoundDocText_(cell.getText(), limit, state));
  }
  return cells;
}

function vpatGoogleDocCellHasNestedTable_(cell) {
  for (var index = 0; index < cell.getNumChildren(); index += 1) {
    if (cell.getChild(index).getType() === DocumentApp.ElementType.TABLE) return true;
  }
  return false;
}

function vpatGoogleHeadingLevel_(heading) {
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

function vpatGoogleDocTableContext_(headingAncestry, nearestProse, state) {
  var values = headingAncestry.filter(function (value) { return Boolean(value); });
  if (nearestProse && values.indexOf(nearestProse) < 0) values.push(nearestProse);
  return vpatBoundDocText_(values.join(' > '), state.limits.maxContextCharacters, state);
}

function vpatBoundDocText_(value, limit, state) {
  var normalized = String(value || '').replace(/\s+/g, ' ').trim();
  vpatDocLimit_(normalized.length <= limit);
  state.totalCharacters += normalized.length;
  vpatDocLimit_(state.totalCharacters <= state.limits.maxTotalCharacters);
  return normalized;
}

function vpatDocLimit_(condition) {
  if (!condition) vpatThrow_('RESOURCE_LIMIT_EXCEEDED');
}
