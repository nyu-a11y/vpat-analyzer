import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  PdfParserError,
  parsePdfBytes,
} from "../../../src/ingestion/browser/pdf-parser.mjs";
import { ingestCandidateDocument } from "../../../src/ingestion/core/ingest-candidate-document.mjs";

const REAL_FIXTURE_DIR = fileURLToPath(
  new URL("../../fixtures/synthetic/real-format/", import.meta.url),
);

async function realFixture(filename) {
  return new Uint8Array(await readFile(`${REAL_FIXTURE_DIR}${filename}`));
}

function buildPdf({ lines = [], secondPage = false, extraObjects = [], trailerEntries = "" } = {}) {
  const content = lines
    .map(({ x, y, text }) => `BT /F1 10 Tf 1 0 0 1 ${x} ${y} Tm (${escapePdf(text)}) Tj ET`)
    .join("\n");
  const pageKids = secondPage ? "3 0 R 6 0 R" : "3 0 R";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageKids}] /Count ${secondPage ? 2 : 1} >>`,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    ...(secondPage
      ? ["<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>"]
      : []),
    ...extraObjects,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${trailerEntries} >>\nstartxref\n${xref}\n%%EOF`;
  return new Uint8Array(Buffer.from(pdf, "latin1"));
}

function escapePdf(value) {
  return value
    .replace(/([\\()])/g, "\\$1")
    .replaceAll("•", "\\225");
}

