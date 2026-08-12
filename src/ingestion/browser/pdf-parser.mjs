import "./runtime-polyfills.mjs";
import "./pdfjs-inline-worker.mjs";
import { getDocument, version as pdfjsVersion } from "pdfjs-dist/build/pdf.mjs";

const DEFAULT_LIMITS = Object.freeze({
  maxBytes: 20 * 1024 * 1024,
  maxPages: 200,
  maxTextItems: 25_000,
  maxCharacters: 2_000_000,
  maxRows: 5_000,
  maxTables: 100,
  maxCellCharacters: 20_000,
  maxWorkUnits: 1_000_000,
  maxProcessingMilliseconds: 15_000,
  minSearchableCharacters: 16,
  lineYTolerance: 2.5,
  columnXTolerance: 18,
  maxRowGap: 2.6,
});

const HEADER_DEFINITIONS = Object.freeze([
  {
    patterns: [
      /^criteria(?:\s*\([^)]*\))?$/i,
      /^conformance(?:\s+level)?$/i,
      /^remarks(?:\s+and\s+explanations)?$/i,
    ],
    rowMode: "wcag",
  },
  {
    patterns: [/^revised section 508 provision$/i, /^conformance$/i, /^remarks$/i],
    rowMode: "generic",
  },
  {
    patterns: [/^en 301 549 clause$/i, /^conformance$/i, /^remarks$/i],
    rowMode: "generic",
  },
  { patterns: [/^item$/i, /^status$/i], rowMode: "generic" },
  { patterns: [/^note$/i, /^literal text$/i], rowMode: "generic" },
]);

const TABLE_START_PATTERN = /^(?:[1-4]\.)\d+\.\d+(?=$|[^\d.])/;
const PAGE_ARTIFACT_PATTERN = /^(?:page\s+)?\d+\s*(?:of|\/)\s*\d+$/i;
const COMMON_MARGIN_ARTIFACT_PATTERN = /^(?:confidential|internal use only|\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4})$/i;
const CRITERION_LIST_MARKER_PATTERN = /^[●•▪◦]\s*/;
const WCAG_TABLE_SECTION_PATTERN = /^table\s+\d+\s*:\s*success criteria\b/i;
const INTEGER_LIMITS = new Set([
  "maxBytes",
  "maxPages",
  "maxTextItems",
  "maxCharacters",
  "maxRows",
  "maxTables",
  "maxCellCharacters",
  "minSearchableCharacters",
  "maxWorkUnits",
  "maxProcessingMilliseconds",
]);

export class PdfParserError extends Error {
  constructor(code, stage, safeMessage, options = undefined) {
    super(safeMessage, options);
    this.name = "PdfParserError";
    this.code = code;
    this.stage = stage;
    this.safeMessage = safeMessage;
  }
}

