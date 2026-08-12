import {
  deepFreeze,
  invalid,
  requireClosedObject,
  requireInteger,
  requireString,
} from "../domain/json-data.mjs";

export const REQUEST_STATES = Object.freeze([
  "ready",
  "validating",
  "selected",
  "source_rejected",
  "non_searchable_pdf",
  "preparing_source",
  "extracting_wcag_tables",
  "checking_coverage",
  "analyzing_report_quality",
  "preparing_results",
  "retryable_failure",
  "export_retryable_failure",
  "reconciling_resume",
  "success",
  "permanent_failure",
  "nyu_access_failure",
]);

const STATE_SET = new Set(REQUEST_STATES);
const TRANSITION_TABLE = Object.freeze({
  ready: Object.freeze(["validating", "nyu_access_failure"]),
  validating: Object.freeze([
    "selected",
    "source_rejected",
    "non_searchable_pdf",
    "permanent_failure",
  ]),
  selected: Object.freeze(["preparing_source", "ready"]),
  source_rejected: Object.freeze(["validating", "ready"]),
  non_searchable_pdf: Object.freeze(["validating", "ready"]),
  preparing_source: Object.freeze([
    "extracting_wcag_tables",
    "retryable_failure",
    "permanent_failure",
  ]),
  extracting_wcag_tables: Object.freeze([
    "checking_coverage",
    "source_rejected",
    "non_searchable_pdf",
    "permanent_failure",
  ]),
  checking_coverage: Object.freeze(["analyzing_report_quality", "permanent_failure"]),
  analyzing_report_quality: Object.freeze([
    "preparing_results",
    "retryable_failure",
    "permanent_failure",
  ]),
  preparing_results: Object.freeze([
    "success",
    "export_retryable_failure",
    "permanent_failure",
  ]),
  retryable_failure: Object.freeze([
    "preparing_source",
    "extracting_wcag_tables",
    "checking_coverage",
    "analyzing_report_quality",
    "validating",
    "ready",
    "permanent_failure",
  ]),
  export_retryable_failure: Object.freeze(["preparing_results", "success", "permanent_failure"]),
  reconciling_resume: Object.freeze(REQUEST_STATES.filter((state) => state !== "reconciling_resume")),
  success: Object.freeze(["ready"]),
  permanent_failure: Object.freeze(["validating", "ready"]),
  nyu_access_failure: Object.freeze(["ready"]),
});

export const DEFAULT_RETRY_LIMITS = Object.freeze({
  source: 2,
  ingestion: 2,
  conformance: 3,
  quality: 3,
  export: 3,
});
const OPERATION_SET = new Set(Object.keys(DEFAULT_RETRY_LIMITS));

export class RequestStateError extends Error {
  constructor(code, safeMessage) {
    super(safeMessage);
    this.name = "RequestStateError";
    this.code = code;
    this.safeMessage = safeMessage;
  }
}

export function assertTransition(from, to) {
  if (!STATE_SET.has(from) || !STATE_SET.has(to)) {
    throw new RequestStateError("UNKNOWN_STATE", "The request contains an unknown state.");
  }
  if (!TRANSITION_TABLE[from].includes(to)) {
    throw new RequestStateError(
      "TRANSITION_NOT_ALLOWED",
      `The request cannot transition from ${from} to ${to}.`,
    );
  }
  return true;
}

function zeroAttempts() {
  return { source: 0, ingestion: 0, conformance: 0, quality: 0, export: 0 };
}

function validateLimits(limits) {
  const output = {};
  for (const operation of Object.keys(DEFAULT_RETRY_LIMITS)) {
    requireInteger(limits[operation], `$.retryLimits.${operation}`, {
      minimum: 1,
      maximum: 10,
      code: "INVALID_REQUEST_RECORD",
    });
    output[operation] = limits[operation];
  }
  return output;
}

