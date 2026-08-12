const missingProof = [
  'committed real-format synthetic DOCX, searchable-PDF, image-only-PDF, malformed-PDF, and encrypted-PDF fixtures',
  'actual pure-JavaScript DOCX/PDF browser parser bundles run in the ingestion shape',
  'bound or deployed authorized HtmlService CSP, worker, packaged-asset, memory, resource-limit, and unexpected-network proof',
  'an actual synthetic Google Doc serialized through DocumentApp with golden WCAG-row parity',
  'authorized Drive-to-browser byte transport and a JSON-only google.script.run round trip',
  'cross-format golden parity and stable negative rejection codes with no OCR, provider, page-image, or complete-binary AI payload'
];

console.error('BLOCKED — Stage 0 deterministic ingestion feasibility has not been proven.');
console.error('Missing required evidence:');
for (const item of missingProof) {
  console.error(`- ${item}`);
}
console.error('See docs/testing/STAGE_0_INGESTION_GATE.md for the exact unblock proof.');
process.exitCode = 2;
