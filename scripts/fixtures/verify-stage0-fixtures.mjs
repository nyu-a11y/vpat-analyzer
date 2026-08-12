import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const FIXTURES = resolve(ROOT, "tests/fixtures/synthetic/real-format");
const MANIFEST = JSON.parse(readFileSync(resolve(FIXTURES, "manifest.v1.json"), "utf8"));

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

assert.equal(MANIFEST.syntheticOnly, true);
assert.equal(MANIFEST.containsProductionContent, false);
assert.equal(MANIFEST.sourceSha256, sha256(resolve(ROOT, MANIFEST.sourceFixture)));
assert.equal(MANIFEST.catalogSha256, sha256(resolve(ROOT, MANIFEST.catalogSource)));
assert.ok(MANIFEST.files.length >= 10);
for (const fixture of MANIFEST.files) {
  const path = resolve(FIXTURES, fixture.filename);
  assert.equal(statSync(path).size, fixture.bytes, `${fixture.filename}: byte count`);
  assert.equal(sha256(path), fixture.sha256, `${fixture.filename}: SHA-256`);
}
console.log(`verified ${MANIFEST.files.length} committed synthetic real-format fixtures`);
