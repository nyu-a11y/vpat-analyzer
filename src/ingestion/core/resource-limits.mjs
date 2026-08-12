import limitsConfig from "../../../config/ingestion-limits.v1.json" with { type: "json" };
import { normalizeCellText } from "./normalization.mjs";
import { rejectMalformed, rejectResourceLimit } from "./rejections.mjs";

export const INGESTION_LIMITS = Object.freeze({ ...limitsConfig.candidateDocument });
export const PARSER_VERSION = limitsConfig.parserVersion;

function requireString(value) {
  if (typeof value !== "string") rejectMalformed();
  return value;
}

function addCharacters(state, value, individualLimit) {
  if (value.length > individualLimit) rejectResourceLimit();
  state.totalCharacters += value.length;
  if (state.totalCharacters > INGESTION_LIMITS.maxTotalCharacters) rejectResourceLimit();
}

function normalizeRow(rawRow, state) {
  if (!rawRow || typeof rawRow !== "object" || Array.isArray(rawRow)) rejectMalformed();
  if (!Number.isInteger(rawRow.sourceRowIndex) || rawRow.sourceRowIndex < 0) rejectMalformed();
  if (!Array.isArray(rawRow.cells)) rejectMalformed();
  if (rawRow.cells.length > INGESTION_LIMITS.maxCellsPerRow) rejectResourceLimit();

  const cells = rawRow.cells.map((cell, index) => {
    const normalized = normalizeCellText(requireString(cell));
    let fieldLimit = INGESTION_LIMITS.maxCellCharacters;
    if (index === 0) fieldLimit = INGESTION_LIMITS.maxCriterionLabelCharacters;
    if (index === 1) fieldLimit = INGESTION_LIMITS.maxConformanceCharacters;
    addCharacters(state, normalized, fieldLimit);
    return normalized;
  });

  state.totalCells += cells.length;
  if (state.totalCells > INGESTION_LIMITS.maxTotalCells) rejectResourceLimit();

  const remarks = cells.slice(2).join("\n");
  if (remarks.length > INGESTION_LIMITS.maxRemarksCharacters) rejectResourceLimit();
  return { sourceRowIndex: rawRow.sourceRowIndex, cells };
}

function normalizeTable(rawTable, state, inputIndex) {
  if (!rawTable || typeof rawTable !== "object" || Array.isArray(rawTable)) rejectMalformed();
  const tableId = normalizeCellText(requireString(rawTable.tableId));
  if (!tableId) rejectMalformed();
  addCharacters(state, tableId, INGESTION_LIMITS.maxTableIdCharacters);

  if (!Number.isInteger(rawTable.sourceOrder) || rawTable.sourceOrder < 0) rejectMalformed();
  const context = normalizeCellText(rawTable.context == null ? "" : requireString(rawTable.context));
  addCharacters(state, context, INGESTION_LIMITS.maxContextCharacters);

  if (!Array.isArray(rawTable.headers)) rejectMalformed();
  if (rawTable.headers.length > INGESTION_LIMITS.maxHeadersPerTable) rejectResourceLimit();
  const headers = rawTable.headers.map((header) => {
    const normalized = normalizeCellText(requireString(header));
    addCharacters(state, normalized, INGESTION_LIMITS.maxHeaderCharacters);
    return normalized;
  });

  if (!Array.isArray(rawTable.rows)) rejectMalformed();
  if (rawTable.rows.length > INGESTION_LIMITS.maxRowsPerTable) rejectResourceLimit();
  state.totalRows += rawTable.rows.length;
  if (state.totalRows > INGESTION_LIMITS.maxTotalRows) rejectResourceLimit();

  const rowIndexes = new Set();
  const rows = rawTable.rows.map((row, rowInputIndex) => {
    const normalized = normalizeRow(row, state);
    if (rowIndexes.has(normalized.sourceRowIndex)) rejectMalformed();
    rowIndexes.add(normalized.sourceRowIndex);
    return { ...normalized, inputIndex: rowInputIndex };
  });
  rows.sort((left, right) => left.sourceRowIndex - right.sourceRowIndex || left.inputIndex - right.inputIndex);

  return {
    tableId,
    sourceOrder: rawTable.sourceOrder,
    context,
    headers,
    rows,
    inputIndex,
  };
}

export function normalizeAndLimitCandidateDocument(candidateDocument) {
  if (!candidateDocument || typeof candidateDocument !== "object" || Array.isArray(candidateDocument)) {
    rejectMalformed();
  }
  if (!Array.isArray(candidateDocument.bodyProse) || !Array.isArray(candidateDocument.tables)) {
    rejectMalformed();
  }
  if (candidateDocument.bodyProse.length > INGESTION_LIMITS.maxBodyProseItems) {
    rejectResourceLimit();
  }
  if (candidateDocument.tables.length > INGESTION_LIMITS.maxTables) rejectResourceLimit();

  const state = { totalCharacters: 0, totalRows: 0, totalCells: 0 };
  const bodyProse = candidateDocument.bodyProse.map((paragraph) => {
    const normalized = normalizeCellText(requireString(paragraph));
    addCharacters(state, normalized, INGESTION_LIMITS.maxBodyProseCharacters);
    return normalized;
  });

  const tables = candidateDocument.tables.map((table, index) => normalizeTable(table, state, index));
  const tableIds = new Set();
  const sourceOrders = new Set();
  for (const table of tables) {
    if (tableIds.has(table.tableId) || sourceOrders.has(table.sourceOrder)) rejectMalformed();
    tableIds.add(table.tableId);
    sourceOrders.add(table.sourceOrder);
  }
  tables.sort((left, right) => left.sourceOrder - right.sourceOrder || left.inputIndex - right.inputIndex);

  return { bodyProse, tables };
}
