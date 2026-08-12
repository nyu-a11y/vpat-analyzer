import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

import {
  canonicalExpectedProjection,
  canonicalPositiveProjection,
  stableStringify,
} from "../proof/stage0/client/proof-contract.mjs";
import {
  AUTHORITATIVE_MIME_TYPES,
  ingestSourceBytes,
  ingestStructuredSource,
} from "../src/ingestion/browser/ingest-bytes.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = resolve(ROOT, "build/stage0");
const APP_SOURCE = resolve(ROOT, "proof/stage0/appsscript");
const FIXTURE_DIR = resolve(ROOT, "tests/fixtures/synthetic/real-format");
const CHUNK_BYTES = 16 * 1024;
const CHUNK_BATCH_SIZE = 16;
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_CHUNKS = Math.ceil(MAX_SOURCE_BYTES / CHUNK_BYTES);
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const INACCESSIBLE_SENTINEL_TEXT = "NYU VPAT Analyzer Stage 0 inaccessible synthetic sentinel v1\n";
const MEMORY_POLICY = Object.freeze({
  sampleIntervalMs: 25,
  maxSampledPeakBytes: 256 * 1024 * 1024,
  maxSampledGrowthBytes: 160 * 1024 * 1024,
  requiredInLiveChrome: true,
  measurement: "sampled-performance-memory-not-an-exact-peak",
});

const PROPERTY_KEYS = Object.freeze({
  "primary-docx": "STAGE0_PRIMARY_DOCX_ID",
  "primary-searchable-pdf": "STAGE0_PRIMARY_PDF_ID",
  "scope-union-docx": "STAGE0_SCOPE_UNION_DOCX_ID",
  "scope-union-pdf": "STAGE0_SCOPE_UNION_PDF_ID",
  "image-only-pdf": "STAGE0_IMAGE_ONLY_PDF_ID",
  "insufficient-text-pdf": "STAGE0_INSUFFICIENT_PDF_ID",
  "malformed-pdf": "STAGE0_MALFORMED_PDF_ID",
  "encrypted-pdf": "STAGE0_ENCRYPTED_PDF_ID",
  "ambiguous-pdf": "STAGE0_AMBIGUOUS_PDF_ID",
  "resource-limit-pdf": "STAGE0_RESOURCE_LIMIT_PDF_ID",
  "resource-limit-docx": "STAGE0_RESOURCE_LIMIT_DOCX_ID",
  "unsupported-version-docx": "STAGE0_VPAT_24_DOCX_ID",
  "no-wcag-docx": "STAGE0_NO_WCAG_DOCX_ID",
  "unsupported-text": "STAGE0_UNSUPPORTED_TEXT_ID",
});

const MIME_TYPES = Object.freeze({
  docx: AUTHORITATIVE_MIME_TYPES.docx,
  pdf: AUTHORITATIVE_MIME_TYPES.pdf,
  unknown: "text/plain",
});

const sha256 = value => createHash("sha256").update(value).digest("hex");
const read = path => readFileSync(resolve(ROOT, path), "utf8");
const replaceOnce = (value, marker, replacement) => {
  if (!value.includes(marker)) throw new Error(`Missing Stage 0 build marker: ${marker}`);
  return value.replace(marker, () => replacement);
};

function decision(classification, reasonCode) {
  return { classification, reasonCode };
}

const DECISIONS = Object.freeze({
  docx: Object.freeze([
    decision("non-wcag", "NON_WCAG_TABLE"),
    decision("wcag", "ELIGIBLE_WCAG_HEADERS"),
    decision("wcag", "ELIGIBLE_WCAG_HEADERS"),
    decision("non-wcag", "SECTION_508_TABLE"),
    decision("non-wcag", "EN_301_549_TABLE"),
    decision("non-wcag", "NON_WCAG_TABLE"),
    decision("non-wcag", "NON_WCAG_TABLE"),
    decision("non-wcag", "BODY_OR_LAYOUT_TABLE"),
  ]),
  pdf: Object.freeze([
    decision("wcag", "ELIGIBLE_WCAG_HEADERS"),
    decision("wcag", "ELIGIBLE_WCAG_HEADERS"),
    decision("wcag", "ELIGIBLE_WCAG_HEADERS"),
    decision("non-wcag", "SECTION_508_TABLE"),
    decision("non-wcag", "EN_301_549_TABLE"),
    decision("non-wcag", "NON_WCAG_TABLE"),
    decision("non-wcag", "NON_WCAG_TABLE"),
  ]),
  "google-doc": Object.freeze([
    decision("non-wcag", "NON_WCAG_TABLE"),
    decision("wcag", "ELIGIBLE_WCAG_HEADERS"),
    decision("wcag", "ELIGIBLE_WCAG_HEADERS"),
    decision("non-wcag", "SECTION_508_TABLE"),
    decision("non-wcag", "EN_301_549_TABLE"),
    decision("non-wcag", "NON_WCAG_TABLE"),
    decision("non-wcag", "NON_WCAG_TABLE"),
    decision("non-wcag", "BODY_OR_LAYOUT_TABLE"),
  ]),
});

