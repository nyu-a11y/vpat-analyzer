import { INGESTION_LIMITS } from "./resource-limits.mjs";
import {
  MAX_FIELD_CHARACTERS,
  MAX_TOTAL_CHARACTERS,
  REPORT_EVIDENCE_FIELDS,
} from "./report-evidence.mjs";

const COMPLETE_PROPERTIES = Object.freeze([
  "schemaVersion",
  "requestId",
  "parserVersion",
  "catalogVersion",
  "sourceType",
  "status",
  "candidateTables",
  "rows",
  "excludedRows",
  "duplicates",
  "coverage",
]);

const REJECTED_PROPERTIES = Object.freeze([
  "schemaVersion",
  "requestId",
  "parserVersion",
  "catalogVersion",
  "sourceType",
  "status",
  "rejection",
]);

const CANDIDATE_TABLE_PROPERTIES = Object.freeze([
  "tableId",
  "sourceOrder",
  "classification",
  "reasonCode",
  "headers",
]);

const EXTRACTED_ROW_PROPERTIES = Object.freeze([
  "rowId",
  "criterionId",
  "sourceCriterionLabel",
  "sourceConformance",
  "sourceRemarks",
  "sourceTableIndex",
  "sourceRowIndex",
  "aliasMatch",
]);

const EXCLUDED_ROW_PROPERTIES = Object.freeze([
  "sourceTableIndex",
  "sourceRowIndex",
  "sourceLabel",
  "reasonCode",
]);

const DUPLICATE_GROUP_PROPERTIES = Object.freeze([
  "criterionId",
  "keptRowId",
  "duplicateRows",
]);

const COVERAGE_PROPERTIES = Object.freeze([
  "declaredWcagVersions",
  "declaredLevels",
  "expectedCriterionIds",
  "extractedCriterionIds",
  "missingCriterionIds",
]);

const REJECTION_PROPERTIES = Object.freeze(["code", "stage", "safeMessage"]);

const COMPLETE_SOURCE_TYPES = new Set(["google-doc", "docx", "pdf"]);
const REJECTED_SOURCE_TYPES = new Set([...COMPLETE_SOURCE_TYPES, "unknown"]);
const CLASSIFICATIONS = new Set(["wcag", "non-wcag", "ambiguous"]);
const CANDIDATE_REASON_CODES = new Set([
  "ELIGIBLE_WCAG_HEADERS",
  "BODY_OR_LAYOUT_TABLE",
  "SECTION_508_TABLE",
  "EN_301_549_TABLE",
  "NON_WCAG_TABLE",
  "AMBIGUOUS_HEADERS",
]);
const CLASSIFICATION_REASONS = Object.freeze({
  wcag: new Set(["ELIGIBLE_WCAG_HEADERS"]),
  "non-wcag": new Set([
    "BODY_OR_LAYOUT_TABLE",
    "SECTION_508_TABLE",
    "EN_301_549_TABLE",
    "NON_WCAG_TABLE",
  ]),
  ambiguous: new Set(["AMBIGUOUS_HEADERS"]),
});
const ALIAS_MATCHES = new Set(["exact-sc", "exact-sc-plus-official-title"]);
const EXCLUDED_REASON_CODES = new Set([
  "BODY_PROSE",
  "NON_WCAG_ROW",
  "SECTION_508_ROW",
  "EN_301_549_ROW",
  "UNRECOGNIZED_CRITERION",
  "AMBIGUOUS_CRITERION",
  "DUPLICATE_CRITERION",
]);
const WCAG_VERSIONS = new Set(["2.0", "2.1", "2.2"]);
const WCAG_LEVELS = new Set(["A", "AA", "AAA"]);
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

const PARSER_VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const CRITERION_ID_PATTERN = /^wcag-sc-[1-4]\.[1-9][0-9]*\.[1-9][0-9]*$/;

export class IngestionResultValidationError extends Error {
  constructor(path, reason) {
    super(`Invalid IngestionResult at ${path}: ${reason}`);
    this.name = "IngestionResultValidationError";
    this.path = path;
    this.safeMessage = "The ingestion result failed deterministic validation.";
  }
}

function invalid(path, reason) {
  throw new IngestionResultValidationError(path, reason);
}

function codePointLength(value) {
  let length = 0;
  for (const unused of value) {
    void unused;
    length += 1;
  }
  return length;
}

