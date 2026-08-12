import {
  buildCatalogIndex,
  expectedCriterionIds,
  resolveCriterionLabel,
  SUPPORTED_LEVELS,
  SUPPORTED_VERSIONS,
} from "./catalog-index.mjs";
import { hasLooseScPrefix, hasScLikeText, isFormulaLike } from "./normalization.mjs";
import { IngestionRejection } from "./rejections.mjs";
import {
  INGESTION_LIMITS,
  normalizeAndLimitCandidateDocument,
  PARSER_VERSION,
} from "./resource-limits.mjs";
import { classifyTable } from "./table-classification.mjs";
import { validateIngestionResult } from "./validate-ingestion-result.mjs";
import { extractReportEvidence } from "./report-evidence.mjs";

const SOURCE_TYPES = new Set(["google-doc", "docx", "pdf"]);

function safeRequestId(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= 128
    ? value
    : "invalid-request";
}

function baseResult(requestId, sourceType, catalogVersion) {
  return {
    schemaVersion: "1.0.0",
    requestId: safeRequestId(requestId),
    parserVersion: PARSER_VERSION,
    catalogVersion: catalogVersion === "1.0.0" ? catalogVersion : "1.0.0",
    sourceType: SOURCE_TYPES.has(sourceType) ? sourceType : "unknown",
  };
}

function rejected(base, code, stage, safeMessage) {
  const result = {
    ...base,
    status: "rejected",
    rejection: { code, stage, safeMessage },
  };
  try {
    return validateIngestionResult(result);
  } catch {
    return validateIngestionResult({
      ...base,
      status: "rejected",
      rejection: {
        code: "SOURCE_MALFORMED",
        stage: "container-parse",
        safeMessage: "The source structure is malformed and could not be analyzed.",
      },
    });
  }
}

function validateDeclaredScope(declaredWcagVersions, declaredLevels) {
  if (
    !Array.isArray(declaredWcagVersions) ||
    declaredWcagVersions.length === 0 ||
    new Set(declaredWcagVersions).size !== declaredWcagVersions.length ||
    declaredWcagVersions.some((version) => !SUPPORTED_VERSIONS.has(version))
  ) {
    throw new IngestionRejection(
      "VPAT_VERSION_UNSUPPORTED",
      "classification",
      "The declared WCAG version is missing, ambiguous, or unsupported.",
    );
  }
  if (
    !Array.isArray(declaredLevels) ||
    declaredLevels.length === 0 ||
    new Set(declaredLevels).size !== declaredLevels.length ||
    declaredLevels.some((level) => !SUPPORTED_LEVELS.has(level))
  ) {
    throw new IngestionRejection(
      "SOURCE_MALFORMED",
      "classification",
      "The declared WCAG conformance levels are malformed.",
    );
  }
}

function rowId(sequence) {
  return `row-${String(sequence).padStart(3, "0")}`;
}

function addExcluded(excludedRows, sourceTableIndex, sourceRowIndex, sourceLabel, reasonCode) {
  if (sourceLabel.length > INGESTION_LIMITS.maxCriterionLabelCharacters) {
    throw new IngestionRejection(
      "RESOURCE_LIMIT_EXCEEDED",
      "resource-limit",
      "The source exceeds a deterministic ingestion resource limit.",
    );
  }
  if (excludedRows.length >= INGESTION_LIMITS.maxExcludedRows) {
    throw new IngestionRejection(
      "RESOURCE_LIMIT_EXCEEDED",
      "resource-limit",
      "The source exceeds a deterministic ingestion resource limit.",
    );
  }
  excludedRows.push({ sourceTableIndex, sourceRowIndex, sourceLabel, reasonCode });
}

function relevantNonWcagExclusion(table, row, decision, excludedRows) {
  const label = row.cells[0] ?? "";
  if (decision.reasonCode === "SECTION_508_TABLE") {
    addExcluded(excludedRows, table.sourceOrder, row.sourceRowIndex, label, "SECTION_508_ROW");
    return;
  }
  if (decision.reasonCode === "EN_301_549_TABLE") {
    addExcluded(excludedRows, table.sourceOrder, row.sourceRowIndex, label, "EN_301_549_ROW");
    return;
  }
  if (hasLooseScPrefix(label) || hasScLikeText(label)) {
    addExcluded(
      excludedRows,
      table.sourceOrder,
      row.sourceRowIndex,
      label,
      "UNRECOGNIZED_CRITERION",
    );
    return;
  }
  const formulaLikeCell = row.cells.find(isFormulaLike);
  if (formulaLikeCell !== undefined) {
    addExcluded(
      excludedRows,
      table.sourceOrder,
      row.sourceRowIndex,
      formulaLikeCell,
      "NON_WCAG_ROW",
    );
  }
}

function rejectionFromError(base, error) {
  if (error instanceof IngestionRejection) {
    return rejected(base, error.code, error.stage, error.safeMessage);
  }
  return rejected(
    base,
    "SOURCE_MALFORMED",
    "container-parse",
    "The source structure is malformed and could not be analyzed.",
  );
}