function expectedExclusions(expected, duplicateLabel, decisions) {
  const indexOfReason = reasonCode => decisions.findIndex(item => item.reasonCode === reasonCode);
  const enIndex = indexOfReason("EN_301_549_TABLE");
  const ordinaryNonWcagIndices = decisions
    .map((item, index) => ({ item, index }))
    .filter(({ item, index }) =>
      index > enIndex && item.reasonCode === "NON_WCAG_TABLE")
    .map(({ index }) => index);
  const locationByReason = {
    BODY_PROSE: { sourceTableIndex: 0, sourceRowIndex: 3 },
    SECTION_508_ROW: { sourceTableIndex: indexOfReason("SECTION_508_TABLE"), sourceRowIndex: 1 },
    EN_301_549_ROW: { sourceTableIndex: enIndex, sourceRowIndex: 1 },
    UNRECOGNIZED_CRITERION: { sourceTableIndex: ordinaryNonWcagIndices[0], sourceRowIndex: 1 },
    NON_WCAG_ROW: { sourceTableIndex: ordinaryNonWcagIndices[1], sourceRowIndex: 1 },
  };
  return [
    ...expected.excluded.map(item => ({
      ...locationByReason[item.reasonCode],
      reasonCode: item.reasonCode,
      sourceLabel: item.value,
    })),
    {
      sourceTableIndex: decisions.map(item => item.classification).lastIndexOf("wcag"),
      sourceRowIndex: 1,
      reasonCode: "DUPLICATE_CRITERION",
      sourceLabel: duplicateLabel,
    },
  ];
}

function googleProvisionHeaders(table, model) {
  if (!["table-section-508", "table-en-301-549"].includes(table.tableId)) {
    return table.headers;
  }
  const wcagTable = model.candidateTables.find(item => item.tableId === "table-wcag-22-a-aa");
  if (!wcagTable) throw new Error("The Google Doc provision model has no WCAG header source.");
  return wcagTable.headers;
}

function makeGoogleCandidateDocument(model) {
  const tables = [];
  const bodyProse = [
    "Northstar Collaboration Suite",
    "Accessibility Conformance Report · VPAT 2.5",
    ...model.bodyProse,
  ];
  const headings = {
    "table-metadata": "Product and report details",
    "table-wcag-22-a-aa": "WCAG 2.2 Level A and AA",
    "table-section-508": "Revised Section 508",
    "table-en-301-549": "EN 301 549",
    "table-arbitrary-number": "Internal release checklist",
    "table-literal-safety": "Literal source-text safety",
  };
  for (const table of model.candidateTables) {
    bodyProse.push(headings[table.tableId]);
    tables.push({
      tableId: `google-doc-table-${tables.length + 1}`,
      sourceOrder: tables.length,
      context: `Northstar Collaboration Suite > ${headings[table.tableId]}`,
      headers: googleProvisionHeaders(table, model),
      rows: table.rows,
    });
    if (table.tableId === "table-wcag-22-a-aa") {
      bodyProse.push("WCAG 2.2 duplicate-row test");
      tables.push({
        tableId: `google-doc-table-${tables.length + 1}`,
        sourceOrder: tables.length,
        context: "Northstar Collaboration Suite > WCAG 2.2 duplicate-row test",
        headers: table.headers,
        rows: [{
          sourceRowIndex: 1,
          cells: [
            table.rows[0].cells[0],
            "Supports",
            "Synthetic duplicate evidence retained for duplicate detection.",
          ],
        }],
      });
    }
  }
  bodyProse.push("Decorative merged layout table");
  tables.push({
    tableId: `google-doc-table-${tables.length + 1}`,
    sourceOrder: tables.length,
    context: "Northstar Collaboration Suite > Decorative merged layout table",
    headers: ["Synthetic merged layout cell", ""],
    rows: [{ sourceRowIndex: 1, cells: ["Left", "Middle", "Right"] }],
  });
  return {
    bodyProse,
    tables,
    metadata: {
      adapter: "document-app",
      parserVersion: "1.0.0",
      tableCount: tables.length,
      bodyProseCount: bodyProse.length,
    },
  };
}