function requireClosedObject(value, path, properties, optionalProperties = []) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalid(path, "must be an object");
  }

  const allowed = new Set([...properties, ...optionalProperties]);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) {
      invalid(path, "contains an unexpected property");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      invalid(`${path}.${key}`, "must be a JSON data property");
    }
  }
  for (const property of properties) {
    if (!Object.hasOwn(value, property)) {
      invalid(path, `is missing required property ${property}`);
    }
  }
  return value;
}

function validateReportEvidence(evidence) {
  const path = "$.reportEvidence";
  requireClosedObject(evidence, path, REPORT_EVIDENCE_FIELDS);
  let totalCharacters = 0;
  REPORT_EVIDENCE_FIELDS.forEach((field) => {
    const value = requireString(evidence[field], `${path}.${field}`, {
      maxLength: MAX_FIELD_CHARACTERS,
    });
    totalCharacters += codePointLength(value);
  });
  if (totalCharacters > MAX_TOTAL_CHARACTERS) {
    invalid(path, `must contain no more than ${MAX_TOTAL_CHARACTERS} total characters`);
  }
}

function requireString(value, path, options = {}) {
  if (typeof value !== "string") invalid(path, "must be a string");
  const length = codePointLength(value);
  if (options.minLength !== undefined && length < options.minLength) {
    invalid(path, `must contain at least ${options.minLength} character(s)`);
  }
  if (options.maxLength !== undefined && length > options.maxLength) {
    invalid(path, `must contain no more than ${options.maxLength} character(s)`);
  }
  if (options.constant !== undefined && value !== options.constant) {
    invalid(path, "must equal the required constant");
  }
  if (options.allowed && !options.allowed.has(value)) {
    invalid(path, "must be an allowed value");
  }
  if (options.pattern && !options.pattern.test(value)) {
    invalid(path, "must match the required pattern");
  }
  return value;
}

function requireInteger(value, path, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum) {
    invalid(path, `must be an integer greater than or equal to ${minimum}`);
  }
  return value;
}

function requireArray(value, path, { minItems = 0, maxItems = Infinity } = {}) {
  if (!Array.isArray(value)) invalid(path, "must be an array");
  if (value.length < minItems) invalid(path, `must contain at least ${minItems} item(s)`);
  if (value.length > maxItems) invalid(path, `must contain no more than ${maxItems} item(s)`);
  const allowedKeys = new Set(["length"]);
  for (let index = 0; index < value.length; index += 1) {
    const key = String(index);
    allowedKeys.add(key);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      invalid(`${path}[${index}]`, "must be a JSON array item");
    }
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowedKeys.has(key)) {
      invalid(path, "contains an unexpected array property");
    }
  }
  return value;
}

function requireUniqueStrings(values, path) {
  const seen = new Set();
  values.forEach((value, index) => {
    if (seen.has(value)) invalid(`${path}[${index}]`, "must be unique within the array");
    seen.add(value);
  });
}

function requireStringArray(value, path, options = {}) {
  const values = requireArray(value, path, options);
  values.forEach((item, index) => requireString(item, `${path}[${index}]`, options.items));
  if (options.uniqueItems) requireUniqueStrings(values, path);
  return values;
}

function validateCommon(result, sourceTypes) {
  requireString(result.schemaVersion, "$.schemaVersion", { constant: "1.0.0" });
  requireString(result.requestId, "$.requestId", { minLength: 1, maxLength: 128 });
  requireString(result.parserVersion, "$.parserVersion", { pattern: PARSER_VERSION_PATTERN });
  requireString(result.catalogVersion, "$.catalogVersion", { constant: "1.0.0" });
  requireString(result.sourceType, "$.sourceType", { allowed: sourceTypes });
}

function validateCandidateTable(table, index) {
  const path = `$.candidateTables[${index}]`;
  requireClosedObject(table, path, CANDIDATE_TABLE_PROPERTIES);
  requireString(table.tableId, `${path}.tableId`, { minLength: 1, maxLength: 128 });
  requireInteger(table.sourceOrder, `${path}.sourceOrder`);
  requireString(table.classification, `${path}.classification`, { allowed: CLASSIFICATIONS });
  requireString(table.reasonCode, `${path}.reasonCode`, { allowed: CANDIDATE_REASON_CODES });
  requireStringArray(table.headers, `${path}.headers`, {
    maxItems: 32,
    items: { maxLength: 500 },
  });

  if (!CLASSIFICATION_REASONS[table.classification].has(table.reasonCode)) {
    invalid(`${path}.reasonCode`, "must agree with the table classification");
  }
}

