import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCallbackCommand,
  finalizeExportCommand,
  markExportFailureCommand,
  reconcileRequestCommand,
  retryAnalysisCommand,
  retryExportCommand,
  selectSourceCommand,
  startAnalysisCommand,
} from "../../../src/runtime/analysis-runtime.mjs";
import {
  REQUEST_STATES,
  TRANSITION_TABLE,
  RequestStateError,
  createRequestRecord,
  transitionRequest,
} from "../../../src/runtime/request-state.mjs";

function event(record, to, eventId = `event-${to}`) {
  return {
    requestId: record.requestId,
    eventId,
    occurredAt: "2026-08-12T12:00:00.000Z",
    to,
  };
}

function advance(record, to, options = {}) {
  return transitionRequest(record, { ...event(record, to, options.eventId), ...options }).record;
}

function createPorts(initial = []) {
  const records = new Map(initial.map((record) => [record.requestId, record]));
  let activeRequestId = initial.at(-1)?.requestId ?? null;
  let sequence = 0;
  const calls = { export: 0, receipt: 0 };
  const receipts = new Map();
  const ports = {
    requestStore: {
      async create(record) {
        if (records.has(record.requestId)) return false;
        records.set(record.requestId, record);
        activeRequestId = record.requestId;
        return true;
      },
      async get(requestId) { return records.get(requestId) ?? null; },
      async getActiveRequestId() { return activeRequestId; },
      async compareAndSet(requestId, expectedSequence, next) {
        const current = records.get(requestId);
        if (!current || current.sequence !== expectedSequence) return false;
        records.set(requestId, next);
        return true;
      },
    },
    id: { async nextRequestId() { sequence += 1; return `request-${sequence}`; } },
    clock: { async now() { return "2026-08-12T12:00:00.000Z"; } },
    export: {
      async getReceipt(requestId) { calls.receipt += 1; return receipts.get(requestId) ?? null; },
      async createExactlyOnce(requestId) {
        calls.export += 1;
        if (!receipts.has(requestId)) {
          receipts.set(requestId, Object.freeze({
            requestId,
            spreadsheetRef: "synthetic-sheet",
            spreadsheetUrl: "https://docs.google.com/spreadsheets/d/synthetic",
            completedAt: "2026-08-12T12:00:00.000Z",
            templateVersion: "1.0.0",
          }));
        }
        return receipts.get(requestId);
      },
    },
  };
  return { ports, records, receipts, calls, setActiveRequestId(value) { activeRequestId = value; } };
}

function validFrozenArtifacts(requestId) {
  const analysisOutput = Object.freeze({
    schemaVersion: "1.0.0",
    requestId,
    wcagFindings: Object.freeze([]),
    qualityFindings: Object.freeze([]),
  });
  const section = Object.freeze({
    sectionId: "summary",
    heading: "Summary",
    kind: "summary",
    columns: Object.freeze(["value"]),
    rows: Object.freeze([Object.freeze({
      rowId: "row",
      cells: Object.freeze([Object.freeze({ columnId: "value", kind: "literal", value: "ok" })]),
    })]),
  });
  const definitions = [
    ["overview", "Overview", 1],
    ["line-item-review", "Line-item Review", 2],
    ["quality-requirements", "Quality Requirements", 3],
    ["scoring", "Scoring", 4],
    ["methodology-disclaimer", "Methodology & disclaimer", 5],
  ];
  const exportModel = Object.freeze({
    schemaVersion: "1.0.0",
    requestId,
    outputFolder: "My Drive/VPAT Analyzer Results",
    analysisStatus: "Complete",
    source: Object.freeze({
      displayName: "Synthetic VPAT",
      sourceType: "docx",
      vpatVersion: "2.5",
      declaredWcagVersions: Object.freeze(["2.2"]),
      declaredLevels: Object.freeze(["A"]),
    }),
    provenance: Object.freeze({
      catalogVersion: "1.0.0",
      rubricVersion: "1.0.0",
      scoringVersion: "1.0.0",
      conformancePromptVersion: "1.0.0",
      qualityPromptVersion: "1.0.0",
      conformanceSchemaVersion: "1.0.0",
      qualitySchemaVersion: "1.0.0",
      ingestionSchemaVersion: "1.0.0",
      exportSchemaVersion: "1.0.0",
      templateVersion: "1.0.0",
    }),
    scoreSummary: Object.freeze({
      status: "Complete",
      earnedWeight: 60,
      possibleWeight: 60,
      percentage: 100,
      grade: "A",
    }),
    tabs: Object.freeze(definitions.map(([tabId, name, order]) => Object.freeze({ tabId, name, order, sections: Object.freeze([section]) }))),
  });
  return { analysisOutput, exportModel };
}

