import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import {
  positiveProjectionDigest,
  validateIngestionResult,
} from "../../proof/stage0/client/proof-contract.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = path => readFileSync(resolve(ROOT, path), "utf8");

test("positive golden projection digest binds normalized literal row evidence", async () => {
  const result = {
    status: "complete",
    rows: [{
      rowId: "row-001",
      criterionId: "wcag-sc-1.1.1",
      sourceCriterionLabel: "1.1.1 Non-text Content",
      sourceConformance: "Supports",
      sourceRemarks: "Committed synthetic evidence.",
      sourceTableIndex: 0,
      sourceRowIndex: 1,
      aliasMatch: "exact-sc-plus-official-title",
    }],
    coverage: {
      declaredWcagVersions: ["2.2"],
      declaredLevels: ["A", "AA"],
      expectedCriterionIds: ["wcag-sc-1.1.1"],
      extractedCriterionIds: ["wcag-sc-1.1.1"],
      missingCriterionIds: [],
    },
    duplicates: [],
    excludedRows: [],
    candidateTables: [{ classification: "wcag", reasonCode: "ELIGIBLE_WCAG_HEADERS" }],
  };
  const original = await positiveProjectionDigest(result);
  const corrupted = await positiveProjectionDigest({
    ...result,
    rows: [{ ...result.rows[0], sourceRemarks: "Corrupted evidence." }],
  });
  assert.match(original, /^[a-f0-9]{64}$/);
  assert.notEqual(corrupted, original);
});

test("inaccessible Drive sentinel returns the exact rejected ingestion contract", () => {
  const context = vm.createContext({});
  vm.runInContext(read("proof/stage0/appsscript/DriveTransport.gs"), context);
  const result = context.stage0InaccessibleResult_("inaccessible-source");
  assert.deepEqual(
    Object.keys(result).sort(),
    ["catalogVersion", "parserVersion", "rejection", "requestId", "schemaVersion", "sourceType", "status"],
  );
  assert.equal(result.rejection.code, "SOURCE_INACCESSIBLE");
  assert.deepEqual(
    validateIngestionResult(result, {
      requestId: "live-inaccessible-source",
      sourceType: "unknown",
    }),
    { valid: true, errorCount: 0 },
  );
});

test("inaccessible Drive proof requires a current build-bound secondary-account attestation", () => {
  const expectedSha256 = "5c900e5f810d27724c88ba6c7112735b91d6d06fbab5f02d439538b780969314";
  const values = new Map([
    ["STAGE0_INACCESSIBLE_FILE_ID", "private-synthetic-sentinel"],
    ["STAGE0_INACCESSIBLE_SENTINEL_BUILD_ID", "build-id"],
    ["STAGE0_INACCESSIBLE_SENTINEL_SHA256", expectedSha256],
    ["STAGE0_INACCESSIBLE_SENTINEL_BYTES", "61"],
    ["STAGE0_INACCESSIBLE_SENTINEL_VERIFIED_AT", String(Date.now())],
  ]);
  const context = vm.createContext({
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: key => values.get(key) ?? null }),
    },
    DriveApp: {
      getFileById: () => { throw new Error("permission denied"); },
    },
  });
  vm.runInContext(`const STAGE0_HARNESS_CONFIG_ = ${JSON.stringify({
    build: { id: "build-id" },
    fixtureCases: [{
      caseKey: "inaccessible-source",
      propertyKey: "STAGE0_INACCESSIBLE_FILE_ID",
      expectedBytes: 61,
      expectedSha256,
      accessProof: true,
    }],
  })};`, context);
  vm.runInContext(read("proof/stage0/appsscript/Code.gs"), context);
  vm.runInContext(read("proof/stage0/appsscript/DriveTransport.gs"), context);
  const result = JSON.parse(JSON.stringify(context.beginFixture("inaccessible-source")));
  assert.equal(result.rejection.code, "SOURCE_INACCESSIBLE");
  values.set("STAGE0_INACCESSIBLE_SENTINEL_VERIFIED_AT", "0");
  assert.throws(
    () => context.beginFixture("inaccessible-source"),
    /current build-bound secondary-account attestation/,
  );
});