export async function parsePdfBytes(bytes, { limits } = {}) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError("parsePdfBytes requires a Uint8Array.");
  }

  const activeLimits = normalizeLimits(limits);
  const budget = createBudget(activeLimits);
  enforceLimit(bytes.byteLength <= activeLimits.maxBytes, "PDF byte limit exceeded.");

  let loadingTask;
  let document;
  try {
    loadingTask = getDocument({
      data: bytes.slice(),
      disableAutoFetch: true,
      disableFontFace: true,
      disableRange: true,
      enableXfa: false,
      isEvalSupported: false,
      useSystemFonts: false,
      useWorkerFetch: false,
      verbosity: 0,
    });
    loadingTask.onPassword = updatePassword => {
      updatePassword(
        new PdfParserError(
          "PDF_ENCRYPTED",
          "container-parse",
          "The PDF is password-protected and cannot be analyzed.",
        ),
      );
    };
    document = await loadingTask.promise;
    enforceLimit(document.numPages <= activeLimits.maxPages, "PDF page limit exceeded.");

    const pages = [];
    let textItemCount = 0;
    let characterCount = 0;

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      consumeWork(budget, 1);
      const page = await document.getPage(pageNumber);
      const textContent = await page.getTextContent({
        disableNormalization: false,
        includeMarkedContent: false,
      });
      const items = textContent.items
        .filter(item => typeof item?.str === "string" && item.str.trim())
        .map((item, sourceOrder) => normalizeTextItem(item, pageNumber, sourceOrder));
      consumeWork(budget, items.length);

      textItemCount += items.length;
      characterCount += items.reduce((sum, item) => sum + item.text.length, 0);
      enforceLimit(textItemCount <= activeLimits.maxTextItems, "PDF text-item limit exceeded.");
      enforceLimit(characterCount <= activeLimits.maxCharacters, "PDF text limit exceeded.");
      pages.push({ pageNumber, items });
      page.cleanup();
    }

    if (characterCount === 0) {
      throw new PdfParserError(
        "PDF_NON_SEARCHABLE",
        "container-parse",
        "The PDF does not contain searchable text.",
      );
    }
    if (characterCount < activeLimits.minSearchableCharacters) {
      throw new PdfParserError(
        "PDF_INSUFFICIENT_TEXT",
        "table-detection",
        "The PDF does not contain enough searchable text to recover WCAG tables.",
      );
    }

    const reconstructed = reconstructCandidateDocument(pages, activeLimits, budget);
    if (reconstructed.ambiguous) {
      throw new PdfParserError(
        "WCAG_ROWS_AMBIGUOUS",
        "table-detection",
        "The PDF text geometry does not support trustworthy WCAG table recovery.",
      );
    }
    if (reconstructed.tables.length === 0) {
      throw new PdfParserError(
        "PDF_INSUFFICIENT_TEXT",
        "table-detection",
        "No trustworthy three-column WCAG table could be recovered from the PDF text layer.",
      );
    }

    return {
      bodyProse: reconstructed.bodyProse,
      tables: reconstructed.tables,
      metadata: {
        adapter: "pdfjs-text-geometry",
        parserVersion: "1.0.0",
        pdfjsVersion,
        pageCount: document.numPages,
        textItemCount,
        characterCount,
      },
    };
  } catch (error) {
    throw mapPdfError(error);
  } finally {
    await document?.destroy().catch(() => {});
    await loadingTask?.destroy().catch(() => {});
  }
}

function normalizeLimits(overrides) {
  if (overrides === undefined) return DEFAULT_LIMITS;
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    throw new TypeError("limits must be an object.");
  }
  const unknown = Object.keys(overrides).filter(key => !(key in DEFAULT_LIMITS));
  if (unknown.length) throw new TypeError(`Unknown PDF parser limit: ${unknown[0]}`);
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isFinite(value) || value <= 0 || (INTEGER_LIMITS.has(key) && !Number.isInteger(value))) {
      throw new TypeError(`PDF parser limit ${key} must be a positive ${INTEGER_LIMITS.has(key) ? "integer" : "finite number"}.`);
    }
  }
  return Object.freeze(limits);
}

function normalizeTextItem(item, pageNumber, sourceOrder) {
  const transform = Array.isArray(item.transform) ? item.transform : [];
  const x = Number(transform[4]);
  const y = Number(transform[5]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new PdfParserError(
      "WCAG_ROWS_AMBIGUOUS",
      "table-detection",
      "The PDF contains text without reliable geometry.",
    );
  }
  return {
    text: collapseWhitespace(item.str),
    x,
    y,
    width: Number.isFinite(item.width) ? Math.max(0, item.width) : 0,
    height: Number.isFinite(item.height) && item.height > 0
      ? item.height
      : Math.max(Math.abs(Number(transform[0])) || 0, Math.abs(Number(transform[3])) || 0, 1),
    pageNumber,
    sourceOrder,
  };
}

function reconstructCandidateDocument(pages, limits, budget) {
  const bodyProse = [];
  const tables = [];
  let ambiguous = false;

  let priorSectionContext = "";
  for (const page of pages) {
    const lines = groupLines(page.items, limits.lineYTolerance, budget);
    const pageResult = reconstructPage(lines, page.pageNumber, tables.length, limits, priorSectionContext, budget);
    bodyProse.push(...pageResult.bodyProse);
    for (const table of pageResult.tables) {
      const leadingCells = table.leadingContinuation;
      delete table.leadingContinuation;
      if (leadingCells?.some(Boolean)) {
        const priorTable = tables.at(-1);
        const priorPage = Number(priorTable?.tableId.match(/^pdf-p(\d+)-/)?.[1]);
        const priorRow = priorTable?.rows.at(-1);
        if (
          priorPage !== page.pageNumber - 1 ||
          !sameTableContinuation(priorTable, table) ||
          !priorRow
        ) {
          ambiguous = true;
        } else {
          appendCells(priorRow.cells, leadingCells, limits);
        }
      }
      tables.push(table);
    }
    ambiguous ||= pageResult.ambiguous;
    enforceLimit(tables.length <= limits.maxTables, "PDF table limit exceeded.");
    enforceLimit(
      tables.reduce((sum, table) => sum + table.rows.length, 0) <= limits.maxRows,
      "PDF table-row limit exceeded.",
    );
    priorSectionContext = pageResult.sectionContext || priorSectionContext;
  }
  return { bodyProse, tables, ambiguous };
}