mkdirSync(OUTPUT, { recursive: true });
const [harnessBundleResult, guardBundleResult] = await Promise.all([
  build({
    entryPoints: [resolve(ROOT, "proof/stage0/client/harness-entry.mjs")],
    bundle: true,
    format: "iife",
    globalName: "VpatIngestion",
    platform: "browser",
    target: ["chrome110", "safari16"],
    minify: true,
    legalComments: "none",
    write: false,
    metafile: true,
    logLevel: "warning",
  }),
  build({
    entryPoints: [resolve(ROOT, "proof/stage0/client/guard-entry.mjs")],
    bundle: true,
    format: "iife",
    globalName: "Stage0NetworkGuard",
    platform: "browser",
    target: ["chrome110", "safari16"],
    minify: true,
    legalComments: "none",
    write: false,
    metafile: true,
    logLevel: "warning",
  }),
]);

const bundle = harnessBundleResult.outputFiles[0].text;
const guardBundle = guardBundleResult.outputFiles[0].text;
const imports = [harnessBundleResult, guardBundleResult]
  .flatMap(result => Object.values(result.metafile.outputs))
  .flatMap(output => output.imports);
if (imports.length) throw new Error(`Stage 0 bundle has external imports: ${JSON.stringify(imports)}`);
if (/sourceMappingURL|<\/script/i.test(`${bundle}\n${guardBundle}`)) {
  throw new Error("Stage 0 bundle contains a forbidden source-map or script-closing sequence.");
}

const fixtureManifestBytes = readFileSync(resolve(FIXTURE_DIR, "manifest.v1.json"));
const appScriptManifestBytes = readFileSync(resolve(APP_SOURCE, "appsscript.example.json"));
const appScriptManifest = JSON.parse(appScriptManifestBytes);
if (
  appScriptManifest.webapp?.access !== "DOMAIN" ||
  appScriptManifest.webapp?.executeAs !== "USER_ACCESSING" ||
  stableStringify(appScriptManifest.oauthScopes) !== stableStringify([
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/documents",
  ]) ||
  appScriptManifest.oauthScopes.some(scope => /script\.external_request/.test(scope))
) throw new Error("The Stage 0 Apps Script manifest does not match the authorized user-executing proof boundary.");
const fixtureManifest = JSON.parse(fixtureManifestBytes);
const expectedRowsBytes = readFileSync(resolve(ROOT, "tests/fixtures/synthetic/expected-wcag-rows.v1.json"));
const googleDocModelBytes = readFileSync(resolve(ROOT, "tests/fixtures/synthetic/google-docs-candidate-tables.v1.json"));
const catalogBytes = readFileSync(resolve(ROOT, "config/vpat-2.5-wcag-criteria.v1.json"));
const expected = JSON.parse(expectedRowsBytes);
const googleDocModel = JSON.parse(googleDocModelBytes);
const catalog = JSON.parse(catalogBytes);
if (
  fixtureManifest.syntheticOnly !== true ||
  fixtureManifest.containsProductionContent !== false ||
  fixtureManifest.sourceSha256 !== sha256(googleDocModelBytes) ||
  fixtureManifest.catalogSha256 !== sha256(catalogBytes)
) throw new Error("The Stage 0 fixture manifest provenance binding is inconsistent.");
const fixtureIds = new Set();
const fixtureFilenames = new Set();
for (const item of fixtureManifest.files) {
  if (fixtureIds.has(item.id) || fixtureFilenames.has(item.filename)) {
    throw new Error("The Stage 0 fixture manifest contains a duplicate ID or filename.");
  }
  fixtureIds.add(item.id);
  fixtureFilenames.add(item.filename);
  const bytes = readFileSync(resolve(FIXTURE_DIR, item.filename));
  if (bytes.length !== item.bytes || sha256(bytes) !== item.sha256) {
    throw new Error(`Committed fixture binding mismatch: ${item.id}`);
  }
}
const wcagModelTable = googleDocModel.candidateTables.find(
  table => table.tableId === "table-wcag-22-a-aa",
);
if (!wcagModelTable || wcagModelTable.rows.length !== expected.rows.length) {
  throw new Error("The independent golden WCAG row model is inconsistent.");
}
const googleOrderedRows = expected.rows.map((row, index) => ({
  rowId: row.rowId,
  criterionId: row.criterionId,
  sourceCriterionLabel: wcagModelTable.rows[index].cells[0],
  sourceConformance: wcagModelTable.rows[index].cells[1],
  sourceRemarks: wcagModelTable.rows[index].cells.slice(2).join("\n"),
  sourceTableIndex: row.sourceTableIndex,
  sourceRowIndex: row.sourceRowIndex,
  aliasMatch: row.aliasMatch,
}));

