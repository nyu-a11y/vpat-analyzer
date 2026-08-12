const COMPLETE_KEYS = Object.freeze([
  "candidateTables",
  "catalogVersion",
  "coverage",
  "duplicates",
  "excludedRows",
  "parserVersion",
  "requestId",
  "rows",
  "schemaVersion",
  "sourceType",
  "status",
]);

const REJECTED_KEYS = Object.freeze([
  "catalogVersion",
  "parserVersion",
  "rejection",
  "requestId",
  "schemaVersion",
  "sourceType",
  "status",
]);

const REJECTION_CODES = new Set([
  "SOURCE_INACCESSIBLE",
  "SOURCE_TYPE_UNSUPPORTED",
  "VPAT_VERSION_UNSUPPORTED",
  "PDF_NON_SEARCHABLE",
  "PDF_INSUFFICIENT_TEXT",
  "PDF_ENCRYPTED",
  "SOURCE_MALFORMED",
  "WCAG_TABLE_NOT_FOUND",
  "WCAG_ROWS_AMBIGUOUS",
  "RESOURCE_LIMIT_EXCEEDED",
]);

const REJECTION_STAGES = new Set([
  "access",
  "classification",
  "transport",
  "container-parse",
  "table-detection",
  "row-matching",
  "resource-limit",
]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return isObject(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function isStringArray(value) {
  return Array.isArray(value) && value.every(item => typeof item === "string");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, stableValue(value[key])]),
  );
}

export function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