function buildMultiPagePdf(pageLines) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "",
  ];
  const pageIds = [];
  const fontId = 3 + pageLines.length * 2;
  pageLines.forEach(lines => {
    const pageId = objects.length + 1;
    const contentId = pageId + 1;
    pageIds.push(pageId);
    const content = lines
      .map(({ x, y, text }) => `BT /F1 10 Tf 1 0 0 1 ${x} ${y} Tm (${escapePdf(text)}) Tj ET`)
      .join("\n");
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`);
  });
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Uint8Array(Buffer.from(pdf, "latin1"));
}

const wcagHeaderLines = (y = 720) => [
  { x: 50, y, text: "Criteria" },
  { x: 240, y, text: "Conformance Level" },
  { x: 390, y, text: "Remarks and Explanations" },
];

function tablePdf() {
  return buildPdf({ lines: [
    { x: 50, y: 750, text: "WCAG 2.2 A and AA" },
    { x: 50, y: 720, text: "Criteria" },
    { x: 240, y: 720, text: "Conformance Level" },
    { x: 390, y: 720, text: "Remarks and Explanations" },
    { x: 50, y: 690, text: "1.1.1 Non-text Content" },
    { x: 240, y: 690, text: "Supports" },
    { x: 390, y: 690, text: "Synthetic evidence." },
    { x: 50, y: 670, text: "1.2.1 Audio-only and Video-only" },
    { x: 240, y: 670, text: "Partially Supports" },
    { x: 390, y: 670, text: "Needs review." },
    { x: 390, y: 658, text: "Continuation text." },
    { x: 50, y: 620, text: "Body prose after the table." },
  ] });
}

async function expectCode(promise, code, stage) {
  await assert.rejects(promise, error => {
    assert.ok(error instanceof PdfParserError);
    assert.equal(error.code, code);
    if (stage !== undefined) assert.equal(error.stage, stage);
    assert.match(error.safeMessage, /\S/);
    return true;
  });
}

test("requires Uint8Array input and installs the in-process worker handler", async () => {
  assert.equal(typeof globalThis.pdfjsWorker?.WorkerMessageHandler?.setup, "function");
  await assert.rejects(parsePdfBytes(new ArrayBuffer(8)), /Uint8Array/);
});

test("installs the Safari-compatible Promise.withResolvers primitive before PDF.js", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(Promise, "withResolvers");
  delete Promise.withResolvers;
  try {
    await import(`../../../src/ingestion/browser/runtime-polyfills.mjs?test=${Date.now()}`);
    const capability = Promise.withResolvers();
    capability.resolve("ready");
    assert.equal(await capability.promise, "ready");
    assert.equal(typeof capability.reject, "function");
  } finally {
    if (descriptor) Object.defineProperty(Promise, "withResolvers", descriptor);
    else delete Promise.withResolvers;
  }
});

test("reconstructs a deterministic neutral three-column candidate table", async () => {
  const bytes = tablePdf();
  const originalLength = bytes.byteLength;
  const result = await parsePdfBytes(bytes);
  assert.equal(bytes.byteLength, originalLength, "caller-owned bytes must not be transferred/detached");
  assert.equal(result.metadata.pdfjsVersion, "4.10.38");
  assert.equal(result.metadata.pageCount, 1);
  assert.deepEqual(result.tables, [{
    tableId: "pdf-p1-table-1",
    sourceOrder: 0,
    context: "WCAG 2.2 A and AA",
    headers: ["Criteria", "Conformance Level", "Remarks and Explanations"],
    rows: [
      {
        sourceRowIndex: 1,
        cells: ["1.1.1 Non-text Content", "Supports", "Synthetic evidence."],
      },
      {
        sourceRowIndex: 2,
        cells: [
          "1.2.1 Audio-only and Video-only",
          "Partially Supports",
          "Needs review. Continuation text.",
        ],
      },
    ],
  }]);
  assert.deepEqual(result.bodyProse, ["WCAG 2.2 A and AA", "Body prose after the table."]);
});

test("retains an incomplete criterion row and ignores cross-standard four-part numbers", async () => {
  const bytes = buildPdf({ lines: [
    { x: 50, y: 750, text: "WCAG 2.2 A and AA" },
    { x: 50, y: 720, text: "Criteria" },
    { x: 240, y: 720, text: "Conformance Level" },
    { x: 390, y: 720, text: "Remarks and Explanations" },
    { x: 50, y: 690, text: "1.1.1 Non-text Content (Level A) Also applies to: EN 301 549 Criteria 9.1.1.1" },
  ] });
  const result = await parsePdfBytes(bytes);
  assert.deepEqual(result.tables[0].rows[0].cells, [
    "1.1.1 Non-text Content (Level A) Also applies to: EN 301 549 Criteria 9.1.1.1",
    "",
    "",
  ]);
});

test("removes only recognized page-margin artifacts from row evidence", async () => {
  for (const footer of ["Page 1 of 3", "1 of 3", "Page 1 / 3", "Confidential", "2026-08-12"]) {
    const bytes = buildPdf({ lines: [
      { x: 50, y: 750, text: "WCAG 2.2 A and AA" },
      { x: 50, y: 720, text: "Criteria" },
      { x: 240, y: 720, text: "Conformance Level" },
      { x: 390, y: 720, text: "Remarks and Explanations" },
      { x: 50, y: 690, text: "1.1.1 Non-text Content" },
      { x: 240, y: 690, text: "Supports" },
      { x: 390, y: 690, text: "Synthetic evidence." },
      { x: 240, y: 30, text: footer },
    ] });
    const result = await parsePdfBytes(bytes);
    assert.deepEqual(result.tables[0].rows[0].cells, [
      "1.1.1 Non-text Content",
      "Supports",
      "Synthetic evidence.",
    ]);
  }
});

test("stitches only an immediately adjacent repeated WCAG table page", async () => {
  const bytes = buildMultiPagePdf([
    [
      { x: 50, y: 750, text: "WCAG 2.2 Report" },
      ...wcagHeaderLines(),
      { x: 50, y: 690, text: "1.1.1 Non-text Content" },
      { x: 240, y: 690, text: "Supports" },
      { x: 390, y: 690, text: "Page one evidence." },
    ],
    [
      ...wcagHeaderLines(),
      { x: 390, y: 690, text: "Continued evidence." },
      { x: 50, y: 670, text: "1.2.1 Audio-only and Video-only" },
      { x: 240, y: 670, text: "Supports" },
      { x: 390, y: 670, text: "Second row." },
    ],
  ]);
  const result = await parsePdfBytes(bytes);
  assert.equal(result.tables[0].rows[0].cells[2], "Page one evidence. Continued evidence.");
});

test("preserves an International-edition crosswalk across a repeated header and standard transition", async () => {
  const bytes = buildMultiPagePdf([
    [
      { x: 50, y: 750, text: "WCAG 2.x Report" },
      ...wcagHeaderLines(),
      { x: 50, y: 690, text: "1.1.1 Non-text Content (Level A)" },
      { x: 50, y: 675, text: "Also applies to:" },
      { x: 50, y: 660, text: "EN 301 549 Criteria" },
      { x: 50, y: 645, text: "• 9.1.1.1 (Web)" },
      { x: 240, y: 645, text: "Web:" },
      { x: 390, y: 645, text: "Web:" },
    ],
    [
      ...wcagHeaderLines(),
      { x: 50, y: 690, text: "• Revised Section 508" },
      { x: 50, y: 675, text: "• 501 (Web)(Software)" },
      { x: 240, y: 675, text: "Electronic Docs:" },
      { x: 390, y: 675, text: "Electronic Docs:" },
      { x: 50, y: 640, text: "Table 2: Success Criteria, Level AA" },
      { x: 50, y: 625, text: "Notes:" },
      ...wcagHeaderLines(600),
      { x: 50, y: 570, text: "1.2.4 Captions (Live) (Level AA)" },
      { x: 240, y: 570, text: "Supports" },
      { x: 390, y: 570, text: "Second WCAG table evidence." },
    ],
    [
      { x: 50, y: 750, text: "Revised Section 508 Report" },
      ...wcagHeaderLines(),
      { x: 50, y: 690, text: "302.1 Without Vision" },
      { x: 240, y: 690, text: "Supports" },
      { x: 390, y: 690, text: "Non-WCAG evidence stays excluded." },
    ],
  ]);

  const parsed = await parsePdfBytes(bytes);
  const wcagTables = parsed.tables.filter(table => /wcag/i.test(table.context));
  assert.deepEqual(wcagTables.map(table => table.rows.length), [1, 0, 1]);
  assert.deepEqual(wcagTables[0].rows[0].cells, [
    "1.1.1 Non-text Content (Level A) Also applies to: EN 301 549 Criteria 9.1.1.1 (Web) Revised Section 508 501 (Web)(Software)",
    "Web: Electronic Docs:",
    "Web: Electronic Docs:",
  ]);
  assert.deepEqual(wcagTables[2].rows[0].cells, [
    "1.2.4 Captions (Live) (Level AA)",
    "Supports",
    "Second WCAG table evidence.",
  ]);
  assert.equal(parsed.tables.at(-1).context, "Revised Section 508 Report");
  assert.equal(parsed.tables.at(-1).rows[0].cells[0], "302.1 Without Vision");

  const catalog = JSON.parse(
    await readFile(new URL("../../../config/vpat-2.5-wcag-criteria.v1.json", import.meta.url), "utf8"),
  );
  const ingested = ingestCandidateDocument({
    requestId: "pdf-international-crosswalk",
    sourceType: "pdf",
    candidateDocument: parsed,
    catalog,
    declaredWcagVersions: ["2.2"],
    declaredLevels: ["A", "AA"],
  });
  assert.equal(ingested.status, "complete");
  assert.deepEqual(
    ingested.rows.map(({ criterionId }) => criterionId),
    ["wcag-sc-1.1.1", "wcag-sc-1.2.4"],
  );
  assert.ok(ingested.excludedRows.some(({ reasonCode }) => reasonCode === "SECTION_508_ROW"));
});

test("rejects an orphan WCAG continuation after an intervening standard section", async () => {
  const bytes = buildMultiPagePdf([
    [
      { x: 50, y: 750, text: "WCAG 2.2 Report" },
      ...wcagHeaderLines(),
      { x: 50, y: 690, text: "1.1.1 Non-text Content" },
      { x: 240, y: 690, text: "Supports" },
      { x: 390, y: 690, text: "Page one evidence." },
    ],
    [
      { x: 50, y: 750, text: "Revised Section 508 Report" },
      ...wcagHeaderLines(),
      { x: 50, y: 690, text: "502.2.1 User Control" },
      { x: 240, y: 690, text: "Supports" },
      { x: 390, y: 690, text: "Section 508 evidence." },
    ],
    [
      { x: 50, y: 750, text: "WCAG 2.2 Report" },
      ...wcagHeaderLines(),
      { x: 390, y: 690, text: "ORPHAN SHOULD NOT STITCH" },
      { x: 50, y: 670, text: "1.2.1 Audio-only and Video-only" },
      { x: 240, y: 670, text: "Supports" },
      { x: 390, y: 670, text: "Second row." },
    ],
  ]);
  await expectCode(parsePdfBytes(bytes), "WCAG_ROWS_AMBIGUOUS", "table-detection");
});

test("maps empty text layers to PDF_NON_SEARCHABLE", async () => {
  await expectCode(parsePdfBytes(buildPdf()), "PDF_NON_SEARCHABLE", "container-parse");
});

test("maps searchable text without a trustworthy table to PDF_INSUFFICIENT_TEXT", async () => {
  const bytes = buildPdf({ lines: [
    { x: 50, y: 700, text: "This searchable PDF contains prose but no recoverable table." },
  ] });
  await expectCode(parsePdfBytes(bytes), "PDF_INSUFFICIENT_TEXT", "table-detection");
});

test("rejects ambiguous table geometry rather than guessing", async () => {
  const bytes = buildPdf({ lines: [
    { x: 50, y: 720, text: "Criteria" },
    { x: 240, y: 720, text: "Conformance Level" },
    { x: 390, y: 720, text: "Remarks and Explanations" },
    { x: 50, y: 690, text: "1.1.1 Non-text Content" },
    { x: 240, y: 690, text: "Supports" },
    { x: 315, y: 690, text: "Equidistant evidence" },
  ] });
  await expectCode(parsePdfBytes(bytes), "WCAG_ROWS_AMBIGUOUS", "table-detection");
});

test("maps malformed data to SOURCE_MALFORMED", async () => {
  await expectCode(
    parsePdfBytes(new Uint8Array([1, 2, 3, 4, 5])),
    "SOURCE_MALFORMED",
    "container-parse",
  );
});

test("maps password-protected PDFs to PDF_ENCRYPTED without collecting a password", async () => {
  const bytes = buildPdf({
    lines: [{ x: 50, y: 700, text: "Encrypted synthetic text" }],
    extraObjects: [
      `<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${"00".repeat(32)}> /U <${"00".repeat(32)}> /P -4 >>`,
    ],
    trailerEntries: `/Encrypt 6 0 R /ID [<${"11".repeat(16)}><${"11".repeat(16)}>]`,
  });
  await expectCode(parsePdfBytes(bytes), "PDF_ENCRYPTED", "container-parse");
});

test("enforces byte, page-text-item, character, row, and cell limits", async t => {
  await t.test("bytes", () => expectCode(
    parsePdfBytes(tablePdf(), { limits: { maxBytes: 8 } }),
    "RESOURCE_LIMIT_EXCEEDED",
    "resource-limit",
  ));
  await t.test("items", () => expectCode(
    parsePdfBytes(tablePdf(), { limits: { maxTextItems: 2 } }),
    "RESOURCE_LIMIT_EXCEEDED",
    "resource-limit",
  ));
  await t.test("pages", () => expectCode(
    parsePdfBytes(buildPdf({ secondPage: true, lines: [
      { x: 50, y: 700, text: "Synthetic searchable text on two pages." },
    ] }), { limits: { maxPages: 1 } }),
    "RESOURCE_LIMIT_EXCEEDED",
    "resource-limit",
  ));
  await t.test("characters", () => expectCode(
    parsePdfBytes(tablePdf(), { limits: { maxCharacters: 20 } }),
    "RESOURCE_LIMIT_EXCEEDED",
    "resource-limit",
  ));
  await t.test("rows", () => expectCode(
    parsePdfBytes(tablePdf(), { limits: { maxRows: 1 } }),
    "RESOURCE_LIMIT_EXCEEDED",
    "resource-limit",
  ));
  await t.test("cell text", () => expectCode(
    parsePdfBytes(tablePdf(), { limits: { maxCellCharacters: 10 } }),
    "RESOURCE_LIMIT_EXCEEDED",
    "resource-limit",
  ));
  await t.test("work units", () => expectCode(
    parsePdfBytes(tablePdf(), { limits: { maxWorkUnits: 1 } }),
    "RESOURCE_LIMIT_EXCEEDED",
    "resource-limit",
  ));
  await t.test("processing time", async () => {
    const originalNow = performance.now;
    let simulatedMilliseconds = 0;
    performance.now = () => {
      simulatedMilliseconds += 2;
      return simulatedMilliseconds;
    };
    try {
      await expectCode(
        parsePdfBytes(tablePdf(), { limits: { maxProcessingMilliseconds: 1 } }),
        "RESOURCE_LIMIT_EXCEEDED",
        "resource-limit",
      );
    } finally {
      performance.now = originalNow;
    }
  });
});

test("does not accept URL/network/render/OCR configuration through its public API", async () => {
  await assert.rejects(
    parsePdfBytes(tablePdf(), { limits: { workerSrc: "https://example.test/worker.js" } }),
    /Unknown PDF parser limit/,
  );
});

test("performs no network fetch while parsing inline bytes", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("Unexpected network request");
  };
  try {
    await parsePdfBytes(tablePdf());
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(fetchCalls, 0);
});

test("parses the committed searchable PDF into WCAG and explicit non-WCAG candidate tables", async () => {
  const result = await parsePdfBytes(await realFixture("northstar-vpat-2.5-searchable.pdf"));
  assert.equal(result.metadata.pageCount, 3);
  assert.deepEqual(
    result.tables.map(table => ({ context: table.context, headers: table.headers, rows: table.rows.length })),
    [
      { context: "WCAG 2.2 Level A and AA", headers: ["Criteria", "Conformance Level", "Remarks and Explanations"], rows: 25 },
      { context: "WCAG 2.2 Level A and AA", headers: ["Criteria", "Conformance Level", "Remarks and Explanations"], rows: 30 },
      { context: "WCAG 2.2 duplicate-row test", headers: ["Criteria", "Conformance Level", "Remarks and Explanations"], rows: 1 },
      { context: "Revised Section 508", headers: ["Revised Section 508 Provision", "Conformance", "Remarks"], rows: 1 },
      { context: "EN 301 549", headers: ["EN 301 549 clause", "Conformance", "Remarks"], rows: 1 },
      { context: "Internal release checklist", headers: ["Item", "Status"], rows: 1 },
      { context: "Literal source-text safety", headers: ["Note", "Literal text"], rows: 1 },
    ],
  );
  assert.equal(result.tables.slice(0, 3).reduce((sum, table) => sum + table.rows.length, 0), 56);
  assert.equal(result.tables.at(-1).rows[0].cells[1], "=1+1");

  const catalog = JSON.parse(
    await readFile(new URL("../../../config/vpat-2.5-wcag-criteria.v1.json", import.meta.url), "utf8"),
  );
  const ingested = ingestCandidateDocument({
    requestId: "pdf-parser-integration",
    sourceType: "pdf",
    candidateDocument: result,
    catalog,
    declaredWcagVersions: ["2.2"],
    declaredLevels: ["A", "AA"],
  });
  assert.equal(ingested.status, "complete");
  assert.equal(ingested.rows.length, 55);
  assert.equal(ingested.duplicates.length, 1);
  assert.deepEqual(
    ingested.candidateTables.map(table => table.reasonCode),
    [
      "ELIGIBLE_WCAG_HEADERS",
      "ELIGIBLE_WCAG_HEADERS",
      "ELIGIBLE_WCAG_HEADERS",
      "SECTION_508_TABLE",
      "EN_301_549_TABLE",
      "NON_WCAG_TABLE",
      "NON_WCAG_TABLE",
    ],
  );
  assert.deepEqual(
    new Set(ingested.excludedRows.map(row => row.reasonCode)),
    new Set([
      "BODY_PROSE",
      "DUPLICATE_CRITERION",
      "SECTION_508_ROW",
      "EN_301_549_ROW",
      "UNRECOGNIZED_CRITERION",
      "NON_WCAG_ROW",
    ]),
  );
});

test("maps committed negative PDF fixtures to their stable rejection codes", async t => {
  const cases = [
    ["northstar-vpat-2.5-image-only.pdf", "PDF_NON_SEARCHABLE"],
    ["northstar-vpat-2.5-insufficient-text.pdf", "PDF_INSUFFICIENT_TEXT"],
    ["northstar-vpat-2.5-malformed.pdf", "SOURCE_MALFORMED"],
    ["northstar-vpat-2.5-encrypted.pdf", "PDF_ENCRYPTED"],
    ["northstar-vpat-2.5-ambiguous.pdf", "WCAG_ROWS_AMBIGUOUS"],
  ];
  for (const [filename, code] of cases) {
    await t.test(code, async () => {
      const bytes = await realFixture(filename);
      await expectCode(parsePdfBytes(bytes), code, code === "RESOURCE_LIMIT_EXCEEDED" ? "resource-limit" : undefined);
    });
  }
  await t.test("RESOURCE_LIMIT_EXCEEDED", async () => {
    const bytes = await realFixture("northstar-vpat-2.5-resource-limit.pdf");
    await expectCode(parsePdfBytes(bytes, { limits: { maxPages: 2 } }), "RESOURCE_LIMIT_EXCEEDED", "resource-limit");
  });
});