function officialVpatLabel(row, index) {
  const criterion = catalog.criteria.find(item => item.id === row.criterionId);
  if (!criterion) throw new Error(`Unknown criterion in golden model: ${row.criterionId}`);
  let suffix;
  if (criterion.sc === "4.1.1") {
    suffix = " (Level A) WCAG 2.0 and 2.1 – Always answer ‘Supports’ WCAG 2.2 (obsolete and removed) - Does not apply";
  } else if (stableStringify(criterion.activeIn) === stableStringify(["2.2"])) {
    suffix = ` (Level ${criterion.level} 2.2 only)`;
  } else if (stableStringify(criterion.activeIn) === stableStringify(["2.1", "2.2"])) {
    suffix = ` (Level ${criterion.level} 2.1 and 2.2)`;
  } else {
    suffix = ` (Level ${criterion.level})`;
  }
  const crosswalk = (index + 1) % 9 === 0 && criterion.sc !== "4.1.1"
    ? " Also applies to: EN 301 549 Criteria 9.1.1.1 (Web) Revised Section 508 501 (Web)(Software)"
    : "";
  return `${criterion.sc} ${criterion.title}${suffix}${crosswalk}`;
}

const realFormatOrderedRows = googleOrderedRows.map((row, index) => ({
  ...row,
  sourceCriterionLabel: officialVpatLabel(row, index),
}));

function unionOrderedRows({ sourceType }) {
  const conformanceCycle = ["Supports", "Partially Supports", "Does Not Support", "Not Applicable"];
  const pageBoundaries = sourceType === "pdf" ? [30, 59, 85] : [];
  let sourceTableIndex = sourceType === "docx" ? 1 : 0;
  let sourceRowIndex = 0;
  return catalog.criteria.map((criterion, index) => {
    if (pageBoundaries.includes(index)) {
      sourceTableIndex += 1;
      sourceRowIndex = 0;
    }
    sourceRowIndex += 1;
    let sourceRemarks;
    if (criterion.sc === "4.1.1") {
      sourceRemarks =
        "Synthetic cross-page evidence for SC 4.1.1 begins on one PDF page and continues after " +
        "the repeated WCAG header on the next page. The continuation stays entirely within the " +
        "criterion and remarks columns so the parser can preserve this literal evidence without " +
        "guessing, while the DOCX and searchable PDF remain exact normalized-evidence peers.";
    } else if ((index + 1) % 11 === 0) {
      sourceRemarks =
        `Synthetic wrapped union evidence for SC ${criterion.sc} exercises a variable-height row ` +
        "with enough literal detail to wrap across multiple visual lines without changing the source evidence.";
    } else {
      sourceRemarks = `Synthetic union evidence for SC ${criterion.sc} across the declared WCAG scope.`;
    }
    return {
      rowId: `row-${String(index + 1).padStart(3, "0")}`,
      criterionId: criterion.id,
      sourceCriterionLabel: officialVpatLabel({ criterionId: criterion.id }, index),
      sourceConformance: criterion.sc === "4.1.1" ? "" : conformanceCycle[index % conformanceCycle.length],
      sourceRemarks,
      sourceTableIndex,
      sourceRowIndex,
      aliasMatch: "exact-sc-plus-official-title",
    };
  });
}

const fullUnionDocxRows = unionOrderedRows({ sourceType: "docx" });
const fullUnionPdfRows = unionOrderedRows({ sourceType: "pdf" });
const pdfOrderedRows = realFormatOrderedRows.map((row, index) => ({
  ...row,
  sourceTableIndex: index < 25 ? 0 : 1,
  sourceRowIndex: index < 25 ? index + 1 : index - 24,
}));

