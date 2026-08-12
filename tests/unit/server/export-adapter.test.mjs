import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  ExactlyOnceExportCoordinator,
  renderTabRawValues,
  validateExportModelShape
} from '../../../src/app/server/export-adapter.mjs';

const digestText = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const tabNames = ['Overview', 'Line-item Review', 'Quality Requirements', 'Scoring', 'Methodology & disclaimer'];
const model = (requestId = 'req-export-1', literal = '=SUM(A1:A2)') => ({
  schemaVersion: '1.0.0', requestId, outputFolder: 'My Drive/VPAT Analyzer Results',
  provenance: { templateVersion: '1.0.0' },
  tabs: tabNames.map((name, index) => ({
    tabId: `tab-${index + 1}`, name, order: index + 1,
    sections: [{
      sectionId: `section-${index + 1}`, heading: name, kind: 'table', columns: ['value'],
      rows: [{ rowId: `row-${index + 1}`, cells: [{ columnId: 'value', kind: 'literal', value: literal }] }]
    }]
  }))
});

class FakeRecords {
  values = new Map();
  key(kind, requestId) { return `${kind}:${requestId}`; }
  get(kind, requestId) {
    const value = this.values.get(this.key(kind, requestId));
    return value ? { value } : null;
  }
  put(kind, requestId, value) { this.values.set(this.key(kind, requestId), structuredClone(value)); }
}

test('fixed workbook model has exactly five ordered tabs and preserves dangerous strings as raw values', () => {
  const exportModel = validateExportModelShape(model());
  assert.deepEqual(exportModel.tabs.map((tab) => tab.name), tabNames);
  assert.equal(renderTabRawValues(exportModel.tabs[0])[2][0], '=SUM(A1:A2)');
  const bad = model();
  bad.tabs.push({ name: 'Extra', order: 6, sections: [] });
  assert.throws(() => validateExportModelShape(bad), (error) => error.code === 'EXPORT_MODEL_INVALID');
});

test('durable claim and receipt make repeated export exactly once', () => {
  const records = new FakeRecords();
  const effects = { created: [], written: [] };
  const artifacts = new Map();
  const coordinator = new ExactlyOnceExportCoordinator({
    records,
    lock: { run: (callback) => callback() },
    clock: (() => { let tick = 0; return () => `2026-08-12T12:00:0${tick++}.000Z`; })(),
    ids: () => 'claim-token-1234567890',
    digestText,
    rebuildExportModel: () => model(),
    artifactPort: {
      findByClaimToken: (token) => artifacts.has(token) ? [artifacts.get(token)] : [],
      create: ({ claimToken }) => {
        effects.created.push(claimToken);
        artifacts.set(claimToken, 'spreadsheet-1');
        return 'spreadsheet-1';
      },
      write: (id) => effects.written.push(id),
      urlFor: (id) => `https://docs.google.com/spreadsheets/d/${id}/edit`
    }
  });
  coordinator.storeImmutable('req-export-1', { status: 'Complete' }, model());
  assert.equal(records.get('analysis', 'req-export-1').value.exportModel, undefined);
  const first = coordinator.exportStored('req-export-1');
  const second = coordinator.exportStored('req-export-1');
  assert.deepEqual(second, first);
  assert.deepEqual(effects.created, ['claim-token-1234567890']);
  assert.deepEqual(effects.written, ['spreadsheet-1']);
});

test('retry reconciles an artifact created before an ambiguous timeout without creating another', () => {
  const records = new FakeRecords();
  const artifacts = new Map();
  let calls = 0;
  const coordinator = new ExactlyOnceExportCoordinator({
    records, lock: { run: (callback) => callback() }, clock: () => '2026-08-12T12:00:00.000Z',
    ids: () => 'claim-token-ambiguous-1234', digestText, rebuildExportModel: () => model(),
    artifactPort: {
      findByClaimToken: (token) => artifacts.has(token) ? [artifacts.get(token)] : [],
      create: ({ claimToken }) => {
        calls += 1;
        artifacts.set(claimToken, 'spreadsheet-ambiguous');
        throw new Error('timeout after create');
      },
      write: () => {},
      urlFor: (id) => `https://docs.google.com/spreadsheets/d/${id}/edit`
    }
  });
  coordinator.storeImmutable('req-export-1', { status: 'Complete' }, model());
  assert.throws(() => coordinator.exportStored('req-export-1'), /timeout/);
  const receipt = coordinator.exportStored('req-export-1');
  assert.equal(receipt.spreadsheetId, 'spreadsheet-ambiguous');
  assert.equal(calls, 1);
});
