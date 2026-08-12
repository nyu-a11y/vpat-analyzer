import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function loadJson(path) {
  return JSON.parse(readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8'));
}

const runtime = {};
vm.createContext(runtime);
new vm.Script([
  readFileSync(new URL('../../../appsscript/ServerCommon.gs', import.meta.url), 'utf8'),
  readFileSync(new URL('../../../appsscript/ProviderAdapter.gs', import.meta.url), 'utf8'),
].join('\n')).runInContext(runtime);

function schemaContract(path) {
  const { $schema, $id, title, ...contract } = loadJson(path);
  void $schema;
  void $id;
  void title;
  return contract;
}

test('Apps Script provider structured-output schemas exactly match committed response contracts', () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(runtime.vpatProviderResponseSchema_('conformance'))),
    schemaContract('schemas/ai-conformance-response.v1.schema.json')
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(runtime.vpatProviderResponseSchema_('quality'))),
    schemaContract('schemas/ai-quality-response.v1.schema.json')
  );
});