test("DocumentApp serializer uses concrete casts and retains Title through H3 plus nearest prose", () => {
  const counters = { paragraph: 0, list: 0, table: 0 };
  const headings = {
    TITLE: "TITLE",
    HEADING1: "HEADING1",
    HEADING2: "HEADING2",
    HEADING3: "HEADING3",
    HEADING4: "HEADING4",
    HEADING5: "HEADING5",
    HEADING6: "HEADING6",
    NORMAL: "NORMAL",
  };
  const paragraph = (text, heading = headings.NORMAL) => ({
    getType: () => "PARAGRAPH",
    asParagraph() {
      counters.paragraph += 1;
      return { getText: () => text, getHeading: () => heading };
    },
  });
  const listItem = text => ({
    getType: () => "LIST_ITEM",
    asListItem() {
      counters.list += 1;
      return { getText: () => text };
    },
  });
  const table = label => ({
    getType: () => "TABLE",
    asTable() {
      counters.table += 1;
      const matrix = [["Criteria", "Conformance", "Remarks"], [label, "Supports", "Evidence"]];
      return {
        getNumRows: () => matrix.length,
        getRow: rowIndex => ({
          getNumCells: () => matrix[rowIndex].length,
          getCell: cellIndex => ({ getText: () => matrix[rowIndex][cellIndex] }),
        }),
      };
    },
  });
  const children = [
    paragraph("Product title", headings.TITLE),
    paragraph("Report", headings.HEADING1),
    paragraph("WCAG", headings.HEADING2),
    paragraph("Nearest prose"),
    table("1.1.1 Non-text Content"),
    paragraph("Level three", headings.HEADING3),
    listItem("Nearest list prose"),
    table("1.2.1 Audio-only and Video-only"),
  ];
  const context = vm.createContext({
    DriveApp: { getFileById: () => ({}) },
    stage0RequirePrivateSyntheticFile_: () => {},
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: () => "synthetic-id" }),
    },
    DocumentApp: {
      ElementType: { PARAGRAPH: "PARAGRAPH", LIST_ITEM: "LIST_ITEM", TABLE: "TABLE" },
      ParagraphHeading: headings,
      openById: () => ({
        getBody: () => ({
          getNumChildren: () => children.length,
          getChild: index => children[index],
        }),
      }),
    },
  });
  const source = read("proof/stage0/appsscript/DocumentSerializer.gs");
  assert.doesNotMatch(source, /\.asText\s*\(/);
  vm.runInContext(source, context);
  const serialized = JSON.parse(JSON.stringify(context.serializeGoogleDocCase()));
  assert.equal(serialized.tables[0].context, "Product title > Report > WCAG > Nearest prose");
  assert.equal(serialized.tables[1].context, "Product title > Report > WCAG > Level three > Nearest list prose");
  assert.equal(counters.paragraph, 5);
  assert.equal(counters.list, 1);
  assert.equal(counters.table, 2);
});

test("DocumentApp serializer rejects rather than slices a 10,001-character synthetic paragraph", () => {
  const overflowText = "X".repeat(10001);
  const child = {
    getType: () => "PARAGRAPH",
    asParagraph: () => ({ getText: () => overflowText, getHeading: () => "NORMAL" }),
  };
  const context = vm.createContext({
    DriveApp: { getFileById: () => ({}) },
    stage0RequirePrivateSyntheticFile_: () => {},
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: key => key === "STAGE0_GOOGLE_DOC_OVERFLOW_ID" ? "synthetic-overflow-id" : null }),
    },
    DocumentApp: {
      ElementType: { PARAGRAPH: "PARAGRAPH", LIST_ITEM: "LIST_ITEM", TABLE: "TABLE" },
      ParagraphHeading: {
        TITLE: "TITLE",
        HEADING1: "HEADING1",
        HEADING2: "HEADING2",
        HEADING3: "HEADING3",
        HEADING4: "HEADING4",
        HEADING5: "HEADING5",
        HEADING6: "HEADING6",
      },
      openById: () => ({
        getBody: () => ({ getNumChildren: () => 1, getChild: () => child }),
      }),
    },
  });
  vm.runInContext(read("proof/stage0/appsscript/DocumentSerializer.gs"), context);
  const result = JSON.parse(JSON.stringify(context.serializeGoogleDocOverflowCase()));
  assert.equal(result.status, "rejected");
  assert.equal(result.rejection.code, "RESOURCE_LIMIT_EXCEEDED");
  assert.deepEqual(
    validateIngestionResult(result, {
      requestId: "live-google-doc-overflow",
      sourceType: "google-doc",
    }),
    { valid: true, errorCount: 0 },
  );
});

