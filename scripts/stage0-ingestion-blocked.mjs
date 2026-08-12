const missingProof = [
  'bound or deployed authorized HtmlService CSP, worker, packaged-asset, memory, resource-limit, and unexpected-network proof',
  'an actual synthetic Google Doc serialized through DocumentApp with golden WCAG-row parity',
  'authorized Drive-to-browser byte transport and a JSON-only google.script.run round trip',
  'live inaccessible-source proof plus the complete deployed rejection matrix with no OCR/provider fallback'
];

console.error('BLOCKED — Local Stage 0 ingestion proof passes, but the authorized live boundary has not been proven.');
console.error('Missing required evidence:');
for (const item of missingProof) {
  console.error(`- ${item}`);
}
console.error('See docs/testing/STAGE_0_INGESTION_GATE.md for the exact unblock proof.');
process.exitCode = 2;