function reconstructPage(lines, pageNumber, initialTableOrder, limits, priorSectionContext = "", budget) {
  const bodyProse = [];
  const tables = [];
  const consumed = new Set();
  let ambiguous = false;
  const pageSectionContext = lines
    .map(joinLine)
    .find(text => /\b(?:wcag\s+2(?:\.x|\.0|\.1|\.2)?\s+report|revised\s+section\s+508\s+report|en\s+301\s+549\s+report)\b/i.test(text)) || "";

  for (let index = 0; index < lines.length; index += 1) {
    consumeWork(budget, 1);
    if (consumed.has(index)) continue;
    const header = findHeader(lines, index, limits);
    if (!header) continue;
    if (header.ambiguous) {
      ambiguous = true;
      continue;
    }

    const context = nearestContext(lines, header.startIndex, consumed, header.cells) || pageSectionContext || priorSectionContext;
    const rowMode = /\b(?:section\s+508|en\s+301\s+549)\b/i.test(context)
      ? "generic"
      : header.rowMode;
    const rowResult = collectRows(
      lines,
      header.endIndex + 1,
      header.anchors,
      rowMode,
      limits,
      budget,
    );
    if (rowResult.ambiguous) {
      ambiguous = true;
      continue;
    }
    if (rowResult.rows.length === 0 && !rowResult.leadingCells.some(Boolean)) continue;

    for (let used = header.startIndex; used <= rowResult.endIndex; used += 1) consumed.add(used);
    const sourceOrder = initialTableOrder + tables.length;
    tables.push({
      tableId: `pdf-p${pageNumber}-table-${sourceOrder + 1}`,
      sourceOrder,
      context,
      headers: header.cells,
      rows: rowResult.rows,
      leadingContinuation: rowResult.leadingCells,
    });
    index = rowResult.endIndex;
  }

  lines.forEach((line, index) => {
    if (!consumed.has(index)) {
      const text = joinLine(line);
      if (text) bodyProse.push(text);
    }
  });
  return { bodyProse, tables, ambiguous, sectionContext: pageSectionContext };
}

function groupLines(items, tolerance, budget) {
  const sorted = [...items].sort(
    (a, b) => b.y - a.y || a.x - b.x || a.sourceOrder - b.sourceOrder,
  );
  const lines = [];
  let line = null;
  for (const item of sorted) {
    consumeWork(budget, 1);
    if (!line || Math.abs(line.y - item.y) > tolerance) {
      line = { y: item.y, items: [] };
      lines.push(line);
    }
    if (line) {
      line.items.push(item);
      line.y = (line.y * (line.items.length - 1) + item.y) / line.items.length;
    }
  }
  for (const line of lines) line.items.sort((a, b) => a.x - b.x || a.sourceOrder - b.sourceOrder);
  return lines.sort((a, b) => b.y - a.y);
}

function findHeader(lines, startIndex, limits) {
  const candidates = lines[startIndex].items.map(item => ({ ...item, lineIndex: startIndex }));

  for (const definition of HEADER_DEFINITIONS) {
    const matches = definition.patterns.map(pattern => candidates.filter(item => pattern.test(item.text)));
    if (matches.some(group => group.length > 1)) return { ambiguous: true };
    if (matches.some(group => group.length === 0)) continue;
    const anchors = matches.map(group => group[0]).sort((a, b) => a.x - b.x);
    if (!anchors.every((anchor, index) => definition.patterns[index].test(anchor.text))) continue;
    if (!strictlyIncreasing(anchors.map(anchor => anchor.x), limits.columnXTolerance)) {
      return { ambiguous: true };
    }
    return {
      ambiguous: false,
      cells: anchors.map(anchor => anchor.text),
      anchors: anchors.map(anchor => anchor.x),
      rowMode: definition.rowMode,
      startIndex: Math.min(...anchors.map(anchor => anchor.lineIndex)),
      endIndex: Math.max(...anchors.map(anchor => anchor.lineIndex)),
    };
  }
  return null;
}