function validateExtractedRowAtPath(row, path) {
  requireClosedObject(row, path, EXTRACTED_ROW_PROPERTIES);
  requireString(row.rowId, `${path}.rowId`, { minLength: 1, maxLength: 160 });
  requireString(row.criterionId, `${path}.criterionId`, { pattern: CRITERION_ID_PATTERN });
  requireString(row.sourceCriterionLabel, `${path}.sourceCriterionLabel`, {
    minLength: 1,
    maxLength: 1000,
  });
  requireString(row.sourceConformance, `${path}.sourceConformance`, { maxLength: 2000 });
  requireString(row.sourceRemarks, `${path}.sourceRemarks`, { maxLength: 10000 });
  requireInteger(row.sourceTableIndex, `${path}.sourceTableIndex`);
  requireInteger(row.sourceRowIndex, `${path}.sourceRowIndex`);
  requireString(row.aliasMatch, `${path}.aliasMatch`, { allowed: ALIAS_MATCHES });
}

function validateExtractedRow(row, index) {
  validateExtractedRowAtPath(row, `$.rows[${index}]`);
}

function validateExcludedRow(row, index) {
  const path = `$.excludedRows[${index}]`;
  requireClosedObject(row, path, EXCLUDED_ROW_PROPERTIES);
  requireInteger(row.sourceTableIndex, `${path}.sourceTableIndex`);
  requireInteger(row.sourceRowIndex, `${path}.sourceRowIndex`);
  requireString(row.sourceLabel, `${path}.sourceLabel`, { maxLength: 1000 });
  requireString(row.reasonCode, `${path}.reasonCode`, { allowed: EXCLUDED_REASON_CODES });
}

function validateDuplicateGroup(group, index) {
  const path = `$.duplicates[${index}]`;
  requireClosedObject(group, path, DUPLICATE_GROUP_PROPERTIES);
  requireString(group.criterionId, `${path}.criterionId`, { pattern: CRITERION_ID_PATTERN });
  requireString(group.keptRowId, `${path}.keptRowId`, { minLength: 1, maxLength: 160 });
  requireArray(group.duplicateRows, `${path}.duplicateRows`, {
    minItems: 1,
    maxItems: INGESTION_LIMITS.maxDuplicatesPerCriterion,
  });
  group.duplicateRows.forEach((row, rowIndex) =>
    validateExtractedRowAtPath(row, `${path}.duplicateRows[${rowIndex}]`));
}

function validateCoverage(coverage) {
  const path = "$.coverage";
  requireClosedObject(coverage, path, COVERAGE_PROPERTIES);
  requireStringArray(coverage.declaredWcagVersions, `${path}.declaredWcagVersions`, {
    minItems: 1,
    uniqueItems: true,
    items: { allowed: WCAG_VERSIONS },
  });
  requireStringArray(coverage.declaredLevels, `${path}.declaredLevels`, {
    minItems: 1,
    uniqueItems: true,
    items: { allowed: WCAG_LEVELS },
  });
  const criterionItems = { pattern: CRITERION_ID_PATTERN };
  requireStringArray(coverage.expectedCriterionIds, `${path}.expectedCriterionIds`, {
    minItems: 1,
    maxItems: 87,
    uniqueItems: true,
    items: criterionItems,
  });
  requireStringArray(coverage.extractedCriterionIds, `${path}.extractedCriterionIds`, {
    minItems: 1,
    maxItems: 87,
    uniqueItems: true,
    items: criterionItems,
  });
  requireStringArray(coverage.missingCriterionIds, `${path}.missingCriterionIds`, {
    maxItems: 87,
    uniqueItems: true,
    items: criterionItems,
  });
}

function validateRejection(rejection) {
  const path = "$.rejection";
  requireClosedObject(rejection, path, REJECTION_PROPERTIES);
  requireString(rejection.code, `${path}.code`, { allowed: REJECTION_CODES });
  requireString(rejection.stage, `${path}.stage`, { allowed: REJECTION_STAGES });
  requireString(rejection.safeMessage, `${path}.safeMessage`, { minLength: 1, maxLength: 500 });
}

function compareCriterionIds(left, right) {
  const leftParts = left.slice("wcag-sc-".length).split(".");
  const rightParts = right.slice("wcag-sc-".length).split(".");
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index].length !== rightParts[index].length) {
      return leftParts[index].length - rightParts[index].length;
    }
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] < rightParts[index] ? -1 : 1;
    }
  }
  return 0;
}

