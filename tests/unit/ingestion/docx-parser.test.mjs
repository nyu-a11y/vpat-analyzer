import assert from 'node:assert/strict';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';

import {
  IngestionParserError,
  parseDocxBytes,
  parseDocxBytesSync,
} from '../../../src/ingestion/browser/docx-parser.mjs';

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOCUMENT = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>  WCAG   2.2 results  </w:t></w:r></w:p>
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Criteria</w:t></w:r></w:p></w:tc>
        <w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>Assessment</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>1.1.1 Non-text Content</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Supports</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Synthetic evidence.</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc>
        <w:tc><w:p><w:r><w:t>Partially</w:t></w:r><w:tab/><w:r><w:t>Supports</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Needs review.</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
    <w:p><w:r><w:t>Between tables</w:t></w:r></w:p>
    <w:tbl>
      <w:tr><w:tc><w:p><w:r><w:t>Item</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:t>Second table</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl>
  </w:body>
</w:document>`;

function packageBytes(overrides = {}, options = {}) {
  const files = {
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(ROOT_RELS),
    'word/document.xml': strToU8(DOCUMENT),
    ...Object.fromEntries(Object.entries(overrides).map(([name, value]) => [name, value instanceof Uint8Array ? value : strToU8(value)])),
  };
  return zipSync(files, { level: options.level ?? 6 });
}

function assertParserError(action, code, stage) {
  assert.throws(action, (error) => {
    assert.ok(error instanceof IngestionParserError);
    assert.equal(error.code, code);
    assert.equal(error.stage, stage);
    assert.match(error.safeMessage, /\S/);
    return true;
  });
}

test('parses ordered tables into the neutral candidate-document shape', async () => {
  const result = await parseDocxBytes(packageBytes());

  assert.deepEqual(result.bodyProse, ['WCAG 2.2 results', 'Between tables']);
  assert.deepEqual(result.tables, [
    {
      tableId: 'docx-table-1',
      sourceOrder: 0,
      context: 'WCAG 2.2 results',
      headers: ['Criteria', 'Assessment', ''],
      rows: [
        { sourceRowIndex: 1, cells: ['1.1.1 Non-text Content', 'Supports', 'Synthetic evidence.'] },
        { sourceRowIndex: 2, cells: ['1.1.1 Non-text Content', 'Partially Supports', 'Needs review.'] },
      ],
    },
    {
      tableId: 'docx-table-2',
      sourceOrder: 1,
      context: 'Between tables',
      headers: ['Item'],
      rows: [{ sourceRowIndex: 1, cells: ['Second table'] }],
    },
  ]);
  assert.equal(result.metadata.format, 'docx');
  assert.equal(result.metadata.adapter, 'fflate-ooxml');
  assert.equal(result.metadata.parser, 'fflate-ooxml');
  assert.equal(result.metadata.tableCount, 2);
  assert.equal(result.metadata.bodyParagraphCount, 2);
  assert.ok(result.metadata.sourceBytes > 0);
  assert.ok(result.metadata.expandedBytes > result.metadata.sourceBytes);
});

test('provides an equivalent synchronous API and accepts ArrayBuffer views', () => {
  const bytes = packageBytes();
  const result = parseDocxBytesSync(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  assert.equal(result.tables.length, 2);
  assert.equal(result.tables[0].rows[0].cells[0], '1.1.1 Non-text Content');
});

test('retains heading ancestry so identical official standard headers classify safely', () => {
  const officialShape = DOCUMENT.replace(
    '<w:p><w:r><w:t>Between tables</w:t></w:r></w:p>',
    '<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Revised Section 508 Report</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Heading3"/></w:pPr><w:r><w:t>Chapter 5: Software</w:t></w:r></w:p><w:p><w:r><w:t>Notes:</w:t></w:r></w:p>',
  );
  const result = parseDocxBytesSync(packageBytes({ 'word/document.xml': officialShape }));
  assert.match(result.tables[1].context, /Revised Section 508 Report/);
  assert.match(result.tables[1].context, /Chapter 5: Software/);
  assert.match(result.tables[1].context, /Notes:/);
});

test('rejects missing or malformed OOXML package parts with typed errors', () => {
  const missingDocument = zipSync({
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(ROOT_RELS),
  });
  assertParserError(() => parseDocxBytesSync(missingDocument), 'SOURCE_MALFORMED', 'container-parse');

  assertParserError(
    () => parseDocxBytesSync(packageBytes({ 'word/document.xml': '<w:document><w:body></w:document>' })),
    'SOURCE_MALFORMED',
    'container-parse',
  );
});

test('rejects DOCTYPE and ENTITY declarations before extraction', () => {
  const unsafe = `<!DOCTYPE w:document [<!ENTITY leak "unsafe">]>
    <w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>&leak;</w:t></w:r></w:p></w:body></w:document>`;
  assertParserError(
    () => parseDocxBytesSync(packageBytes({ 'word/document.xml': unsafe })),
    'SOURCE_MALFORMED',
    'container-parse',
  );

  assertParserError(
    () => parseDocxBytesSync(packageBytes({
      'word/document.xml': '<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>bare & value</w:t></w:r></w:p></w:body></w:document>',
    })),
    'SOURCE_MALFORMED',
    'container-parse',
  );

  assertParserError(
    () => parseDocxBytesSync(packageBytes({
      'word/document.xml': DOCUMENT.replace('WCAG   2.2 results', 'WCAG &#0; 2.2 results'),
    })),
    'SOURCE_MALFORMED',
    'container-parse',
  );
});

test('never interprets attacker-namespace elements as WordprocessingML', () => {
  const attackerNamespace = DOCUMENT
    .replace('<w:document ', '<w:document xmlns:evil="urn:attacker" ')
    .replaceAll('<w:tbl>', '<evil:tbl>')
    .replaceAll('</w:tbl>', '</evil:tbl>');
  const result = parseDocxBytesSync(packageBytes({ 'word/document.xml': attackerNamespace }));
  assert.equal(result.tables.length, 0);

  const attackerRoot = DOCUMENT.replace(
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
    'xmlns:w="urn:attacker"',
  );
  assertParserError(
    () => parseDocxBytesSync(packageBytes({ 'word/document.xml': attackerRoot })),
    'SOURCE_MALFORMED',
    'container-parse',
  );

  const attackerText = DOCUMENT
    .replace('<w:document ', '<w:document xmlns:evil="urn:attacker" ')
    .replaceAll('<w:t>', '<evil:t>')
    .replaceAll('</w:t>', '</evil:t>')
    .replaceAll('<w:tab/>', '<evil:tab/>');
  const ignoredText = parseDocxBytesSync(packageBytes({ 'word/document.xml': attackerText }));
  assert.deepEqual(ignoredText.bodyProse, []);
  assert.equal(ignoredText.tables.length, 2);
  assert.deepEqual(ignoredText.tables[0].headers, ['', '', '']);
});

test('rejects ZIP entries whose CRC integrity metadata does not match their bytes', () => {
  const bytes = packageBytes();
  const corrupted = bytes.slice();
  for (let offset = 0; offset + 4 <= corrupted.length; offset += 1) {
    const signature = corrupted[offset] | (corrupted[offset + 1] << 8) |
      (corrupted[offset + 2] << 16) | (corrupted[offset + 3] << 24);
    if ((signature >>> 0) === 0x04034b50) corrupted[offset + 14] ^= 0xff;
    if ((signature >>> 0) === 0x02014b50) corrupted[offset + 16] ^= 0xff;
  }
  assertParserError(
    () => parseDocxBytesSync(corrupted),
    'SOURCE_MALFORMED',
    'container-parse',
  );
});

test('resolves security-sensitive attributes by namespace and rejects ambiguous duplicates', () => {
  const prefixedRootRelationship = ROOT_RELS
    .replace('<Relationships ', '<Relationships xmlns:evil="urn:attacker" ')
    .replace(' Type=', ' evil:Type=');
  assertParserError(
    () => parseDocxBytesSync(packageBytes({ '_rels/.rels': prefixedRootRelationship })),
    'SOURCE_MALFORMED',
    'container-parse',
  );

  const emptyNamespacePrefix = ROOT_RELS
    .replace('<Relationships ', '<Relationships xmlns:evil="" ')
    .replace(' Type=', ' evil:Type=');
  assertParserError(
    () => parseDocxBytesSync(packageBytes({ '_rels/.rels': emptyNamespacePrefix })),
    'SOURCE_MALFORMED',
    'container-parse',
  );

  const ambiguousRootRelationship = ROOT_RELS
    .replace('<Relationships ', '<Relationships xmlns:evil="urn:attacker" ')
    .replace(' Type=', ' evil:Type="urn:attacker" Type=');
  assertParserError(
    () => parseDocxBytesSync(packageBytes({ '_rels/.rels': ambiguousRootRelationship })),
    'SOURCE_MALFORMED',
    'container-parse',
  );

  const prefixedWordAttribute = DOCUMENT.replace(
    '<w:gridSpan w:val="2"/>',
    '<w:gridSpan xmlns:evil="urn:attacker" evil:val="2"/>',
  );
  const ignoredSpoof = parseDocxBytesSync(packageBytes({ 'word/document.xml': prefixedWordAttribute }));
  assert.deepEqual(ignoredSpoof.tables[0].headers, ['Criteria', 'Assessment']);

  const ambiguousWordAttribute = DOCUMENT.replace(
    '<w:gridSpan w:val="2"/>',
    '<w:gridSpan xmlns:evil="urn:attacker" evil:val="1" w:val="2"/>',
  );
  assertParserError(
    () => parseDocxBytesSync(packageBytes({ 'word/document.xml': ambiguousWordAttribute })),
    'SOURCE_MALFORMED',
    'container-parse',
  );

  const recognizedAlternatePrefix = DOCUMENT.replace(
    '<w:gridSpan w:val="2"/>',
    '<w:gridSpan xmlns:alt="http://schemas.openxmlformats.org/wordprocessingml/2006/main" alt:val="2"/>',
  );
  const result = parseDocxBytesSync(packageBytes({ 'word/document.xml': recognizedAlternatePrefix }));
  assert.deepEqual(result.tables[0].headers, ['Criteria', 'Assessment', '']);
});

test('rejects macros, external active relationships, embedded objects, and non-allowlisted entries', () => {
  assertParserError(
    () => parseDocxBytesSync(packageBytes({ 'word/vbaProject.bin': new Uint8Array([1]) })),
    'SOURCE_MALFORMED',
    'container-parse',
  );

  const externalRelationships = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.invalid/image.png" TargetMode="External"/>
  </Relationships>`;
  assertParserError(
    () => parseDocxBytesSync(packageBytes({ 'word/_rels/document.xml.rels': externalRelationships })),
    'SOURCE_MALFORMED',
    'container-parse',
  );

  const inertHyperlink = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.invalid" TargetMode="External"/>
  </Relationships>`;
  const compatible = parseDocxBytesSync(packageBytes({
    'word/_rels/document.xml.rels': inertHyperlink,
    '[trash]/0000.dat': new Uint8Array([1, 2, 3]),
  }));
  assert.equal(compatible.tables.length, 2);

  assertParserError(
    () => parseDocxBytesSync(packageBytes({ 'word/embeddings/object1.bin': new Uint8Array([1]) })),
    'SOURCE_MALFORMED',
    'container-parse',
  );
  assertParserError(
    () => parseDocxBytesSync(packageBytes({ 'unexpected.bin': new Uint8Array([1]) })),
    'SOURCE_MALFORMED',
    'container-parse',
  );
  try {
    parseDocxBytesSync(packageBytes({ 'private-source-name.bin': new Uint8Array([1]) }));
    assert.fail('Expected a non-allowlisted entry to be rejected.');
  } catch (error) {
    assert.ok(error instanceof IngestionParserError);
    assert.doesNotMatch(error.safeMessage, /private-source-name/);
  }
});

test('rejects macro-enabled content types even without a macro payload', () => {
  const macroTypes = CONTENT_TYPES.replace(
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    'application/vnd.ms-word.document.macroEnabled.main+xml',
  );
  assertParserError(
    () => parseDocxBytesSync(packageBytes({ '[Content_Types].xml': macroTypes })),
    'SOURCE_MALFORMED',
    'container-parse',
  );
});

test('rejects nested tables inside Word table cells', () => {
  const nestedTable = DOCUMENT.replace(
    '<w:tc><w:p><w:r><w:t>Criteria</w:t></w:r></w:p></w:tc>',
    `<w:tc><w:p><w:r><w:t>Criteria</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:tcPr><w:gridSpan w:val="3"/></w:tcPr><w:p><w:r><w:t>Nested</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:tc>`,
  );
  assertParserError(
    () => parseDocxBytesSync(packageBytes({ 'word/document.xml': nestedTable })),
    'SOURCE_MALFORMED',
    'container-parse',
  );
});

test('rejects malformed vertical merges and preserves irregular row offsets', () => {
  const invalidValue = DOCUMENT.replace('<w:vMerge w:val="restart"/>', '<w:vMerge w:val="bogus"/>');
  assertParserError(
    () => parseDocxBytesSync(packageBytes({ 'word/document.xml': invalidValue })),
    'SOURCE_MALFORMED',
    'container-parse',
  );

  const orphanContinuation = DOCUMENT.replace('<w:vMerge w:val="restart"/>', '<w:vMerge/>');
  assertParserError(
    () => parseDocxBytesSync(packageBytes({ 'word/document.xml': orphanContinuation })),
    'SOURCE_MALFORMED',
    'container-parse',
  );

  const irregularRow = DOCUMENT.replace(
    '<w:tr><w:tc><w:p><w:r><w:t>Second table</w:t></w:r></w:p></w:tc></w:tr>',
    '<w:tr><w:trPr><w:gridBefore w:val="1"/><w:gridAfter w:val="1"/></w:trPr><w:tc><w:p><w:r><w:t>Second table</w:t></w:r></w:p></w:tc></w:tr>',
  );
  const irregularResult = parseDocxBytesSync(packageBytes({ 'word/document.xml': irregularRow }));
  assert.deepEqual(irregularResult.tables[1].rows[0].cells, ['', 'Second table', '']);
});

test('enforces source, entry, expanded, compression, table, row, cell, text, and XML-node limits', () => {
  const bytes = packageBytes();
  const cases = [
    [{ maxSourceBytes: bytes.length - 1 }, 'resource-limit'],
    [{ maxZipEntries: 2 }, 'resource-limit'],
    [{ maxExpandedBytes: 100 }, 'resource-limit'],
    [{ maxCompressionRatio: 1 }, 'resource-limit'],
    [{ maxTables: 1 }, 'resource-limit'],
    [{ maxRows: 3 }, 'resource-limit'],
    [{ maxCells: 4 }, 'resource-limit'],
    [{ maxCells: 10 }, 'resource-limit'],
    [{ maxTextChars: 20 }, 'resource-limit'],
    [{ maxXmlChars: 100 }, 'resource-limit'],
    [{ maxXmlNodes: 5 }, 'resource-limit'],
    [{ maxXmlDepth: 5 }, 'resource-limit'],
    [{ maxWorkUnits: 1 }, 'resource-limit'],
  ];
  for (const [limits, stage] of cases) {
    assertParserError(
      () => parseDocxBytesSync(bytes, { limits }),
      'RESOURCE_LIMIT_EXCEEDED',
      stage,
    );
  }
});

test('rejects non-ZIP bytes and invalid parser-limit configuration', () => {
  assertParserError(
    () => parseDocxBytesSync(strToU8('not a zip')),
    'SOURCE_TYPE_UNSUPPORTED',
    'classification',
  );
  assertParserError(
    () => parseDocxBytesSync(packageBytes(), { limits: { maxTables: 0 } }),
    'SOURCE_MALFORMED',
    'container-parse',
  );
  assertParserError(
    () => parseDocxBytesSync(packageBytes(), { limits: { surprise: 1 } }),
    'SOURCE_MALFORMED',
    'container-parse',
  );
});
