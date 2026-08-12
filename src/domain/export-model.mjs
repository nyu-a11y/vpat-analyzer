import { assertAnalysisOutput } from "./analysis-output.mjs";
import {
  deepFreeze,
  invalid,
  requireArray,
  requireClosedObject,
  requireInteger,
  requireNullablePrimitive,
  requireString,
} from "./json-data.mjs";
import { GRADE_BANDS } from "./scoring.mjs";

export const EXPORT_TAB_DEFINITIONS = Object.freeze([
  Object.freeze({ tabId: "overview", name: "Overview", order: 1 }),
  Object.freeze({ tabId: "line-item-review", name: "Line-item Review", order: 2 }),
  Object.freeze({ tabId: "quality-requirements", name: "Quality Requirements", order: 3 }),
  Object.freeze({ tabId: "scoring", name: "Scoring", order: 4 }),
  Object.freeze({
    tabId: "methodology-disclaimer",
    name: "Methodology & disclaimer",
    order: 5,
  }),
]);

export const TRUSTED_TEMPLATE_FORMULA_IDS = Object.freeze([
  "formula-score-earned-v1",
  "formula-score-percentage-v1",
]);
const TRUSTED_FORMULA_SET = new Set(TRUSTED_TEMPLATE_FORMULA_IDS);
const COLUMN_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

export function literalCell(columnId, value) {
  requireString(columnId, "$.columnId", {
    pattern: COLUMN_ID_PATTERN,
    code: "INVALID_EXPORT_MODEL",
  });
  requireNullablePrimitive(value, "$.value", "INVALID_EXPORT_MODEL");
  return { columnId, kind: "literal", value };
}

export function trustedFormulaCell(columnId, templateFormulaId) {
  requireString(columnId, "$.columnId", {
    pattern: COLUMN_ID_PATTERN,
    code: "INVALID_EXPORT_MODEL",
  });
  requireString(templateFormulaId, "$.templateFormulaId", {
    allowed: TRUSTED_FORMULA_SET,
    code: "INVALID_EXPORT_MODEL",
  });
  return {
    columnId,
    kind: "trusted-template-formula-reference",
    templateFormulaId,
  };
}

function row(rowId, columns, values) {
  requireString(rowId, "$.rowId", {
    minLength: 1,
    maxLength: 160,
    code: "INVALID_EXPORT_MODEL",
  });
  if (columns.length !== values.length) {
    invalid("INVALID_EXPORT_MODEL", "$.cells", "must have one value per section column");
  }
  return {
    rowId,
    cells: columns.map((columnId, index) => literalCell(columnId, values[index])),
  };
}

function section(sectionId, heading, kind, columns, rows) {
  return { sectionId, heading, kind, columns, rows };
}

function tab(definition, sections) {
  return { ...definition, sections };
}

function buildOverview(analysis) {
  const columns = ["metric", "value"];
  const summaryRows = [
    ["source-name", "Source", analysis.source.displayName],
    ["source-type", "Source type", analysis.source.sourceType],
    ["vpat-version", "VPAT version", analysis.source.vpatVersion],
    ["wcag-versions", "Declared WCAG versions", analysis.source.declaredWcagVersions.join(", ")],
    ["wcag-levels", "Declared levels", analysis.source.declaredLevels.join(", ")],
    ["analysis-status", "Analysis status", analysis.analysisStatus],
    ["criteria-count", "Criteria reviewed", analysis.counts.criteria],
    ["review-count", "Items needing review", analysis.counts.reviewRequired],
    ["grade", "Report-quality grade", analysis.scoreSummary.grade],
  ].map(([rowId, metric, value]) => row(rowId, columns, [metric, value]));
  return tab(EXPORT_TAB_DEFINITIONS[0], [
    section("analysis-summary", "Analysis summary", "summary", columns, summaryRows),
  ]);
}

function buildLineItems(analysis) {
  const columns = [
    "criterion-id",
    "sc",
    "title",
    "level",
    "source-criterion",
    "source-conformance",
    "source-remarks",
    "normalized-conformance",
    "analyzer-evidence",
    "confidence",
    "status",
    "review-required",
  ];
  const rows = analysis.wcagFindings.map((finding) =>
    row(finding.criterionId, columns, [
      finding.criterionId,
      finding.sc,
      finding.title,
      finding.level,
      finding.sourceCriterionLabel,
      finding.sourceConformance,
      finding.sourceRemarks,
      finding.normalizedConformance,
      finding.evidence,
      finding.confidence,
      finding.status,
      finding.reviewRequired,
    ]),
  );
  return tab(EXPORT_TAB_DEFINITIONS[1], [
    section("wcag-findings", "WCAG criterion findings", "table", columns, rows),
  ]);
}