function expectedDuplicateRow(sourceCriterionLabel) {
  return {
    rowId: "row-056",
    criterionId: "wcag-sc-1.1.1",
    sourceCriterionLabel,
    sourceConformance: "Supports",
    sourceRemarks: "Synthetic duplicate evidence retained for duplicate detection.",
    sourceTableIndex: 2,
    sourceRowIndex: 1,
    aliasMatch: "exact-sc-plus-official-title",
  };
}

const projectionsByCase = {
  "primary-docx": canonicalExpectedProjection({
    orderedRows: realFormatOrderedRows,
    excludedRows: expectedExclusions(expected, "1.1.1 Non-text Content (Level A)", DECISIONS.docx),
    tableDecisions: DECISIONS.docx,
    duplicateRow: expectedDuplicateRow("1.1.1 Non-text Content (Level A)"),
  }),
  "primary-searchable-pdf": canonicalExpectedProjection({
    orderedRows: pdfOrderedRows,
    excludedRows: expectedExclusions(expected, "1.1.1 Non-text Content (Level A)", DECISIONS.pdf),
    tableDecisions: DECISIONS.pdf,
    duplicateRow: expectedDuplicateRow("1.1.1 Non-text Content (Level A)"),
  }),
  "google-doc-primary": canonicalExpectedProjection({
    orderedRows: googleOrderedRows,
    excludedRows: expectedExclusions(expected, "1.1.1 Non-text Content", DECISIONS["google-doc"]),
    tableDecisions: DECISIONS["google-doc"],
    duplicateRow: expectedDuplicateRow("1.1.1 Non-text Content"),
  }),
  "scope-union-docx": canonicalExpectedProjection({
    orderedRows: fullUnionDocxRows,
    excludedRows: [{
      sourceTableIndex: 0,
      sourceRowIndex: 3,
      sourceLabel: "It contains all 87 immutable catalog criteria, including retired SC 4.1.1, and no production or user content.",
      reasonCode: "BODY_PROSE",
    }],
    tableDecisions: [
      decision("non-wcag", "NON_WCAG_TABLE"),
      decision("wcag", "ELIGIBLE_WCAG_HEADERS"),
    ],
    duplicateRow: null,
    declaredWcagVersions: ["2.0", "2.1", "2.2"],
    declaredLevels: ["A", "AA", "AAA"],
  }),
  "scope-union-pdf": canonicalExpectedProjection({
    orderedRows: fullUnionPdfRows,
    excludedRows: [],
    tableDecisions: Array.from({ length: 4 }, () => decision("wcag", "ELIGIBLE_WCAG_HEADERS")),
    duplicateRow: null,
    declaredWcagVersions: ["2.0", "2.1", "2.2"],
    declaredLevels: ["A", "AA", "AAA"],
  }),
};
const projectionDigestsByCase = Object.fromEntries(
  Object.entries(projectionsByCase).map(([caseKey, projection]) => [
    caseKey,
    sha256(stableStringify(projection)),
  ]),
);

async function verifyPositiveFixture(filename, mimeType, expectedProjection) {
  const result = await ingestSourceBytes({
    requestId: `build-${filename}`,
    bytes: new Uint8Array(readFileSync(resolve(FIXTURE_DIR, filename))),
    mimeType,
    catalog,
    declaredWcagVersions: ["2.2"],
    declaredLevels: ["A", "AA"],
  });
  if (result.status !== "complete") {
    throw new Error(`${filename} is not a complete local golden source: ${result.rejection?.code}`);
  }
  if (stableStringify(canonicalPositiveProjection(result)) !== stableStringify(expectedProjection)) {
    throw new Error(`${filename} does not match the independent canonical golden projection.`);
  }
}

async function verifyFullUnionFixture(filename, mimeType, expectedProjection) {
  const result = await ingestSourceBytes({
    requestId: `build-${filename}`,
    bytes: new Uint8Array(readFileSync(resolve(FIXTURE_DIR, filename))),
    mimeType,
    catalog,
  });
  if (result.status !== "complete") {
    throw new Error(`${filename} is not a complete full-union golden source: ${result.rejection?.code}`);
  }
  if (stableStringify(canonicalPositiveProjection(result)) !== stableStringify(expectedProjection)) {
    const actual = canonicalPositiveProjection(result);
    for (const key of Object.keys(expectedProjection)) {
      if (stableStringify(actual[key]) !== stableStringify(expectedProjection[key])) {
        throw new Error(`${filename} full-union canonical projection mismatch at ${key}.`);
      }
    }
    throw new Error(`${filename} does not match its independent full-union canonical projection.`);
  }
}