test("Stage 0 harness binds deterministic chunks, early guard, CSP, schema validation, and local browser run", () => {
  const build = read("scripts/build-stage0-harness.mjs");
  const code = read("proof/stage0/appsscript/Code.gs");
  const live = read("proof/stage0/appsscript/Index.template.html");
  const runner = read("scripts/run-stage0-live-proof.mjs");
  assert.match(build, /const CHUNK_BYTES = 16 \* 1024;/);
  assert.match(build, /const CHUNK_BATCH_SIZE = 16;/);
  assert.match(code, /const STAGE0_CHUNK_BYTES = 16 \* 1024;/);
  assert.match(code, /const STAGE0_CHUNK_BATCH_SIZE = 16;/);
  assert.match(build, /goldenProjectionSpecSha256/);
  assert.match(build, /fixtureManifestSha256/);
  assert.match(build, /appsscriptManifestSha256/);
  assert.match(build, /\["table-section-508", "table-en-301-549"\]/);
  assert.ok(live.indexOf("/*__NETWORK_GUARD_BUNDLE__*/") < live.indexOf("/*__INGESTION_BUNDLE__*/"));
  assert.match(live, /worker-src 'none'/);
  assert.match(runner, /value === "--local"/);
  assert.match(runner, /context\.route\("\*\*\/\*"/);
  assert.match(runner, /validateAgainstSchema\(summary, proofSchema, proofSchema\)/);
  assert.match(runner, /const flags = privacyFlags\(summaryCore\)/);
  assert.match(live, /serializeGoogleDocOverflowCase/);
  const appManifest = JSON.parse(read("proof/stage0/appsscript/appsscript.example.json"));
  assert.deepEqual(appManifest.oauthScopes, [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/documents",
  ]);
  assert.deepEqual(appManifest.webapp, { access: "DOMAIN", executeAs: "USER_ACCESSING" });
  assert.equal(appManifest.oauthScopes.some(scope => scope.includes("script.external_request")), false);
  for (const path of [
    "proof/stage0/appsscript/Code.gs",
    "proof/stage0/appsscript/DriveTransport.gs",
    "proof/stage0/appsscript/DocumentSerializer.gs",
    "proof/stage0/appsscript/ProvisionSyntheticDoc.template.gs",
    "proof/stage0/appsscript/ProvisionSyntheticFiles.template.gs",
  ]) assert.doesNotMatch(read(path), /UrlFetchApp|Portkey|Gemini/i);
});

test("provisioning runbook requires a real inaccessible two-account sentinel and honest limits", () => {
  const runbook = read("proof/stage0/appsscript/README.md");
  assert.match(runbook, /Choose two NYU test accounts\. Account B owns and deploys/);
  assert.match(runbook, /provisionStage0InaccessibleSentinelAsSecondaryAccount_/);
  assert.match(read("proof/stage0/appsscript/ProvisionSyntheticFiles.template.gs"), /STAGE0_INACCESSIBLE_SENTINEL_TEXT_/);
  const provisionDoc = read("proof/stage0/appsscript/ProvisionSyntheticDoc.template.gs");
  const provisionFiles = read("proof/stage0/appsscript/ProvisionSyntheticFiles.template.gs");
  const driveTransport = read("proof/stage0/appsscript/DriveTransport.gs");
  assert.match(provisionDoc, /provisionStage0SyntheticGoogleDocOverflow_/);
  assert.match(provisionDoc, /STAGE0_GOOGLE_DOC_CANDIDATE_SHA256_/);
  assert.match(provisionDoc, /stage0SerializeGoogleDocumentById_/);
  assert.match(provisionFiles, /stage0RequirePrivateSyntheticFile_/);
  assert.match(driveTransport, /DriveApp\.Access\.PRIVATE/);
  assert.doesNotMatch(provisionDoc, /function provisionStage0SyntheticGoogleDoc\(/);
  assert.doesNotMatch(provisionFiles, /function provisionStage0SyntheticBinaryFixtures\(/);
  assert.match(runbook, /executes as the user accessing it/);
  assert.match(runbook, /observed and non-preemptive/);
  assert.match(runbook, /not an exact peak measurement/);
});