function buildQuality(analysis) {
  const columns = [
    "requirement-id",
    "aliases",
    "title",
    "type",
    "impact-weight",
    "impact-label",
    "result",
    "evidence",
    "guidance",
    "confidence",
    "status",
    "review-required",
  ];
  const rows = analysis.qualityFindings.map((finding) =>
    row(finding.requirementId, columns, [
      finding.requirementId,
      finding.aliases.join(", "),
      finding.title,
      finding.type,
      finding.impact.weight,
      finding.impact.label,
      finding.result,
      finding.evidence,
      finding.guidance,
      finding.confidence,
      finding.status,
      finding.reviewRequired,
    ]),
  );
  return tab(EXPORT_TAB_DEFINITIONS[2], [
    section("quality-findings", "Report-quality requirements", "table", columns, rows),
  ]);
}

function buildScoring(analysis) {
  const summaryColumns = ["metric", "value"];
  const score = analysis.scoreSummary;
  const summary = [
    ["status", "Status", score.status],
    ["earned-weight", "Earned weight", score.earnedWeight],
    ["possible-weight", "Possible weight", score.possibleWeight],
    ["percentage", "Percentage", score.percentage],
    ["grade", "Grade", score.grade],
  ].map(([rowId, metric, value]) => row(rowId, summaryColumns, [metric, value]));
  const bandColumns = ["grade", "minimum", "maximum"];
  const bands = GRADE_BANDS.map((band) =>
    row(`grade-${band.grade.toLowerCase().replace("-", "-minus")}`, bandColumns, [
      band.grade,
      band.min,
      band.max,
    ]),
  );
  return tab(EXPORT_TAB_DEFINITIONS[3], [
    section("score-summary", "Score summary", "scoring", summaryColumns, summary),
    section("score-bands", "Scoring bands", "table", bandColumns, bands),
  ]);
}