export function createRequestRecord(options) {
  requireString(options.requestId, "$.requestId", {
    minLength: 1,
    maxLength: 128,
    code: "INVALID_REQUEST_RECORD",
  });
  requireString(options.sourceRef, "$.sourceRef", {
    minLength: 1,
    maxLength: 512,
    code: "INVALID_REQUEST_RECORD",
  });
  requireString(options.createdAt, "$.createdAt", {
    minLength: 1,
    maxLength: 64,
    code: "INVALID_REQUEST_RECORD",
  });
  const record = {
    schemaVersion: "1.0.0",
    requestId: options.requestId,
    sourceRef: options.sourceRef,
    status: "validating",
    sequence: 0,
    attempts: zeroAttempts(),
    retryLimits: validateLimits({ ...DEFAULT_RETRY_LIMITS, ...(options.retryLimits ?? {}) }),
    failedOperation: null,
    failedState: null,
    analysisOutput: null,
    exportModel: null,
    exportReceipt: null,
    appliedEventIds: [],
    createdAt: options.createdAt,
    updatedAt: options.createdAt,
  };
  return deepFreeze(record);
}

export function validateRequestRecord(record) {
  requireClosedObject(
    record,
    "$",
    [
      "schemaVersion",
      "requestId",
      "sourceRef",
      "status",
      "sequence",
      "attempts",
      "retryLimits",
      "failedOperation",
      "failedState",
      "analysisOutput",
      "exportModel",
      "exportReceipt",
      "appliedEventIds",
      "createdAt",
      "updatedAt",
    ],
    "INVALID_REQUEST_RECORD",
  );
  requireString(record.schemaVersion, "$.schemaVersion", {
    constant: "1.0.0",
    code: "INVALID_REQUEST_RECORD",
  });
  requireString(record.requestId, "$.requestId", {
    minLength: 1,
    maxLength: 128,
    code: "INVALID_REQUEST_RECORD",
  });
  requireString(record.status, "$.status", {
    allowed: STATE_SET,
    code: "INVALID_REQUEST_RECORD",
  });
  requireInteger(record.sequence, "$.sequence", {
    minimum: 0,
    code: "INVALID_REQUEST_RECORD",
  });
  if (!Object.isFrozen(record)) {
    throw new RequestStateError("INVALID_REQUEST_RECORD", "The request record must be immutable.");
  }
  requireString(record.sourceRef, "$.sourceRef", {
    minLength: 1,
    maxLength: 512,
    code: "INVALID_REQUEST_RECORD",
  });
  requireClosedObject(
    record.attempts,
    "$.attempts",
    Object.keys(DEFAULT_RETRY_LIMITS),
    "INVALID_REQUEST_RECORD",
  );
  validateLimits(record.retryLimits);
  for (const operation of Object.keys(DEFAULT_RETRY_LIMITS)) {
    requireInteger(record.attempts[operation], `$.attempts.${operation}`, {
      minimum: 0,
      maximum: record.retryLimits[operation],
      code: "INVALID_REQUEST_RECORD",
    });
  }
  if (!Array.isArray(record.appliedEventIds) || record.appliedEventIds.length > 256) {
    throw new RequestStateError(
      "INVALID_REQUEST_RECORD",
      "The applied-event ledger is malformed or exceeds its bound.",
    );
  }
  const applied = new Set();
  record.appliedEventIds.forEach((eventId, index) => {
    requireString(eventId, `$.appliedEventIds[${index}]`, {
      minLength: 1,
      maxLength: 160,
      code: "INVALID_REQUEST_RECORD",
    });
    if (applied.has(eventId)) {
      throw new RequestStateError("INVALID_REQUEST_RECORD", "The applied-event ledger has a duplicate.");
    }
    applied.add(eventId);
  });
  requireString(record.createdAt, "$.createdAt", {
    minLength: 1,
    maxLength: 64,
    code: "INVALID_REQUEST_RECORD",
  });
  requireString(record.updatedAt, "$.updatedAt", {
    minLength: 1,
    maxLength: 64,
    code: "INVALID_REQUEST_RECORD",
  });
  const validFailureState =
    record.status === "retryable_failure" || record.status === "export_retryable_failure";
  if (validFailureState) {
    if (!OPERATION_SET.has(record.failedOperation) || !STATE_SET.has(record.failedState)) {
      throw new RequestStateError("INVALID_REQUEST_RECORD", "Retry lineage is incomplete.");
    }
  } else if (record.failedOperation !== null || record.failedState !== null) {
    throw new RequestStateError("INVALID_REQUEST_RECORD", "Retry lineage exists outside a retry state.");
  }
  if (record.exportReceipt !== null && record.exportReceipt?.requestId !== record.requestId) {
    throw new RequestStateError("INVALID_REQUEST_RECORD", "The export receipt does not match the request.");
  }
  if (record.analysisOutput !== null && !Object.isFrozen(record.analysisOutput)) {
    throw new RequestStateError("INVALID_REQUEST_RECORD", "Analysis output must be immutable.");
  }
  if (record.exportModel !== null && !Object.isFrozen(record.exportModel)) {
    throw new RequestStateError("INVALID_REQUEST_RECORD", "Export model must be immutable.");
  }
  return record;
}