await verifyPositiveFixture(
  "northstar-vpat-2.5.docx",
  AUTHORITATIVE_MIME_TYPES.docx,
  projectionsByCase["primary-docx"],
);
await verifyPositiveFixture(
  "northstar-vpat-2.5-searchable.pdf",
  AUTHORITATIVE_MIME_TYPES.pdf,
  projectionsByCase["primary-searchable-pdf"],
);
await verifyFullUnionFixture(
  "northstar-vpat-2.5-scope-union.docx",
  AUTHORITATIVE_MIME_TYPES.docx,
  projectionsByCase["scope-union-docx"],
);
await verifyFullUnionFixture(
  "northstar-vpat-2.5-scope-union.pdf",
  AUTHORITATIVE_MIME_TYPES.pdf,
  projectionsByCase["scope-union-pdf"],
);
const googleCandidateDocument = makeGoogleCandidateDocument(googleDocModel);
const googleModelResult = ingestStructuredSource({
  requestId: "build-google-doc",
  sourceType: "google-doc",
  candidateDocument: googleCandidateDocument,
  catalog,
  declaredWcagVersions: ["2.2"],
  declaredLevels: ["A", "AA"],
});
if (
  googleModelResult.status !== "complete" ||
  stableStringify(canonicalPositiveProjection(googleModelResult)) !==
    stableStringify(projectionsByCase["google-doc-primary"])
) {
  throw new Error("The synthetic Google Doc provision model does not match its canonical golden projection.");
}

const fixtureCases = fixtureManifest.files.map(item => {
  const parserLimits = item.testLimit === "maxPdfPages=2" ? { pdf: { maxPages: 2 } } : {};
  const sourceType = item.sourceType;
  const isPositive = item.expectedStatus === "complete";
  if (isPositive && !projectionDigestsByCase[item.id]) {
    throw new Error(`A positive Stage 0 fixture has no case-specific golden projection: ${item.id}`);
  }
  const parserScope = item.id.startsWith("scope-union-")
    ? { declaredWcagVersions: null, declaredLevels: null }
    : { declaredWcagVersions: ["2.2"], declaredLevels: ["A", "AA"] };
  return {
    caseKey: item.id,
    propertyKey: PROPERTY_KEYS[item.id],
    filename: item.filename,
    sourceType,
    mimeType: MIME_TYPES[sourceType],
    expectedStatus: item.expectedStatus,
    expectedCode: item.expectedCode ?? null,
    expectedBytes: item.bytes,
    expectedSha256: item.sha256,
    expectedChunkCount: Math.ceil(item.bytes / CHUNK_BYTES),
    parserLimits,
    ...parserScope,
    maxObservedDurationMs: sourceType === "pdf" ? 20_000 : 10_000,
    expectedProjectionSha256: isPositive ? projectionDigestsByCase[item.id] : null,
    accessProof: false,
  };
});
fixtureCases.push({
  caseKey: "inaccessible-source",
  propertyKey: "STAGE0_INACCESSIBLE_FILE_ID",
  filename: null,
  sourceType: "unknown",
  mimeType: null,
  expectedStatus: "rejected",
  expectedCode: "SOURCE_INACCESSIBLE",
  expectedBytes: Buffer.byteLength(INACCESSIBLE_SENTINEL_TEXT),
  expectedSha256: sha256(INACCESSIBLE_SENTINEL_TEXT),
  expectedChunkCount: null,
  parserLimits: {},
  maxObservedDurationMs: 10_000,
  expectedProjectionSha256: null,
  accessProof: true,
});
if (fixtureCases.some(item => !item.propertyKey)) {
  throw new Error("Every Stage 0 fixture must have an explicit Script Property binding.");
}