export async function sha256Text(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function validateIngestionResult(result, { requestId, sourceType } = {}) {
  const errors = [];
  const add = condition => { if (!condition) errors.push("contract-mismatch"); };
  add(isObject(result));
  if (!isObject(result)) return Object.freeze({ valid: false, errorCount: errors.length });

  add(result.schemaVersion === "1.0.0");
  add(result.parserVersion === "1.0.0");
  add(result.catalogVersion === "1.0.0");
  add(typeof result.requestId === "string" && result.requestId.length >= 1 && result.requestId.length <= 128);
  add(["google-doc", "docx", "pdf", "unknown"].includes(result.sourceType));
  if (requestId !== undefined) add(result.requestId === requestId);
  if (sourceType !== undefined) add(result.sourceType === sourceType);

  if (result.status === "rejected") {
    add(hasExactKeys(result, REJECTED_KEYS));
    add(hasExactKeys(result.rejection, ["code", "safeMessage", "stage"]));
    add(REJECTION_CODES.has(result.rejection?.code));
    add(REJECTION_STAGES.has(result.rejection?.stage));
    add(typeof result.rejection?.safeMessage === "string" && result.rejection.safeMessage.length >= 1 && result.rejection.safeMessage.length <= 500);
    return Object.freeze({ valid: errors.length === 0, errorCount: errors.length });
  }

  add(result.status === "complete");
  add(hasExactKeys(result, COMPLETE_KEYS));
  add(Array.isArray(result.candidateTables) && result.candidateTables.length >= 1);
  add(Array.isArray(result.rows) && result.rows.length >= 1 && result.rows.length <= 87);
  add(Array.isArray(result.excludedRows));
  add(Array.isArray(result.duplicates));
  add(hasExactKeys(result.coverage, [
    "declaredLevels",
    "declaredWcagVersions",
    "expectedCriterionIds",
    "extractedCriterionIds",
    "missingCriterionIds",
  ]));
  add(isStringArray(result.coverage?.declaredLevels));
  add(isStringArray(result.coverage?.declaredWcagVersions));
  add(isStringArray(result.coverage?.expectedCriterionIds));
  add(isStringArray(result.coverage?.extractedCriterionIds));
  add(isStringArray(result.coverage?.missingCriterionIds));
  add(result.rows?.every(row =>
    hasExactKeys(row, [
      "aliasMatch",
      "criterionId",
      "rowId",
      "sourceConformance",
      "sourceCriterionLabel",
      "sourceRemarks",
      "sourceRowIndex",
      "sourceTableIndex",
    ]) && /^wcag-sc-/.test(row.criterionId)) ?? false);
  add(result.candidateTables?.every(table =>
    hasExactKeys(table, ["classification", "headers", "reasonCode", "sourceOrder", "tableId"]) &&
      isStringArray(table.headers)) ?? false);
  add(result.excludedRows?.every(row =>
    hasExactKeys(row, ["reasonCode", "sourceLabel", "sourceRowIndex", "sourceTableIndex"])) ?? false);
  add(result.duplicates?.every(group =>
    hasExactKeys(group, ["criterionId", "duplicateRows", "keptRowId"]) &&
      Array.isArray(group.duplicateRows) && group.duplicateRows.length >= 1 &&
      group.duplicateRows.every(row => hasExactKeys(row, [
        "aliasMatch",
        "criterionId",
        "rowId",
        "sourceConformance",
        "sourceCriterionLabel",
        "sourceRemarks",
        "sourceRowIndex",
        "sourceTableIndex",
      ]))) ?? false);

  return Object.freeze({ valid: errors.length === 0, errorCount: errors.length });
}

function sortedExclusions(rows) {
  return rows
    .map(row => ({
      sourceTableIndex: row.sourceTableIndex,
      sourceRowIndex: row.sourceRowIndex,
      reasonCode: row.reasonCode,
      sourceLabel: row.sourceLabel,
    }))
    .sort((left, right) =>
      `${left.reasonCode}\u0000${left.sourceLabel}`.localeCompare(
        `${right.reasonCode}\u0000${right.sourceLabel}`,
        "en-US",
      ));
}

export function canonicalPositiveProjection(result) {
  if (result?.status !== "complete") return null;
  return {
    schemaVersion: "1.0.0",
    orderedCriterionIds: result.rows.map(row => row.criterionId),
    orderedRows: result.rows.map(row => ({
      rowId: row.rowId,
      criterionId: row.criterionId,
      sourceCriterionLabel: row.sourceCriterionLabel,
      sourceConformance: row.sourceConformance,
      sourceRemarks: row.sourceRemarks,
      sourceTableIndex: row.sourceTableIndex,
      sourceRowIndex: row.sourceRowIndex,
      aliasMatch: row.aliasMatch,
    })),
    coverage: {
      declaredWcagVersions: [...result.coverage.declaredWcagVersions],
      declaredLevels: [...result.coverage.declaredLevels],
      expectedCriterionIds: [...result.coverage.expectedCriterionIds],
      extractedCriterionIds: [...result.coverage.extractedCriterionIds],
      missingCriterionIds: [...result.coverage.missingCriterionIds],
    },
    duplicates: result.duplicates
      .map(group => ({
        criterionId: group.criterionId,
        keptRowId: group.keptRowId,
        duplicateRows: group.duplicateRows.map(row => ({
          rowId: row.rowId,
          criterionId: row.criterionId,
          sourceCriterionLabel: row.sourceCriterionLabel,
          sourceConformance: row.sourceConformance,
          sourceRemarks: row.sourceRemarks,
          sourceTableIndex: row.sourceTableIndex,
          sourceRowIndex: row.sourceRowIndex,
          aliasMatch: row.aliasMatch,
        })),
      }))
      .sort((left, right) => left.criterionId.localeCompare(right.criterionId, "en-US")),
    excludedRows: sortedExclusions(result.excludedRows),
    tableDecisions: result.candidateTables.map(table => ({
      sourceOrder: table.sourceOrder,
      classification: table.classification,
      reasonCode: table.reasonCode,
    })),
  };
}

export async function positiveProjectionDigest(result) {
  const projection = canonicalPositiveProjection(result);
  return projection ? sha256Text(stableStringify(projection)) : null;
}

export function canonicalExpectedProjection({
  orderedRows,
  excludedRows,
  tableDecisions,
  duplicateRow,
  declaredWcagVersions = ["2.2"],
  declaredLevels = ["A", "AA"],
}) {
  const orderedCriterionIds = orderedRows.map(row => row.criterionId);
  return {
    schemaVersion: "1.0.0",
    orderedCriterionIds: [...orderedCriterionIds],
    orderedRows: orderedRows.map(row => ({
      rowId: row.rowId,
      criterionId: row.criterionId,
      sourceCriterionLabel: row.sourceCriterionLabel,
      sourceConformance: row.sourceConformance,
      sourceRemarks: row.sourceRemarks,
      sourceTableIndex: row.sourceTableIndex,
      sourceRowIndex: row.sourceRowIndex,
      aliasMatch: row.aliasMatch,
    })),
    coverage: {
      declaredWcagVersions: [...declaredWcagVersions],
      declaredLevels: [...declaredLevels],
      expectedCriterionIds: [...orderedCriterionIds],
      extractedCriterionIds: [...orderedCriterionIds],
      missingCriterionIds: [],
    },
    duplicates: duplicateRow ? [{
      criterionId: duplicateRow.criterionId,
      keptRowId: "row-001",
      duplicateRows: [{ ...duplicateRow }],
    }] : [],
    excludedRows: sortedExclusions(excludedRows),
    tableDecisions: tableDecisions.map((table, sourceOrder) => ({
      sourceOrder,
      classification: table.classification,
      reasonCode: table.reasonCode,
    })),
  };
}