function transitionAcceptedRequest(record, event) {
  validateRequestRecord(record);
  requireString(event.eventId, "$.eventId", {
    minLength: 1,
    maxLength: 160,
    code: "INVALID_EVENT",
  });
  assertTransition(record.status, event.to);
  if (event.operation !== undefined && event.operation !== null && !OPERATION_SET.has(event.operation)) {
    throw new RequestStateError("UNKNOWN_OPERATION", "The request uses an unknown operation.");
  }
  const attempts = { ...record.attempts };
  if (event.incrementAttempt) {
    if (!event.operation) {
      throw new RequestStateError("MISSING_OPERATION", "An attempted operation must be named.");
    }
    const nextAttempt = attempts[event.operation] + 1;
    if (nextAttempt > record.retryLimits[event.operation]) {
      throw new RequestStateError("RETRY_LIMIT_EXCEEDED", "The operation retry limit was reached.");
    }
    attempts[event.operation] = nextAttempt;
  }
  const appliedEventIds = [...record.appliedEventIds, event.eventId];
  if (appliedEventIds.length > 256) appliedEventIds.splice(0, appliedEventIds.length - 256);
  const isRetryFailure =
    event.to === "retryable_failure" || event.to === "export_retryable_failure";
  if (isRetryFailure && !event.operation) {
    throw new RequestStateError("MISSING_OPERATION", "A retryable failure must name its operation.");
  }
  if (event.to === "success" && !event.exportReceipt && !record.exportReceipt) {
    throw new RequestStateError("MISSING_EXPORT_RECEIPT", "Success requires a final export receipt.");
  }
  if (event.analysisOutput !== undefined && event.analysisOutput?.requestId !== record.requestId) {
    throw new RequestStateError("ARTIFACT_REQUEST_MISMATCH", "Analysis output must match the request.");
  }
  if (event.exportModel !== undefined && event.exportModel?.requestId !== record.requestId) {
    throw new RequestStateError("ARTIFACT_REQUEST_MISMATCH", "Export model must match the request.");
  }
  if (event.exportReceipt !== undefined && event.exportReceipt?.requestId !== record.requestId) {
    throw new RequestStateError("ARTIFACT_REQUEST_MISMATCH", "Export receipt must match the request.");
  }
  const next = {
    ...record,
    status: event.to,
    sequence: record.sequence + 1,
    attempts,
    failedOperation: isRetryFailure ? event.operation : null,
    failedState: isRetryFailure ? event.failedState ?? record.status : null,
    analysisOutput:
      event.analysisOutput !== undefined ? event.analysisOutput : record.analysisOutput,
    exportModel: event.exportModel !== undefined ? event.exportModel : record.exportModel,
    exportReceipt: event.exportReceipt !== undefined ? event.exportReceipt : record.exportReceipt,
    appliedEventIds,
    updatedAt: event.occurredAt,
  };
  return deepFreeze({
    disposition: "accepted",
    record: deepFreeze(next),
    effects: Object.freeze(event.effect === null ? [] : [event.effect ?? "render"]),
  });
}

export function classifyCallback(record, event) {
  validateRequestRecord(record);
  if (event.requestId !== record.requestId) {
    return deepFreeze({ disposition: "stale", record, effects: [] });
  }
  requireString(event.eventId, "$.eventId", {
    minLength: 1,
    maxLength: 160,
    code: "INVALID_EVENT",
  });
  if (record.appliedEventIds.includes(event.eventId)) {
    return deepFreeze({ disposition: "duplicate", record, effects: [] });
  }
  return null;
}

export function transitionRequest(record, event) {
  const classified = classifyCallback(record, event);
  if (classified) return classified;
  return transitionAcceptedRequest(record, event);
}

export { TRANSITION_TABLE };