const sourceIdentityInputs = [
  ["bundle", bundle],
  ["guardBundle", guardBundle],
  ["fixtureManifest", fixtureManifestBytes],
  ["appsscriptManifest", appScriptManifestBytes],
  ["goldenProjections", stableStringify(projectionsByCase)],
  ...["Code.gs", "DriveTransport.gs", "DocumentSerializer.gs", "HarnessBinding.template.gs", "ProvisionSyntheticDoc.template.gs", "ProvisionSyntheticFiles.template.gs", "Index.template.html"]
    .map(name => [name, readFileSync(resolve(APP_SOURCE, name))]),
  ["local/Index.template.html", readFileSync(resolve(ROOT, "proof/stage0/local/Index.template.html"))],
  ["buildScript", readFileSync(resolve(ROOT, "scripts/build-stage0-harness.mjs"))],
  ["proofRunner", readFileSync(resolve(ROOT, "scripts/run-stage0-live-proof.mjs"))],
  ["proofSchema", readFileSync(resolve(ROOT, "schemas/stage0-proof-result.v1.schema.json"))],
];
const buildId = sha256(
  sourceIdentityInputs
    .map(([name, value]) => `${name}\u0000${sha256(value)}`)
    .join("\n"),
);
const buildBinding = Object.freeze({
  id: buildId,
  version: "1.0.0",
  bundleSha256: sha256(bundle),
  bundleBytes: Buffer.byteLength(bundle),
  guardBundleSha256: sha256(guardBundle),
  fixtureManifestSha256: sha256(fixtureManifestBytes),
  appsscriptManifestSha256: sha256(appScriptManifestBytes),
  goldenProjectionSpecSha256: sha256(stableStringify(projectionsByCase)),
  buildScriptSha256: sha256(readFileSync(resolve(ROOT, "scripts/build-stage0-harness.mjs"))),
  proofRunnerSha256: sha256(readFileSync(resolve(ROOT, "scripts/run-stage0-live-proof.mjs"))),
  proofSchemaSha256: sha256(readFileSync(resolve(ROOT, "schemas/stage0-proof-result.v1.schema.json"))),
});
const harnessConfig = {
  schemaVersion: "1.0.0",
  syntheticOnly: true,
  build: buildBinding,
  transport: {
    chunkBytes: CHUNK_BYTES,
    chunkBatchSize: CHUNK_BATCH_SIZE,
    maxSourceBytes: MAX_SOURCE_BYTES,
    maxChunks: MAX_CHUNKS,
    maxJsonBytes: MAX_JSON_BYTES,
  },
  memory: MEMORY_POLICY,
  fixtureCases,
  googleDocCase: {
    caseKey: "google-doc-primary",
    sourceType: "google-doc",
    expectedStatus: "complete",
    expectedProjectionSha256: projectionDigestsByCase["google-doc-primary"],
    maxObservedDurationMs: 10_000,
  },
  googleDocOverflowCase: {
    caseKey: "google-doc-overflow",
    sourceType: "google-doc",
    expectedStatus: "rejected",
    expectedCode: "RESOURCE_LIMIT_EXCEEDED",
    expectedProjectionSha256: null,
    maxObservedDurationMs: 10_000,
  },
};
const clientConfig = {
  schemaVersion: harnessConfig.schemaVersion,
  syntheticOnly: harnessConfig.syntheticOnly,
  build: harnessConfig.build,
  transport: harnessConfig.transport,
  memory: harnessConfig.memory,
  fixtureCases: fixtureCases.map(({ propertyKey, filename, ...item }) => item),
  googleDocCase: harnessConfig.googleDocCase,
  googleDocOverflowCase: harnessConfig.googleDocOverflowCase,
};

const fixturePayloads = fixtureCases
  .filter(item => item.filename)
  .map(item => ({
    caseKey: item.caseKey,
    propertyKey: item.propertyKey,
    filename: item.filename,
    mimeType: item.mimeType,
    expectedBytes: item.expectedBytes,
    expectedSha256: item.expectedSha256,
    base64: readFileSync(resolve(FIXTURE_DIR, item.filename)).toString("base64"),
  }));

writeFileSync(resolve(OUTPUT, "ingestion.bundle.js"), bundle);
writeFileSync(resolve(OUTPUT, "network-guard.bundle.js"), guardBundle);

const localCases = fixtureCases
  .filter(item => item.filename)
  .map(item => ({
    ...item,
    bytesBase64: readFileSync(resolve(FIXTURE_DIR, item.filename)).toString("base64"),
  }));