function requireSameArray(actual, expected, path, reason) {
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    invalid(path, reason);
  }
}

function validateCompleteSemantics(result) {
  const tableIds = new Set();
  const tablesByOrder = new Map();
  let previousSourceOrder = -1;
  result.candidateTables.forEach((table, index) => {
    const path = `$.candidateTables[${index}]`;
    if (tableIds.has(table.tableId)) invalid(`${path}.tableId`, "must be unique");
    if (tablesByOrder.has(table.sourceOrder)) invalid(`${path}.sourceOrder`, "must be unique");
    if (table.sourceOrder <= previousSourceOrder) {
      invalid(`${path}.sourceOrder`, "must be in strictly increasing source order");
    }
    tableIds.add(table.tableId);
    tablesByOrder.set(table.sourceOrder, table);
    previousSourceOrder = table.sourceOrder;
  });

  const rowsById = new Map();
  const rowsByCriterion = new Map();
  const rowLocations = new Set();
  let previousRowLocation = null;
  result.rows.forEach((row, index) => {
    const path = `$.rows[${index}]`;
    if (rowsById.has(row.rowId)) invalid(`${path}.rowId`, "must be unique");
    if (rowsByCriterion.has(row.criterionId)) invalid(`${path}.criterionId`, "must be unique");
    const sourceTable = tablesByOrder.get(row.sourceTableIndex);
    if (!sourceTable || sourceTable.classification !== "wcag") {
      invalid(`${path}.sourceTableIndex`, "must reference an eligible candidate table");
    }
    const location = `${row.sourceTableIndex}:${row.sourceRowIndex}`;
    if (rowLocations.has(location)) {
      invalid(path, "must have a unique source table and row location");
    }
    if (
      previousRowLocation &&
      (row.sourceTableIndex < previousRowLocation.sourceTableIndex ||
        (row.sourceTableIndex === previousRowLocation.sourceTableIndex &&
          row.sourceRowIndex <= previousRowLocation.sourceRowIndex))
    ) {
      invalid(path, "must follow source table and row order");
    }
    rowLocations.add(location);
    rowsById.set(row.rowId, row);
    rowsByCriterion.set(row.criterionId, row);
    previousRowLocation = row;
  });

  const duplicateCriteria = new Set();
  const keptRowIds = new Set();
  const allRowIds = new Set(rowsById.keys());
  const allRowLocations = new Set(rowLocations);
  const duplicateRows = [];
  result.duplicates.forEach((group, index) => {
    const path = `$.duplicates[${index}]`;
    if (duplicateCriteria.has(group.criterionId)) {
      invalid(`${path}.criterionId`, "must identify only one duplicate group");
    }
    const keptRow = rowsById.get(group.keptRowId);
    if (!keptRow) invalid(`${path}.keptRowId`, "must reference an extracted row");
    if (keptRow.criterionId !== group.criterionId) {
      invalid(`${path}.criterionId`, "must match the kept row criterion");
    }
    if (keptRowIds.has(group.keptRowId)) {
      invalid(`${path}.keptRowId`, "must not be reused by another duplicate group");
    }
    keptRowIds.add(group.keptRowId);
    duplicateCriteria.add(group.criterionId);
    group.duplicateRows.forEach((row, rowIndex) => {
      const rowPath = `${path}.duplicateRows[${rowIndex}]`;
      if (row.criterionId !== group.criterionId) {
        invalid(`${rowPath}.criterionId`, "must match the duplicate group criterion");
      }
      if (allRowIds.has(row.rowId)) {
        invalid(`${rowPath}.rowId`, "must be globally unique across retained and duplicate rows");
      }
      const sourceTable = tablesByOrder.get(row.sourceTableIndex);
      if (!sourceTable || sourceTable.classification !== "wcag") {
        invalid(`${rowPath}.sourceTableIndex`, "must reference an eligible candidate table");
      }
      const location = `${row.sourceTableIndex}:${row.sourceRowIndex}`;
      if (allRowLocations.has(location)) {
        invalid(rowPath, "must have a globally unique source table and row location");
      }
      allRowIds.add(row.rowId);
      allRowLocations.add(location);
      duplicateRows.push({ row, rowPath, location });
    });
  });

  const duplicateExclusionsByLocation = new Map();
  result.excludedRows.forEach((row, index) => {
    if (row.reasonCode !== "DUPLICATE_CRITERION") return;
    const location = `${row.sourceTableIndex}:${row.sourceRowIndex}`;
    if (duplicateExclusionsByLocation.has(location)) {
      invalid(
        `$.excludedRows[${index}]`,
        "must not duplicate a duplicate-criterion source location",
      );
    }
    duplicateExclusionsByLocation.set(location, { row, index });
  });
  if (duplicateExclusionsByLocation.size !== duplicateRows.length) {
    invalid("$.duplicates", "must account for every duplicate-row exclusion exactly once");
  }
  for (const { row, rowPath, location } of duplicateRows) {
    const exclusion = duplicateExclusionsByLocation.get(location);
    if (!exclusion) {
      invalid(rowPath, "must have a matching duplicate-criterion exclusion at its source location");
    }
    if (exclusion.row.sourceLabel !== row.sourceCriterionLabel) {
      invalid(
        `$.excludedRows[${exclusion.index}].sourceLabel`,
        "must match the corresponding duplicate row source criterion label",
      );
    }
  }

  const extractedIds = result.rows.map(({ criterionId }) => criterionId);
  requireSameArray(
    result.coverage.extractedCriterionIds,
    extractedIds,
    "$.coverage.extractedCriterionIds",
    "must match extracted row criterion IDs in row order",
  );

  const expectedIds = result.coverage.expectedCriterionIds;
  for (let index = 1; index < expectedIds.length; index += 1) {
    if (compareCriterionIds(expectedIds[index - 1], expectedIds[index]) >= 0) {
      invalid(
        `$.coverage.expectedCriterionIds[${index}]`,
        "must follow canonical criterion order",
      );
    }
  }
  const expectedSet = new Set(expectedIds);
  for (let index = 0; index < extractedIds.length; index += 1) {
    if (!expectedSet.has(extractedIds[index])) {
      invalid(
        `$.coverage.extractedCriterionIds[${index}]`,
        "must be included in expected criterion IDs",
      );
    }
  }
  const extractedSet = new Set(extractedIds);
  const expectedMissingIds = expectedIds.filter((criterionId) => !extractedSet.has(criterionId));
  requireSameArray(
    result.coverage.missingCriterionIds,
    expectedMissingIds,
    "$.coverage.missingCriterionIds",
    "must be the ordered expected criteria not present in extracted criteria",
  );
}