function collectRows(lines, startIndex, anchors, rowMode, limits, budget) {
  const rows = [];
  let index = startIndex;
  let endIndex = startIndex - 1;
  let blankLines = 0;
  let current = null;
  const leadingCells = anchors.map(() => "");

  for (; index < lines.length; index += 1) {
    consumeWork(budget, 1 + lines[index].items.length);
    if (WCAG_TABLE_SECTION_PATTERN.test(joinLine(lines[index]))) break;
    if (findHeader(lines, index, limits)) break;
    if (current && index > startIndex) {
      const previousLine = lines[index - 1];
      const textHeight = Math.max(
        ...previousLine.items.map(item => item.height),
        1,
      );
      if (previousLine.y - lines[index].y > textHeight * limits.maxRowGap) break;
    }
    const mapped = mapLineToColumns(lines[index], anchors, limits.columnXTolerance);
    if (isMarginArtifactLine(lines[index], mapped.cells)) {
      endIndex = index;
      continue;
    }
    if (mapped.ambiguous) return { rows: [], endIndex, ambiguous: true };
    if (mapped.cells.some(cell => cell.length > limits.maxCellCharacters)) {
      enforceLimit(false, "PDF cell-text limit exceeded.");
    }
    repairCriterionBoundary(mapped.cells);
    const startsRow = rowMode === "wcag"
      ? TABLE_START_PATTERN.test(mapped.cells[0])
      : Boolean(mapped.cells[0]);
    const anyContent = mapped.cells.some(Boolean);

    if (!anyContent) {
      blankLines += 1;
      if (blankLines > limits.maxRowGap) break;
      continue;
    }
    blankLines = 0;

    if (startsRow) {
      if (rowMode === "wcag" && hasMultipleScTokens(mapped.cells[0])) {
        return { rows: [], leadingCells, endIndex, ambiguous: true };
      }
      current = {
        sourceRowIndex: rows.length + 1,
        cells: mapped.cells,
      };
      rows.push(current);
      endIndex = index;
      continue;
    }

    if (!current) {
      // A repeated header can begin a page with wrapped cells from the prior
      // logical row. Preserve the physical columns and let the page-level
      // stitcher attach them only to a compatible immediately prior table.
      if (rowMode === "wcag") {
        appendCells(leadingCells, mapped.cells, limits);
        endIndex = index;
        continue;
      }
      break;
    }
    // A wrapped physical line can continue multiple logical cells at once.
    // The official International edition uses this for its criterion
    // crosswalk plus distinct conformance/remarks sub-dimensions. Geometry,
    // the exact SC boundary, and section identity keep the append bounded.
    appendCells(current.cells, mapped.cells, limits);
    endIndex = index;
  }
  return { rows, leadingCells, endIndex, ambiguous: false };
}

function mapLineToColumns(line, anchors, tolerance) {
  const cells = anchors.map(() => []);
  for (const item of line.items) {
    const distances = anchors.map(anchor => Math.abs(item.x - anchor));
    const ranked = distances.map((distance, index) => ({ distance, index })).sort((a, b) => a.distance - b.distance);
    let midpointColumn = anchors.length - 1;
    for (let index = 0; index < anchors.length - 1; index += 1) {
      if (item.x < (anchors[index] + anchors[index + 1]) / 2) {
        midpointColumn = index;
        break;
      }
    }
    if (
      ranked[1].distance - ranked[0].distance <= tolerance &&
      ranked[0].index !== midpointColumn
    ) {
      return { ambiguous: true, cells: [] };
    }
    const columnItem = midpointColumn === 0
      ? { ...item, text: item.text.replace(CRITERION_LIST_MARKER_PATTERN, "") }
      : item;
    if (columnItem.text) cells[midpointColumn].push(columnItem);
  }
  return {
    ambiguous: false,
    cells: cells.map(items => {
      const value = collapseWhitespace(items.map(item => item.text).join(" "));
      return PAGE_ARTIFACT_PATTERN.test(value) ? "" : value;
    }),
  };
}

function isMarginArtifactLine(line, cells) {
  const text = collapseWhitespace(cells.filter(Boolean).join(" "));
  if (!text) return false;
  if (!(PAGE_ARTIFACT_PATTERN.test(text) || COMMON_MARGIN_ARTIFACT_PATTERN.test(text))) return false;
  // VPAT tables live in the page body. A recognized artifact is ignored only
  // in a conservative top/bottom margin band; elsewhere it remains evidence.
  return line.y < 55 || line.y > 740;
}