export function ingestCandidateDocument({
  requestId,
  sourceType,
  candidateDocument,
  catalog,
  declaredWcagVersions,
  declaredLevels,
}) {
  const base = baseResult(requestId, sourceType, catalog?.version);

  if (!SOURCE_TYPES.has(sourceType)) {
    return rejected(
      base,
      "SOURCE_TYPE_UNSUPPORTED",
      "classification",
      "The selected source type is not supported.",
    );
  }

  try {
    validateDeclaredScope(declaredWcagVersions, declaredLevels);
    const catalogIndex = buildCatalogIndex(catalog);
    if (catalogIndex.catalogVersion !== "1.0.0") {
      throw new IngestionRejection(
        "SOURCE_MALFORMED",
        "row-matching",
        "The source could not be matched to the supported WCAG catalog.",
      );
    }
    const document = normalizeAndLimitCandidateDocument(candidateDocument);
    const decisions = document.tables.map((table) => ({
      table,
      decision: classifyTable(table),
    }));
    const candidateTables = decisions.map(({ table, decision }) => ({
      tableId: table.tableId,
      sourceOrder: table.sourceOrder,
      classification: decision.classification,
      reasonCode: decision.reasonCode,
      headers: table.headers,
    }));

    const excludedRows = [];
    document.bodyProse.forEach((paragraph, paragraphIndex) => {
      if (hasLooseScPrefix(paragraph) || hasScLikeText(paragraph)) {
        // The v1 schema has no body-location field; zero is its schema-compatible sentinel.
        addExcluded(excludedRows, 0, paragraphIndex, paragraph, "BODY_PROSE");
      }
    });

    const rows = [];
    const firstRowByCriterion = new Map();
    const duplicateGroups = new Map();
    let matchedSequence = 0;
    let eligibleTableCount = 0;
    let hasAmbiguousWcagMaterial = false;

    for (const { table, decision } of decisions) {
      if (decision.classification === "non-wcag") {
        for (const row of table.rows) {
          relevantNonWcagExclusion(table, row, decision, excludedRows);
        }
        continue;
      }

      if (decision.classification === "ambiguous") {
        if (
          table.context.toLocaleLowerCase("en-US").includes("wcag") ||
          table.rows.some((row) => hasLooseScPrefix(row.cells[0]) || hasScLikeText(row.cells[0]))
        ) {
          hasAmbiguousWcagMaterial = true;
        }
        continue;
      }

      eligibleTableCount += 1;
      for (const row of table.rows) {
        const sourceCriterionLabel = row.cells[0] ?? "";
        const resolution = resolveCriterionLabel(sourceCriterionLabel, catalogIndex);
        if (resolution.status !== "matched") {
          if (hasLooseScPrefix(sourceCriterionLabel) || hasScLikeText(sourceCriterionLabel)) {
            hasAmbiguousWcagMaterial = true;
            addExcluded(
              excludedRows,
              table.sourceOrder,
              row.sourceRowIndex,
              sourceCriterionLabel,
              "AMBIGUOUS_CRITERION",
            );
          } else if (sourceCriterionLabel) {
            addExcluded(
              excludedRows,
              table.sourceOrder,
              row.sourceRowIndex,
              sourceCriterionLabel,
              "NON_WCAG_ROW",
            );
          }
          continue;
        }

        matchedSequence += 1;
        const currentRowId = rowId(matchedSequence);
        const extractedRow = {
          rowId: currentRowId,
          criterionId: resolution.criterion.id,
          sourceCriterionLabel,
          sourceConformance: row.cells[1] ?? "",
          sourceRemarks: row.cells.slice(2).join("\n"),
          sourceTableIndex: table.sourceOrder,
          sourceRowIndex: row.sourceRowIndex,
          aliasMatch: resolution.aliasMatch,
        };

        const keptRow = firstRowByCriterion.get(extractedRow.criterionId);
        if (keptRow) {
          addExcluded(
            excludedRows,
            table.sourceOrder,
            row.sourceRowIndex,
            sourceCriterionLabel,
            "DUPLICATE_CRITERION",
          );
          const group = duplicateGroups.get(extractedRow.criterionId) ?? {
            criterionId: extractedRow.criterionId,
            keptRowId: keptRow.rowId,
            duplicateRows: [],
          };
          if (group.duplicateRows.length >= INGESTION_LIMITS.maxDuplicatesPerCriterion) {
            throw new IngestionRejection(
              "RESOURCE_LIMIT_EXCEEDED",
              "resource-limit",
              "The source exceeds a deterministic ingestion resource limit.",
            );
          }
          group.duplicateRows.push(extractedRow);
          duplicateGroups.set(extractedRow.criterionId, group);
          continue;
        }

        firstRowByCriterion.set(extractedRow.criterionId, extractedRow);
        rows.push(extractedRow);
      }
    }

    if (hasAmbiguousWcagMaterial) {
      return rejected(
        base,
        "WCAG_ROWS_AMBIGUOUS",
        "row-matching",
        "One or more apparent WCAG rows could not be matched without guessing.",
      );
    }
    if (eligibleTableCount === 0 || rows.length === 0) {
      return rejected(
        base,
        "WCAG_TABLE_NOT_FOUND",
        "table-detection",
        "No eligible WCAG conformance table was found.",
      );
    }

    const expectedIds = expectedCriterionIds(
      catalogIndex,
      declaredWcagVersions,
      declaredLevels,
    );
    const extractedIds = rows.map((row) => row.criterionId);
    const extractedSet = new Set(extractedIds);

    return validateIngestionResult({
      ...base,
      status: "complete",
      reportEvidence: extractReportEvidence(document),
      candidateTables,
      rows,
      excludedRows,
      duplicates: [...duplicateGroups.values()],
      coverage: {
        declaredWcagVersions: [...declaredWcagVersions],
        declaredLevels: [...declaredLevels],
        expectedCriterionIds: expectedIds,
        extractedCriterionIds: extractedIds,
        missingCriterionIds: expectedIds.filter((criterionId) => !extractedSet.has(criterionId)),
      },
    });
  } catch (error) {
    return rejectionFromError(base, error);
  }
}