test("transition table is closed over exact state values and forbids undocumented edges", () => {
  assert.deepEqual(Object.keys(TRANSITION_TABLE), REQUEST_STATES);
  assert.equal(TRANSITION_TABLE.success.includes("preparing_results"), false);
  let record = createRequestRecord({ requestId: "r", sourceRef: "drive:r", createdAt: "t" });
  assert.throws(() => transitionRequest(record, event(record, "success")), RequestStateError);
  record = advance(record, "selected");
  assert.equal(record.status, "selected");
});

test("success and attached artifacts require matching request identity", () => {
  let record = createRequestRecord({ requestId: "r-identity", sourceRef: "drive:r", createdAt: "t" });
  record = advance(record, "selected");
  record = advance(record, "preparing_source");
  record = advance(record, "extracting_wcag_tables");
  record = advance(record, "checking_coverage");
  record = advance(record, "analyzing_report_quality");
  record = advance(record, "preparing_results");
  assert.throws(() => advance(record, "success"), /receipt/);
  assert.throws(
    () => advance(record, "success", { exportReceipt: { requestId: "other" } }),
    /match the request/,
  );
  assert.equal(
    advance(record, "success", { exportReceipt: { requestId: record.requestId } }).status,
    "success",
  );
});

test("stale and duplicate callbacks are rejected before persistence or effects", async () => {
  let record = createRequestRecord({ requestId: "current", sourceRef: "drive:r", createdAt: "t" });
  record = advance(record, "selected");
  const harness = createPorts([record]);
  const stale = await applyCallbackCommand(harness.ports, event({ requestId: "old" }, "preparing_source", "old-event"));
  assert.deepEqual(stale.effects, []);
  assert.equal(stale.disposition, "stale");
  const accepted = await applyCallbackCommand(harness.ports, event(record, "preparing_source", "begin"));
  const duplicate = await applyCallbackCommand(harness.ports, event(record, "preparing_source", "begin"));
  assert.equal(accepted.disposition, "accepted");
  assert.equal(duplicate.disposition, "duplicate");
  assert.deepEqual(duplicate.effects, []);
  assert.equal(harness.records.get("current").sequence, accepted.record.sequence);
});

test("selection creates new stable identity and analysis retries retain bounded lineage", async () => {
  const harness = createPorts();
  const selected = await selectSourceCommand(harness.ports, { sourceRef: "drive:file" });
  const requestId = selected.record.requestId;
  let record = advance(selected.record, "selected", { eventId: "validated" });
  harness.records.set(requestId, record);
  const started = await startAnalysisCommand(harness.ports, {
    requestId,
    eventId: "start",
    occurredAt: "t1",
  });
  assert.equal(started.record.attempts.source, 1);
  record = advance(started.record, "retryable_failure", {
    eventId: "provider-timeout",
    operation: "source",
  });
  harness.records.set(requestId, record);
  const retried = await retryAnalysisCommand(harness.ports, {
    requestId,
    eventId: "retry-1",
    occurredAt: "t2",
  });
  assert.equal(retried.record.requestId, requestId);
  assert.equal(retried.record.status, "preparing_source");
  assert.equal(retried.record.attempts.source, 2);
  record = advance(retried.record, "retryable_failure", {
    eventId: "provider-timeout-2",
    operation: "source",
  });
  harness.records.set(requestId, record);
  await assert.rejects(
    retryAnalysisCommand(harness.ports, { requestId, eventId: "retry-2", occurredAt: "t3" }),
    /retry limit/,
  );
});

