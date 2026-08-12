import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const appsscript = (file) => readFileSync(resolve(root, 'appsscript', file), 'utf8');

test('production manifest is domain-only, executes as accessing user, and contains no deployment identity or secret', () => {
  const manifestText = appsscript('appsscript.json');
  const manifest = JSON.parse(manifestText);
  assert.deepEqual(manifest.webapp, { access: 'DOMAIN', executeAs: 'USER_ACCESSING' });
  assert.match(JSON.stringify(manifest.oauthScopes), /drive/);
  assert.match(JSON.stringify(manifest.oauthScopes), /documents/);
  assert.match(JSON.stringify(manifest.oauthScopes), /spreadsheets/);
  assert.doesNotMatch(manifestText, /deploymentId|scriptId|api[_-]?key|secret|token/i);
});

test('Apps Script server keeps JSON-only RPC, chunked UserProperties, Script-Property provider config, and raw Sheet writes', () => {
  const code = readdirSync(resolve(root, 'appsscript'))
    .filter((name) => name.endsWith('.gs'))
    .map((name) => appsscript(name))
    .join('\n');
  assert.match(code, /function rpcCommand\(requestJson\)/);
  assert.match(code, /PropertiesService\.getUserProperties\(\)/);
  assert.match(code, /PropertiesService\.getScriptProperties\(\)/);
  assert.match(code, /16 \* 1024/);
  assert.match(code, /VPAT_MAX_RPC_REQUEST_BYTES_ = 1024 \* 1024/);
  assert.match(code, /LockService\.getUserLock\(\)/);
  assert.match(code, /appProperties/);
  assert.match(code, /valueInputOption: 'RAW'/);
  assert.doesNotMatch(code, /\.setFormula\(|valueInputOption:\s*'USER_ENTERED'/);
  assert.match(code, /https:\/\/api\.portkey\.ai\/v1\/chat\/completions/);
  assert.match(code, /x-portkey-virtual-key/);
  assert.match(code, /Range: 'bytes=' \+ firstByte \+ '-' \+ lastByte/);
  assert.match(code, /CacheService\.getUserCache\(\)/);
  assert.match(code, /cache\.getAll\(keys\)/);
  assert.match(code, /cache\.putAll\(entries, 600\)/);
  assert.match(code, /Utilities\.gzip/);
  assert.match(code, /VPAT_MAX_USER_PROPERTY_BUDGET_BYTES_ = 450 \* 1024/);
  assert.match(code, /expectedCriteria/);
  assert.match(code, /expectedRequirements/);
  assert.match(code, /VPAT_QUALITY_EVIDENCE_FIELD_IDS_/);
  assert.match(code, /VPAT_CONFORMANCE_SYSTEM_PROMPT_/);
  assert.match(code, /VPAT_QUALITY_SYSTEM_PROMPT_/);
  assert.match(code, /VPAT_WCAG_CATALOG_/);
  assert.doesNotMatch(code, /setTimeout|Utilities\.sleep/);
});

test('source transports preflight the active selected source before expensive acquisition', () => {
  const drive = appsscript('DriveSourceAdapter.gs');
  const doc = appsscript('GoogleDocAdapter.gs');
  const beginStart = drive.indexOf('function vpatBeginSourceBytes_');
  const beginEnd = drive.indexOf('function vpatStoreSourceBinding_', beginStart);
  const begin = drive.slice(beginStart, beginEnd);
  assert.ok(begin.indexOf('vpatRequireSelectedSource_') < begin.indexOf('vpatGetSourceBytes_'));
  assert.ok(begin.indexOf("vpatGetUserRecord_('source'") < begin.indexOf('vpatGetSourceBytes_'));
  const docStart = doc.indexOf('function vpatSerializeGoogleDoc_');
  const docEnd = doc.indexOf('function vpatSerializeGoogleDocBody_', docStart);
  const serialize = doc.slice(docStart, docEnd);
  assert.ok(serialize.indexOf('vpatRequireSelectedSource_') < serialize.indexOf('DocumentApp.openById'));
});
