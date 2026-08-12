import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const ELEMENT_TYPE = Object.freeze({ PARAGRAPH: 'PARAGRAPH', LIST_ITEM: 'LIST_ITEM', TABLE: 'TABLE' });
const PARAGRAPH_HEADING = Object.freeze({
  NORMAL: 'NORMAL', TITLE: 'TITLE', HEADING1: 'HEADING1', HEADING2: 'HEADING2',
  HEADING3: 'HEADING3', HEADING4: 'HEADING4', HEADING5: 'HEADING5', HEADING6: 'HEADING6',
});

function paragraph(text, heading = PARAGRAPH_HEADING.NORMAL) {
  return {
    getType: () => ELEMENT_TYPE.PARAGRAPH,
    asParagraph() { return this; },
    getText: () => text,
    getHeading: () => heading,
  };
}

function cell(text, children = []) {
  return {
    getText: () => text,
    getNumChildren: () => children.length,
    getChild: index => children[index],
  };
}

function row(values) {
  const cells = values.map(value => typeof value === 'string' ? cell(value) : value);
  return { getNumCells: () => cells.length, getCell: index => cells[index] };
}

function table(rows) {
  return {
    getType: () => ELEMENT_TYPE.TABLE,
    asTable() { return this; },
    getNumRows: () => rows.length,
    getRow: index => rows[index],
  };
}

function body(children) {
  return { getNumChildren: () => children.length, getChild: index => children[index] };
}

function context() {
  const value = {
    DocumentApp: { ElementType: ELEMENT_TYPE, ParagraphHeading: PARAGRAPH_HEADING },
  };
  vm.createContext(value);
  new vm.Script([
    readFileSync(new URL('../../../appsscript/ServerCommon.gs', import.meta.url), 'utf8'),
    readFileSync(new URL('../../../appsscript/GoogleDocAdapter.gs', import.meta.url), 'utf8'),
  ].join('\n')).runInContext(value);
  return value;
}

test('DocumentApp serialization preserves structural table context and excludes body prose from rows', () => {
  const runtime = context();
  const serialized = runtime.vpatSerializeGoogleDocBody_(body([
    paragraph('VPAT 2.5 Accessibility Conformance Report', PARAGRAPH_HEADING.TITLE),
    paragraph('WCAG 2.2 Report', PARAGRAPH_HEADING.HEADING1),
    paragraph('This prose mentions 1.1.1 but is not a table row.'),
    table([
      row(['Criteria', 'Conformance Level', 'Remarks and Explanations']),
      row(['1.1.1 Non-text Content', 'Supports', '=literal evidence']),
    ]),
  ]));
  assert.deepEqual(JSON.parse(JSON.stringify(serialized)), {
    bodyProse: [
      'VPAT 2.5 Accessibility Conformance Report',
      'WCAG 2.2 Report',
      'This prose mentions 1.1.1 but is not a table row.',
    ],
    tables: [{
      tableId: 'google-doc-table-1',
      sourceOrder: 0,
      context: 'VPAT 2.5 Accessibility Conformance Report > WCAG 2.2 Report > This prose mentions 1.1.1 but is not a table row.',
      headers: ['Criteria', 'Conformance Level', 'Remarks and Explanations'],
      rows: [{
        sourceRowIndex: 1,
        cells: ['1.1.1 Non-text Content', 'Supports', '=literal evidence'],
      }],
    }],
    metadata: { adapter: 'document-app', parserVersion: '1.0.0', tableCount: 1, bodyProseCount: 3 },
  });
});

test('DocumentApp serialization fails closed for nested tables and bounded cells', () => {
  const runtime = context();
  const nested = { getType: () => ELEMENT_TYPE.TABLE };
  assert.throws(
    () => runtime.vpatSerializeGoogleDocBody_(body([table([
      row(['Criteria', 'Conformance Level']),
      row([cell('1.1.1', [nested]), 'Supports']),
    ])])),
    error => error.vpatCode === 'RESOURCE_LIMIT_EXCEEDED'
  );
  assert.throws(
    () => runtime.vpatSerializeGoogleDocBody_(body([table([
      row(['Criteria', 'Conformance Level']),
      row(['x'.repeat(1001), 'Supports']),
    ])])),
    error => error.vpatCode === 'RESOURCE_LIMIT_EXCEEDED'
  );
});