test("export retry checks receipt first and never calls create or analysis ports", async () => {
  let record = createRequestRecord({ requestId: "export-r", sourceRef: "drive:r", createdAt: "t" });
  record = advance(record, "selected");
  record = advance(record, "preparing_source");
  record = advance(record, "extracting_wcag_tables");
  record = advance(record, "checking_coverage");
  record = advance(record, "analyzing_report_quality");
  const artifacts = validFrozenArtifacts(record.requestId);
  record = advance(record, "preparing_results", { ...artifacts });
  record = advance(record, "export_retryable_failure", { operation: "export" });
  const harness = createPorts([record]);
  const receipt = { requestId: record.requestId, spreadsheetRef: "existing" };
  harness.receipts.set(record.requestId, receipt);
  const result = await retryExportCommand(harness.ports, {
    requestId: record.requestId,
    eventId: "retry-export",
    occurredAt: "t2",
  });
  assert.equal(result.record.status, "success");
  assert.equal(result.record.exportReceipt, receipt);
  assert.equal(harness.calls.receipt, 1);
  assert.equal(harness.calls.export, 0);
});

test("export-only retry retains the identical frozen artifacts and finalization is exactly once", async () => {
  let record = createRequestRecord({ requestId: "export-r2", sourceRef: "drive:r", createdAt: "t" });
  record = advance(record, "selected");
  record = advance(record, "preparing_source");
  record = advance(record, "extracting_wcag_tables");
  record = advance(record, "checking_coverage");
  record = advance(record, "analyzing_report_quality");
  const artifacts = validFrozenArtifacts(record.requestId);
  record = advance(record, "preparing_results", { ...artifacts });
  record = advance(record, "export_retryable_failure", { operation: "export" });
  const harness = createPorts([record]);
  const retry = await retryExportCommand(harness.ports, {
    requestId: record.requestId,
    eventId: "retry-export",
    occurredAt: "t2",
  });
  assert.equal(retry.record.analysisOutput, artifacts.analysisOutput);
  assert.equal(retry.record.exportModel, artifacts.exportModel);
  const final = await finalizeExportCommand(harness.ports, {
    requestId: record.requestId,
    eventId: "final-export",
    occurredAt: "t3",
  });
  assert.equal(final.record.status, "success");
  assert.equal(harness.calls.export, 1);
  await assert.rejects(
    finalizeExportCommand(harness.ports, {
      requestId: record.requestId,
      eventId: "final-export-duplicate",
      occurredAt: "t4",
    }),
    /not available/,
  );
  assert.equal(harness.calls.export, 1);
});

test("export failure requires immutable artifacts and reconciliation cannot mint a second export", async () => {
  let record = createRequestRecord({ requestId: "export-r3", sourceRef: "drive:r", createdAt: "t" });
  record = advance(record, "selected");
  record = advance(record, "preparing_source");
  record = advance(record, "extracting_wcag_tables");
  record = advance(record, "checking_coverage");
  record = advance(record, "analyzing_report_quality");
  const artifacts = validFrozenArtifacts(record.requestId);
  record = advance(record, "preparing_results", { ...artifacts });
  const harness = createPorts([record]);
  const failed = await markExportFailureCommand(harness.ports, {
    requestId: record.requestId,
    eventId: "export-failed",
    occurredAt: "t2",
  });
  const receipt = { requestId: record.requestId, spreadsheetRef: "ambiguous-existing" };
  harness.receipts.set(record.requestId, receipt);
  const reconciled = await reconcileRequestCommand(harness.ports, {
    requestId: record.requestId,
    eventId: "reconcile",
    occurredAt: "t3",
  });
  assert.equal(failed.record.status, "export_retryable_failure");
  assert.equal(reconciled.record.status, "success");
  assert.equal(harness.calls.export, 0);
});
