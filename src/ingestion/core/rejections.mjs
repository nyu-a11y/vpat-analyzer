export class IngestionRejection extends Error {
  constructor(code, stage, safeMessage) {
    super(safeMessage);
    this.name = "IngestionRejection";
    this.code = code;
    this.stage = stage;
    this.safeMessage = safeMessage;
  }
}

export function rejectMalformed() {
  throw new IngestionRejection(
    "SOURCE_MALFORMED",
    "container-parse",
    "The source structure is malformed and could not be analyzed.",
  );
}

export function rejectResourceLimit() {
  throw new IngestionRejection(
    "RESOURCE_LIMIT_EXCEEDED",
    "resource-limit",
    "The source exceeds a deterministic ingestion resource limit.",
  );
}
