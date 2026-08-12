import { assertAnalysisOutput } from "../domain/analysis-output.mjs";
import { assertExportModel } from "../domain/export-model.mjs";
import { deepFreeze, requireString } from "../domain/json-data.mjs";
import {
  RequestStateError,
  classifyCallback,
  createRequestRecord,
  transitionRequest,
  validateRequestRecord,
} from "./request-state.mjs";

export class RuntimeCommandError extends Error {
  constructor(code, safeMessage) {
    super(safeMessage);
    this.name = "RuntimeCommandError";
    this.code = code;
    this.safeMessage = safeMessage;
  }
}

function requiredPort(ports, name, method) {
  const port = ports[name];
  if (!port || typeof port[method] !== "function") {
    throw new RuntimeCommandError("PORT_UNAVAILABLE", `${name}.${method} is unavailable.`);
  }
  return port;
}

function validateRequestId(requestId) {
  requireString(requestId, "$.requestId", {
    minLength: 1,
    maxLength: 128,
    code: "INVALID_COMMAND",
  });
}

async function loadRecord(ports, requestId) {
  validateRequestId(requestId);
  const store = requiredPort(ports, "requestStore", "get");
  const record = await store.get(requestId);
  if (!record) throw new RuntimeCommandError("REQUEST_NOT_FOUND", "The request was not found.");
  validateRequestRecord(record);
  return record;
}

async function saveTransition(ports, previous, event) {
  const classified = classifyCallback(previous, event);
  if (classified) return classified;
  const result = transitionRequest(previous, event);
  if (result.disposition !== "accepted") return result;
  const store = requiredPort(ports, "requestStore", "compareAndSet");
  const saved = await store.compareAndSet(previous.requestId, previous.sequence, result.record);
  if (!saved) {
    return deepFreeze({ disposition: "conflict", record: previous, effects: [] });
  }
  return result;
}

function eventEnvelope(record, options) {
  return {
    requestId: record.requestId,
    eventId: options.eventId,
    occurredAt: options.occurredAt,
    to: options.to,
    operation: options.operation,
    incrementAttempt: options.incrementAttempt ?? false,
    effect: options.effect,
    analysisOutput: options.analysisOutput,
    exportModel: options.exportModel,
    exportReceipt: options.exportReceipt,
    failedState: options.failedState,
  };
}

export async function selectSourceCommand(ports, command) {
  requireString(command.sourceRef, "$.sourceRef", {
    minLength: 1,
    maxLength: 512,
    code: "INVALID_COMMAND",
  });
  const idPort = requiredPort(ports, "id", "nextRequestId");
  const clock = requiredPort(ports, "clock", "now");
  const store = requiredPort(ports, "requestStore", "create");
  const requestId = await idPort.nextRequestId();
  const now = await clock.now();
  const record = createRequestRecord({
    requestId,
    sourceRef: command.sourceRef,
    createdAt: now,
    retryLimits: command.retryLimits,
  });
  const created = await store.create(record);
  if (!created) throw new RuntimeCommandError("REQUEST_ID_CONFLICT", "A request ID conflict occurred.");
  return deepFreeze({ disposition: "accepted", record, effects: ["validate-source"] });
}

export async function applyCallbackCommand(ports, callback) {
  const activeRequestId = await requiredPort(ports, "requestStore", "getActiveRequestId").getActiveRequestId();
  if (callback.requestId !== activeRequestId) {
    return deepFreeze({ disposition: "stale", record: null, effects: [] });
  }
  const record = await loadRecord(ports, callback.requestId);
  if (callback.analysisOutput !== undefined) {
    assertAnalysisOutput(callback.analysisOutput, record.requestId);
  }
  if (callback.exportModel !== undefined) {
    assertExportModel(callback.exportModel, record.requestId);
  }
  if (callback.to === "success" && callback.exportReceipt?.requestId !== record.requestId) {
    throw new RuntimeCommandError("EXPORT_RECEIPT_MISMATCH", "The export receipt does not match the request.");
  }
  return saveTransition(ports, record, callback);
}

export async function startAnalysisCommand(ports, command) {
  const record = await loadRecord(ports, command.requestId);
  if (record.status === "preparing_source" || record.status === "extracting_wcag_tables") {
    return deepFreeze({ disposition: "duplicate", record, effects: [] });
  }
  if (record.status !== "selected") {
    throw new RuntimeCommandError("COMMAND_NOT_ALLOWED", "Analysis can start only for a selected source.");
  }
  return saveTransition(
    ports,
    record,
    eventEnvelope(record, {
      ...command,
      to: "preparing_source",
      operation: "source",
      incrementAttempt: true,
      effect: "prepare-source",
    }),
  );
}

export async function retryAnalysisCommand(ports, command) {
  const record = await loadRecord(ports, command.requestId);
  if (record.status !== "retryable_failure" || !record.failedOperation || !record.failedState) {
    throw new RuntimeCommandError("COMMAND_NOT_ALLOWED", "Analysis retry is not available.");
  }
  if (record.attempts[record.failedOperation] >= record.retryLimits[record.failedOperation]) {
    throw new RuntimeCommandError("RETRY_LIMIT_EXCEEDED", "The analysis retry limit was reached.");
  }
  return saveTransition(
    ports,
    record,
    eventEnvelope(record, {
      ...command,
      to: record.failedState,
      operation: record.failedOperation,
      incrementAttempt: true,
      effect: `retry-${record.failedOperation}`,
    }),
  );
}