function appendCells(target, additions, limits) {
  additions.forEach((cell, cellIndex) => {
    if (!cell) return;
    const combined = collapseWhitespace(`${target[cellIndex] ?? ""} ${cell}`);
    if (combined.length > limits.maxCellCharacters) {
      enforceLimit(false, "PDF cell-text limit exceeded.");
    }
    target[cellIndex] = combined;
  });
}

function repairCriterionBoundary(cells) {
  if (!TABLE_START_PATTERN.test(cells[0] ?? "") || /\(level\s+(?:a|aa|aaa)\b/i.test(cells[0])) return;
  const match = (cells[1] ?? "").match(/^(\(level\s+(?:aaa|aa|a)(?:\s+2\.[012](?:\s+(?:only|and\s+2\.[012]))?)?\))(?:\s+(.*))?$/i);
  if (!match) return;
  cells[0] = collapseWhitespace(`${cells[0]} ${match[1]}`);
  cells[1] = collapseWhitespace(match[2] ?? "");
}

function sectionIdentity(value) {
  if (/\b(?:revised\s+)?section\s+508\b/i.test(value)) return "section-508";
  if (/\ben\s+301\s+549\b/i.test(value)) return "en-301-549";
  if (/\bwcag\b/i.test(value)) return "wcag";
  return "generic";
}

function sameTableContinuation(left, right) {
  return left.headers.length === right.headers.length &&
    left.headers.every((header, index) => header === right.headers[index]) &&
    sectionIdentity(left.context) === sectionIdentity(right.context);
}

function nearestContext(lines, headerIndex, consumed, headerCells) {
  const candidates = [];
  const genericOfficialHeaders = /^criteria$/i.test(headerCells?.[0] || '');
  let soughtSectionIdentity = false;
  for (let index = headerIndex - 1; index >= 0; index -= 1) {
    if (consumed.has(index)) continue;
    const text = joinLine(lines[index]);
    if (!text) continue;
    candidates.unshift(text);
    const nearest = candidates.at(-1);
    const seekSectionIdentity = genericOfficialHeaders && /^(?:notes?:|table\s+\d)/i.test(nearest);
    soughtSectionIdentity ||= seekSectionIdentity;
    if (seekSectionIdentity && /\b(?:wcag|section\s+508|en\s+301\s+549)\b/i.test(text)) {
      return collapseWhitespace(candidates.join(' | ')).slice(0, 2000);
    }
    if (!seekSectionIdentity) return nearest;
    if (candidates.length >= 12) break;
  }
  return soughtSectionIdentity ? "" : candidates.at(-1) || "";
}

function joinLine(line) {
  return collapseWhitespace(line.items.map(item => item.text).join(" "));
}

function collapseWhitespace(value) {
  return value.normalize("NFKC").replace(/[\t\r\n ]+/g, " ").trim();
}

function hasMultipleScTokens(value) {
  return (value.match(/(?:^|[^\d.])(?:[1-4]\.)\d+\.\d+(?=$|[^\d.])/g) || []).length > 1;
}

function strictlyIncreasing(values, minimumGap) {
  return values.every((value, index) => index === 0 || value - values[index - 1] > minimumGap);
}

function enforceLimit(condition, safeMessage) {
  if (!condition) {
    throw new PdfParserError("RESOURCE_LIMIT_EXCEEDED", "resource-limit", safeMessage);
  }
}

function createBudget(limits) {
  return { remaining: limits.maxWorkUnits, deadline: performance.now() + limits.maxProcessingMilliseconds };
}

function consumeWork(budget, units) {
  budget.remaining -= units;
  enforceLimit(budget.remaining >= 0, "PDF work-unit limit exceeded.");
  enforceLimit(performance.now() <= budget.deadline, "PDF processing-time limit exceeded.");
}

function mapPdfError(error) {
  if (error instanceof PdfParserError) return error;
  if (error?.name === "PasswordException" || /password/i.test(error?.message || "")) {
    return new PdfParserError(
      "PDF_ENCRYPTED",
      "container-parse",
      "The PDF is password-protected and cannot be analyzed.",
      { cause: error },
    );
  }
  return new PdfParserError(
    "SOURCE_MALFORMED",
    "container-parse",
    "The PDF is malformed or cannot be read safely.",
    { cause: error },
  );
}
