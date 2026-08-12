const command = process.argv[2] || "unknown";

console.error(
  `${command} is a required Stage 1 gate and is intentionally unavailable in Stage 0. ` +
    "Document Workbench is approved, but the deterministic ingestion gate remains BLOCKED; " +
    "no production UI or simulated passing result has been created.",
);
process.exitCode = 2;