export async function markRetryableFailureCommand(ports, command) {
  const record = await loadRecord(ports, command.requestId);
  const operationStates = {
    source: new Set(["preparing_source"]),
    ingestion: new Set(["extracting_wcag_tables", "checking_coverage"]),
    conformance: new Set(["analyzing_report_quality"]),
    quality: new Set(["analyzing_report_quality"]),
  };
  const allowedStates = operationStates[command.operation];
  if (!allowedStates?.has(record.status)) {
    throw new RuntimeCommandError("COMMAND_NOT_ALLOWED", "This operation cannot fail retryably now.");
  }
  return saveTransition(
    ports,
    record,
    eventEnvelope(record, {
      ...command,
      to: "retryable_failure",
      failedState: command.resumeState ?? record.status,
      effect: "render-analysis-retry",
    }),
  );
}

export async function markExportFailureCommand(ports, command) {
  const record = await loadRecord(ports, command.requestId);
  if (record.status !== "preparing_results") {
    throw new RuntimeCommandError("COMMAND_NOT_ALLOWED", "Export cannot fail from the current state.");
  }
  assertAnalysisOutput(record.analysisOutput, record.requestId);
  assertExportModel(record.exportModel, record.requestId);
  return saveTransition(
    ports,
    record,
    eventEnvelope(record, {
      ...command,
      to: "export_retryable_failure",
      operation: "export",
      failedState: "preparing_results",
      effect: "render-export-retry",
    }),
  );
}

export async function retryExportCommand(ports, command) {
  const record = await loadRecord(ports, command.requestId);
  if (record.status !== "export_retryable_failure") {
    throw new RuntimeCommandError("COMMAND_NOT_ALLOWED", "Export retry is not available.");
  }
  assertAnalysisOutput(record.analysisOutput, record.requestId);
  assertExportModel(record.exportModel, record.requestId);
  if (record.attempts.export >= record.retryLimits.export) {
    throw new RuntimeCommandError("RETRY_LIMIT_EXCEEDED", "The export retry limit was reached.");
  }
  const receiptPort = requiredPort(ports, "export", "getReceipt");
  const existingReceipt = await receiptPort.getReceipt(record.requestId);
  if (existingReceipt) {
    return saveTransition(
      ports,
      record,
      eventEnvelope(record, {
        ...command,
        to: "success",
        operation: "export",
        exportReceipt: existingReceipt,
        effect: "render-success",
      }),
    );
  }
  return saveTransition(
    ports,
    record,
    eventEnvelope(record, {
      ...command,
      to: "preparing_results",
      operation: "export",
      incrementAttempt: true,
      effect: "export-only",
    }),
  );
}

export async function resetToReadyCommand(ports, command) {
  const record = await loadRecord(ports, command.requestId);
  const allowed = new Set([
    "selected",
    "source_rejected",
    "non_searchable_pdf",
    "retryable_failure",
    "success",
    "permanent_failure",
    "nyu_access_failure",
  ]);
  if (!allowed.has(record.status)) {
    throw new RuntimeCommandError("COMMAND_NOT_ALLOWED", "The request cannot be reset from its current state.");
  }
  return saveTransition(
    ports,
    record,
    eventEnvelope(record, { ...command, to: "ready", effect: "clear-active-request" }),
  );
}

export async function reconcileRequestCommand(ports, command) {
  const record = await loadRecord(ports, command.requestId);
  if (record.exportReceipt) return deepFreeze({ disposition: "existing", record, effects: [] });
  const receipt = await requiredPort(ports, "export", "getReceipt").getReceipt(record.requestId);
  if (!receipt) return deepFreeze({ disposition: "existing", record, effects: [] });
  if (record.status !== "preparing_results" && record.status !== "export_retryable_failure") {
    throw new RuntimeCommandError("RECEIPT_STATE_CONFLICT", "An export receipt conflicts with request state.");
  }
  return saveTransition(
    ports,
    record,
    eventEnvelope(record, {
      ...command,
      to: "success",
      exportReceipt: receipt,
      effect: "render-success",
    }),
  );
}

export async function finalizeExportCommand(ports, command) {
  const record = await loadRecord(ports, command.requestId);
  if (record.status !== "preparing_results") {
    throw new RuntimeCommandError("COMMAND_NOT_ALLOWED", "Export is not available from the current state.");
  }
  assertAnalysisOutput(record.analysisOutput, record.requestId);
  assertExportModel(record.exportModel, record.requestId);
  const exportPort = requiredPort(ports, "export", "createExactlyOnce");
  const existingReceipt = await requiredPort(ports, "export", "getReceipt").getReceipt(record.requestId);
  if (existingReceipt) {
    if (existingReceipt.requestId !== record.requestId) {
      throw new RuntimeCommandError("EXPORT_RECEIPT_MISMATCH", "The export receipt does not match the request.");
    }
    return saveTransition(
      ports,
      record,
      eventEnvelope(record, {
        ...command,
        to: "success",
        operation: "export",
        exportReceipt: existingReceipt,
        effect: "render-success",
      }),
    );
  }
  const receipt = await exportPort.createExactlyOnce(record.requestId, record.exportModel);
  if (!receipt) {
    throw new RuntimeCommandError("EXPORT_AMBIGUOUS", "The export result must be reconciled before retry.");
  }
  if (receipt.requestId !== record.requestId) {
    throw new RuntimeCommandError("EXPORT_RECEIPT_MISMATCH", "The export receipt does not match the request.");
  }
  return saveTransition(
    ports,
    record,
    eventEnvelope(record, {
      ...command,
      to: "success",
      operation: "export",
      exportReceipt: receipt,
      effect: "render-success",
    }),
  );
}

export { RequestStateError };