let localHtml = read("proof/stage0/local/Index.template.html");
localHtml = replaceOnce(localHtml, "/*__NETWORK_GUARD_BUNDLE__*/", guardBundle);
localHtml = replaceOnce(localHtml, "/*__INGESTION_BUNDLE__*/", bundle);
localHtml = replaceOnce(localHtml, "/*__HARNESS_CONFIG__*/", JSON.stringify(clientConfig).replaceAll("<", "\\u003c"));
localHtml = replaceOnce(localHtml, "/*__LOCAL_CASES__*/", JSON.stringify(localCases).replaceAll("<", "\\u003c"));
writeFileSync(resolve(OUTPUT, "local-proof.html"), localHtml);

let appHtml = read("proof/stage0/appsscript/Index.template.html");
appHtml = replaceOnce(appHtml, "/*__NETWORK_GUARD_BUNDLE__*/", guardBundle);
appHtml = replaceOnce(appHtml, "/*__INGESTION_BUNDLE__*/", bundle);
appHtml = replaceOnce(appHtml, "/*__HARNESS_CONFIG__*/", JSON.stringify(clientConfig).replaceAll("<", "\\u003c"));
writeFileSync(resolve(OUTPUT, "Index.html"), appHtml);

for (const name of ["Code.gs", "DriveTransport.gs", "DocumentSerializer.gs"]) {
  writeFileSync(resolve(OUTPUT, name), readFileSync(resolve(APP_SOURCE, name)));
}
writeFileSync(
  resolve(OUTPUT, "HarnessBinding.gs"),
  replaceOnce(
    read("proof/stage0/appsscript/HarnessBinding.template.gs"),
    "/*__HARNESS_CONFIG__*/",
    JSON.stringify(harnessConfig),
  ),
);
let provisionSyntheticDoc = read("proof/stage0/appsscript/ProvisionSyntheticDoc.template.gs");
provisionSyntheticDoc = replaceOnce(
  provisionSyntheticDoc,
  "/*__GOOGLE_DOC_MODEL__*/",
  JSON.stringify({
    bodyProse: googleDocModel.bodyProse,
    candidateTables: googleDocModel.candidateTables.map(
      table => ({
        tableId: table.tableId,
        headers: googleProvisionHeaders(table, googleDocModel),
        rows: table.rows,
      }),
    ),
  }),
);
provisionSyntheticDoc = replaceOnce(
  provisionSyntheticDoc,
  "/*__GOOGLE_DOC_CANDIDATE_SHA256__*/",
  JSON.stringify(sha256(stableStringify(googleCandidateDocument))),
);
writeFileSync(resolve(OUTPUT, "ProvisionSyntheticDoc.gs"), provisionSyntheticDoc);
writeFileSync(
  resolve(OUTPUT, "ProvisionSyntheticFiles.gs"),
  replaceOnce(
    replaceOnce(
      read("proof/stage0/appsscript/ProvisionSyntheticFiles.template.gs"),
      "/*__FIXTURE_PAYLOADS__*/",
      JSON.stringify(fixturePayloads),
    ),
    "/*__INACCESSIBLE_SENTINEL_TEXT__*/",
    JSON.stringify(INACCESSIBLE_SENTINEL_TEXT),
  ),
);
writeFileSync(resolve(OUTPUT, "appsscript.json"), appScriptManifestBytes);

const buildManifest = {
  id: "stage0-inline-htmlservice-harness-build",
  version: "1.0.0",
  generatedAt: null,
  build: buildBinding,
  bundle: {
    format: "iife",
    bytes: Buffer.byteLength(bundle),
    sha256: sha256(bundle),
    guardBytes: Buffer.byteLength(guardBundle),
    guardSha256: sha256(guardBundle),
    externalImports: imports.length,
    pdfWorkerStrategy: "inline-in-process WorkerMessageHandler",
  },
  transport: harnessConfig.transport,
  memory: harnessConfig.memory,
  goldenProjectionSha256ByCase: projectionDigestsByCase,
  googleDocCase: harnessConfig.googleDocCase,
  googleDocOverflowCase: harnessConfig.googleDocOverflowCase,
  fixtures: fixtureCases.map(({ filename, propertyKey, ...item }) => item),
  inputs: Object.fromEntries(
    Object.keys(harnessBundleResult.metafile.inputs)
      .sort()
      .map(path => [path, { bytes: harnessBundleResult.metafile.inputs[path].bytes }]),
  ),
};
writeFileSync(resolve(OUTPUT, "build-manifest.json"), `${JSON.stringify(buildManifest, null, 2)}\n`);
console.log(`built Stage 0 harness ${buildBinding.id}: ${buildBinding.bundleBytes} bundle bytes`);