function buildMethodology(analysis) {
  const columns = ["topic", "detail"];
  const provenanceRows = Object.keys(analysis.provenance).map((key) =>
    row(key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`), columns, [
      key,
      analysis.provenance[key],
    ]),
  );
  const methodologyRows = [
    [
      "supported-boundary",
      "Supported boundary",
      "VPAT 2.5 Google Docs, DOCX, and searchable PDF files selected from Google Drive; WCAG tables only; no OCR.",
    ],
    [
      "deterministic-ingestion",
      "Deterministic ingestion",
      "The analyzer identifies eligible WCAG tables and criterion IDs before provider analysis.",
    ],
    [
      "ai-limitations",
      "AI limitations",
      "Analyzer findings support human review and may be incomplete or require verification.",
    ],
    [
      "confidence-threshold",
      "Confidence review threshold",
      "Findings below 70 confidence require review and do not silently change result values.",
    ],
    [
      "privacy-output",
      "Privacy and output",
      "The final spreadsheet is created privately in My Drive/VPAT Analyzer Results.",
    ],
  ].map(([rowId, topic, detail]) => row(rowId, columns, [topic, detail]));
  const disclaimerRows = [
    row("required-disclaimer", columns, [
      "Disclaimer",
      "This analysis is decision support, not a certification of accessibility or legal compliance. Verify findings against the source report and applicable requirements.",
    ]),
  ];
  return tab(EXPORT_TAB_DEFINITIONS[4], [
    section("version-provenance", "Version provenance", "methodology", columns, provenanceRows),
    section("methodology", "Methodology", "methodology", columns, methodologyRows),
    section("disclaimer", "Disclaimer", "disclaimer", columns, disclaimerRows),
  ]);
}

export function buildExportModel(analysisOutput) {
  const analysis = assertAnalysisOutput(analysisOutput);
  const model = {
    schemaVersion: "1.0.0",
    requestId: analysis.requestId,
    outputFolder: "My Drive/VPAT Analyzer Results",
    analysisStatus: analysis.analysisStatus,
    source: { ...analysis.source },
    provenance: { ...analysis.provenance },
    scoreSummary: { ...analysis.scoreSummary },
    tabs: [
      buildOverview(analysis),
      buildLineItems(analysis),
      buildQuality(analysis),
      buildScoring(analysis),
      buildMethodology(analysis),
    ],
  };
  return assertExportModel(deepFreeze(model), analysis.requestId);
}

function validateCell(cell, path, columnId) {
  if (!cell || typeof cell !== "object" || Array.isArray(cell)) {
    invalid("INVALID_EXPORT_MODEL", path, "must be an object");
  }
  requireString(cell.columnId, `${path}.columnId`, {
    constant: columnId,
    code: "INVALID_EXPORT_MODEL",
  });
  if (cell.kind === "literal") {
    requireClosedObject(cell, path, ["columnId", "kind", "value"], "INVALID_EXPORT_MODEL");
    requireNullablePrimitive(cell.value, `${path}.value`, "INVALID_EXPORT_MODEL");
    return;
  }
  if (cell.kind === "trusted-template-formula-reference") {
    requireClosedObject(
      cell,
      path,
      ["columnId", "kind", "templateFormulaId"],
      "INVALID_EXPORT_MODEL",
    );
    requireString(cell.templateFormulaId, `${path}.templateFormulaId`, {
      allowed: TRUSTED_FORMULA_SET,
      code: "INVALID_EXPORT_MODEL",
    });
    return;
  }
  invalid("INVALID_EXPORT_MODEL", `${path}.kind`, "must be a literal or trusted formula reference");
}

export function assertExportModel(model, requestId = model?.requestId) {
  requireClosedObject(
    model,
    "$",
    [
      "schemaVersion",
      "requestId",
      "outputFolder",
      "analysisStatus",
      "source",
      "provenance",
      "scoreSummary",
      "tabs",
    ],
    "INVALID_EXPORT_MODEL",
  );
  requireString(model.schemaVersion, "$.schemaVersion", {
    constant: "1.0.0",
    code: "INVALID_EXPORT_MODEL",
  });
  requireString(model.requestId, "$.requestId", {
    minLength: 1,
    maxLength: 128,
    constant: requestId,
    code: "INVALID_EXPORT_MODEL",
  });
  requireString(model.outputFolder, "$.outputFolder", {
    constant: "My Drive/VPAT Analyzer Results",
    code: "INVALID_EXPORT_MODEL",
  });
  requireString(model.analysisStatus, "$.analysisStatus", {
    allowed: new Set(["Complete", "Incomplete"]),
    code: "INVALID_EXPORT_MODEL",
  });
  requireClosedObject(
    model.source,
    "$.source",
    ["displayName", "sourceType", "vpatVersion", "declaredWcagVersions", "declaredLevels"],
    "INVALID_EXPORT_MODEL",
  );
  requireString(model.source.displayName, "$.source.displayName", {
    minLength: 1,
    maxLength: 512,
    code: "INVALID_EXPORT_MODEL",
  });
  requireString(model.source.sourceType, "$.source.sourceType", {
    allowed: new Set(["google-doc", "docx", "pdf"]),
    code: "INVALID_EXPORT_MODEL",
  });
  requireString(model.source.vpatVersion, "$.source.vpatVersion", {
    constant: "2.5",
    code: "INVALID_EXPORT_MODEL",
  });
  for (const [field, allowed] of [
    ["declaredWcagVersions", new Set(["2.0", "2.1", "2.2"])],
    ["declaredLevels", new Set(["A", "AA", "AAA"])],
  ]) {
    const values = requireArray(model.source[field], `$.source.${field}`, {
      minItems: 1,
      maxItems: 3,
      code: "INVALID_EXPORT_MODEL",
    });
    const seen = new Set();
    values.forEach((value, index) => {
      requireString(value, `$.source.${field}[${index}]`, {
        allowed,
        code: "INVALID_EXPORT_MODEL",
      });
      if (seen.has(value)) {
        invalid("INVALID_EXPORT_MODEL", `$.source.${field}[${index}]`, "must be unique");
      }
      seen.add(value);
    });
  }
  const provenanceKeys = [
    "catalogVersion",
    "rubricVersion",
    "scoringVersion",
    "conformancePromptVersion",
    "qualityPromptVersion",
    "conformanceSchemaVersion",
    "qualitySchemaVersion",
    "ingestionSchemaVersion",
    "exportSchemaVersion",
    "templateVersion",
  ];
  requireClosedObject(model.provenance, "$.provenance", provenanceKeys, "INVALID_EXPORT_MODEL");
  provenanceKeys.forEach((key) =>
    requireString(model.provenance[key], `$.provenance.${key}`, {
      constant: "1.0.0",
      code: "INVALID_EXPORT_MODEL",
    }),
  );
  if (!model.scoreSummary || typeof model.scoreSummary !== "object" || Array.isArray(model.scoreSummary)) {
    invalid("INVALID_EXPORT_MODEL", "$.scoreSummary", "must be an object");
  }
  if (model.scoreSummary.status === "Complete") {
    requireClosedObject(
      model.scoreSummary,
      "$.scoreSummary",
      ["status", "earnedWeight", "possibleWeight", "percentage", "grade"],
      "INVALID_EXPORT_MODEL",
    );
    requireInteger(model.scoreSummary.earnedWeight, "$.scoreSummary.earnedWeight", {
      minimum: 0,
      maximum: 60,
      code: "INVALID_EXPORT_MODEL",
    });
    requireInteger(model.scoreSummary.possibleWeight, "$.scoreSummary.possibleWeight", {
      minimum: 60,
      maximum: 60,
      code: "INVALID_EXPORT_MODEL",
    });
    requireInteger(model.scoreSummary.percentage, "$.scoreSummary.percentage", {
      minimum: 0,
      maximum: 100,
      code: "INVALID_EXPORT_MODEL",
    });
    requireString(model.scoreSummary.grade, "$.scoreSummary.grade", {
      allowed: new Set(["F", "D", "C", "B", "A-", "A"]),
      code: "INVALID_EXPORT_MODEL",
    });
  } else if (model.scoreSummary.status === "Incomplete") {
    requireClosedObject(
      model.scoreSummary,
      "$.scoreSummary",
      ["status", "earnedWeight", "possibleWeight", "percentage", "grade", "incompleteReasons"],
      "INVALID_EXPORT_MODEL",
    );
    for (const key of ["earnedWeight", "possibleWeight", "percentage", "grade"]) {
      if (model.scoreSummary[key] !== null) {
        invalid("INVALID_EXPORT_MODEL", `$.scoreSummary.${key}`, "must be null when incomplete");
      }
    }
    requireArray(model.scoreSummary.incompleteReasons, "$.scoreSummary.incompleteReasons", {
      minItems: 1,
      code: "INVALID_EXPORT_MODEL",
    });
  } else {
    invalid("INVALID_EXPORT_MODEL", "$.scoreSummary.status", "must be Complete or Incomplete");
  }
  const tabs = requireArray(model.tabs, "$.tabs", {
    minItems: 5,
    maxItems: 5,
    code: "INVALID_EXPORT_MODEL",
  });
  tabs.forEach((tabValue, tabIndex) => {
    const expected = EXPORT_TAB_DEFINITIONS[tabIndex];
    requireClosedObject(
      tabValue,
      `$.tabs[${tabIndex}]`,
      ["tabId", "name", "order", "sections"],
      "INVALID_EXPORT_MODEL",
    );
    requireString(tabValue.tabId, `$.tabs[${tabIndex}].tabId`, {
      constant: expected.tabId,
      code: "INVALID_EXPORT_MODEL",
    });
    requireString(tabValue.name, `$.tabs[${tabIndex}].name`, {
      constant: expected.name,
      code: "INVALID_EXPORT_MODEL",
    });
    requireInteger(tabValue.order, `$.tabs[${tabIndex}].order`, {
      minimum: expected.order,
      maximum: expected.order,
      code: "INVALID_EXPORT_MODEL",
    });
    const sections = requireArray(tabValue.sections, `$.tabs[${tabIndex}].sections`, {
      minItems: 1,
      code: "INVALID_EXPORT_MODEL",
    });
    sections.forEach((sectionValue, sectionIndex) => {
      const path = `$.tabs[${tabIndex}].sections[${sectionIndex}]`;
      requireClosedObject(
        sectionValue,
        path,
        ["sectionId", "heading", "kind", "columns", "rows"],
        "INVALID_EXPORT_MODEL",
      );
      const columns = requireArray(sectionValue.columns, `${path}.columns`, {
        minItems: 1,
        code: "INVALID_EXPORT_MODEL",
      });
      if (new Set(columns).size !== columns.length) {
        invalid("INVALID_EXPORT_MODEL", `${path}.columns`, "must be unique");
      }
      columns.forEach((columnId, columnIndex) =>
        requireString(columnId, `${path}.columns[${columnIndex}]`, {
          pattern: COLUMN_ID_PATTERN,
          code: "INVALID_EXPORT_MODEL",
        }),
      );
      requireArray(sectionValue.rows, `${path}.rows`, { code: "INVALID_EXPORT_MODEL" }).forEach(
        (rowValue, rowIndex) => {
          const rowPath = `${path}.rows[${rowIndex}]`;
          requireClosedObject(rowValue, rowPath, ["rowId", "cells"], "INVALID_EXPORT_MODEL");
          requireString(rowValue.rowId, `${rowPath}.rowId`, {
            minLength: 1,
            maxLength: 160,
            code: "INVALID_EXPORT_MODEL",
          });
          const cells = requireArray(rowValue.cells, `${rowPath}.cells`, {
            minItems: columns.length,
            maxItems: columns.length,
            code: "INVALID_EXPORT_MODEL",
          });
          cells.forEach((cell, cellIndex) =>
            validateCell(cell, `${rowPath}.cells[${cellIndex}]`, columns[cellIndex]),
          );
        },
      );
    });
  });
  return model;
}