function validateCompleteResult(result) {
  requireClosedObject(result, "$", COMPLETE_PROPERTIES, ["reportEvidence"]);
  validateCommon(result, COMPLETE_SOURCE_TYPES);
  requireString(result.status, "$.status", { constant: "complete" });
  if (Object.hasOwn(result, "reportEvidence")) validateReportEvidence(result.reportEvidence);

  requireArray(result.candidateTables, "$.candidateTables", { minItems: 1, maxItems: 128 });
  result.candidateTables.forEach(validateCandidateTable);
  requireArray(result.rows, "$.rows", { minItems: 1, maxItems: 87 });
  result.rows.forEach(validateExtractedRow);
  requireArray(result.excludedRows, "$.excludedRows", { maxItems: INGESTION_LIMITS.maxExcludedRows });
  result.excludedRows.forEach(validateExcludedRow);
  requireArray(result.duplicates, "$.duplicates", { maxItems: 87 });
  result.duplicates.forEach(validateDuplicateGroup);
  validateCoverage(result.coverage);
  validateCompleteSemantics(result);
}

function validateRejectedResult(result) {
  requireClosedObject(result, "$", REJECTED_PROPERTIES);
  validateCommon(result, REJECTED_SOURCE_TYPES);
  requireString(result.status, "$.status", { constant: "rejected" });
  validateRejection(result.rejection);
}

/**
 * Validate an IngestionResult v1 value without coercion or mutation.
 * Returns the original value when valid and throws a typed, content-safe error
 * when any structural or semantic invariant fails.
 */
export function validateIngestionResult(result) {
  if (result === null || typeof result !== "object" || Array.isArray(result)) {
    invalid("$", "must be an object");
  }
  const statusDescriptor = Object.getOwnPropertyDescriptor(result, "status");
  if (!statusDescriptor) invalid("$", "is missing required property status");
  if (!statusDescriptor.enumerable || !("value" in statusDescriptor)) {
    invalid("$.status", "must be a JSON data property");
  }
  if (statusDescriptor.value === "complete") validateCompleteResult(result);
  else if (statusDescriptor.value === "rejected") validateRejectedResult(result);
  else invalid("$.status", "must be complete or rejected");
  return result;
}
