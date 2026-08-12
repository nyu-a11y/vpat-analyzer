import { unzipSync } from 'fflate';

const REQUIRED_ENTRIES = Object.freeze([
  '[Content_Types].xml',
  '_rels/.rels',
  'word/document.xml',
]);

const DEFAULT_LIMITS = Object.freeze({
  maxSourceBytes: 25 * 1024 * 1024,
  maxZipEntries: 256,
  maxExpandedBytes: 32 * 1024 * 1024,
  maxCompressionRatio: 200,
  maxTables: 128,
  maxRows: 10_000,
  maxCells: 50_000,
  maxTextChars: 5_000_000,
  maxXmlChars: 8_000_000,
  maxXmlNodes: 200_000,
  maxXmlDepth: 256,
  maxWorkUnits: 500_000,
  maxProcessingMilliseconds: 15_000,
});

const LIMIT_KEYS = new Set(Object.keys(DEFAULT_LIMITS));
const XML_ENTRY = /(?:\.xml|\.rels)$/i;
const MACRO_ENTRY = /(?:^|\/)(?:vbaProject|vbaData)\.(?:bin|xml)$/i;
const UNSAFE_RELATIONSHIP = /\/(?:vbaProject|oleObject|package|attachedTemplate)$/i;
const HYPERLINK_RELATIONSHIP = /\/hyperlink$/i;
const OFFICE_DOCUMENT_REL = /\/officeDocument$/i;
const DOCUMENT_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const CONTENT_TYPES_NAMESPACES = new Set([
  'http://schemas.openxmlformats.org/package/2006/content-types',
  'http://purl.oclc.org/ooxml/package/content-types',
]);
const RELATIONSHIPS_NAMESPACES = new Set([
  'http://schemas.openxmlformats.org/package/2006/relationships',
  'http://purl.oclc.org/ooxml/package/relationships',
]);
const WORD_NAMESPACES = new Set([
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  'http://purl.oclc.org/ooxml/wordprocessingml/main',
]);
const UNQUALIFIED_ATTRIBUTE_NAMESPACES = new Set(['']);
const STABLE_STAGE = Object.freeze({
  limits: 'container-parse',
  container: 'container-parse',
  package: 'container-parse',
  security: 'container-parse',
  xml: 'container-parse',
  extract: 'container-parse',
  parse: 'container-parse',
});

export class IngestionParserError extends Error {
  constructor(code, stage, message, options = {}) {
    super(message, options);
    this.name = 'IngestionParserError';
    this.code = code;
    this.stage = stage;
    this.safeMessage = message;
  }
}

function fail(code, stage, message, cause) {
  const stableStage = code === 'RESOURCE_LIMIT_EXCEEDED'
    ? 'resource-limit'
    : code === 'SOURCE_TYPE_UNSUPPORTED'
      ? 'classification'
      : STABLE_STAGE[stage] || stage;
  throw new IngestionParserError(code, stableStage, message, cause ? { cause } : undefined);
}

function resolveLimits(overrides = {}) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    fail('SOURCE_MALFORMED', 'limits', 'Parser limits must be an object.');
  }

  const limits = { ...DEFAULT_LIMITS };
  for (const [key, value] of Object.entries(overrides)) {
    if (!LIMIT_KEYS.has(key)) {
      fail('SOURCE_MALFORMED', 'limits', `Unknown DOCX parser limit: ${key}.`);
    }
    if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
      fail('SOURCE_MALFORMED', 'limits', `${key} must be a positive integer.`);
    }
    limits[key] = value;
  }
  return limits;
}

function createBudget(limits) {
  return { remaining: limits.maxWorkUnits, deadline: performance.now() + limits.maxProcessingMilliseconds };
}

function consumeWork(budget, units = 1) {
  budget.remaining -= units;
  if (budget.remaining < 0 || performance.now() > budget.deadline) {
    fail('RESOURCE_LIMIT_EXCEEDED', 'limits', 'The DOCX exceeded its deterministic work or processing-time limit.');
  }
}

function asBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  fail('SOURCE_TYPE_UNSUPPORTED', 'container', 'DOCX input must be bytes.');
}

function u16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function u32(bytes, offset) {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function hasSignature(bytes, offset, signature) {
  return offset + 4 <= bytes.length && u32(bytes, offset) === signature;
}

function decodeEntryName(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    fail('SOURCE_MALFORMED', 'container', 'ZIP entry names must be valid UTF-8 or ASCII.', error);
  }
}

function findEndOfCentralDirectory(bytes) {
  const minimumOffset = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimumOffset; offset -= 1) {
    if (
      hasSignature(bytes, offset, 0x06054b50) &&
      offset + 22 + u16(bytes, offset + 20) === bytes.length
    ) return offset;
  }
  fail('SOURCE_MALFORMED', 'container', 'The DOCX ZIP directory is missing or malformed.');
}

function readZipDirectory(bytes, limits, budget) {
  if (bytes.length > limits.maxSourceBytes) {
    fail('RESOURCE_LIMIT_EXCEEDED', 'container', 'The DOCX exceeds the source-byte limit.');
  }
  if (bytes.length < 22 || !hasSignature(bytes, 0, 0x04034b50)) {
    fail('SOURCE_TYPE_UNSUPPORTED', 'container', 'The source is not an OOXML ZIP package.');
  }

  const eocd = findEndOfCentralDirectory(bytes);
  const diskNumber = u16(bytes, eocd + 4);
  const directoryDisk = u16(bytes, eocd + 6);
  const diskEntries = u16(bytes, eocd + 8);
  const entryCount = u16(bytes, eocd + 10);
  const directorySize = u32(bytes, eocd + 12);
  const directoryOffset = u32(bytes, eocd + 16);
  const commentLength = u16(bytes, eocd + 20);

  if (
    diskNumber !== 0 ||
    directoryDisk !== 0 ||
    diskEntries !== entryCount ||
    entryCount === 0xffff ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff
  ) {
    fail('SOURCE_MALFORMED', 'container', 'Multi-disk and ZIP64 DOCX packages are not supported.');
  }
  if (eocd + 22 + commentLength !== bytes.length) {
    fail('SOURCE_MALFORMED', 'container', 'The DOCX ZIP trailer is malformed.');
  }
  if (entryCount > limits.maxZipEntries) {
    fail('RESOURCE_LIMIT_EXCEEDED', 'container', 'The DOCX exceeds the ZIP-entry limit.');
  }
  if (directoryOffset + directorySize !== eocd) {
    fail('SOURCE_MALFORMED', 'container', 'The DOCX ZIP directory bounds are inconsistent.');
  }

  const entries = [];
  const names = new Set();
  let offset = directoryOffset;
  let expandedBytes = 0;
  let compressedBytes = 0;

  for (let index = 0; index < entryCount; index += 1) {
    consumeWork(budget);
    if (!hasSignature(bytes, offset, 0x02014b50) || offset + 46 > eocd) {
      fail('SOURCE_MALFORMED', 'container', 'The DOCX ZIP directory contains a malformed entry.');
    }
    const flags = u16(bytes, offset + 8);
    const method = u16(bytes, offset + 10);
    const crc = u32(bytes, offset + 16);
    const compressedSize = u32(bytes, offset + 20);
    const expandedSize = u32(bytes, offset + 24);
    const nameLength = u16(bytes, offset + 28);
    const extraLength = u16(bytes, offset + 30);
    const entryCommentLength = u16(bytes, offset + 32);
    const localHeaderOffset = u32(bytes, offset + 42);
    const end = offset + 46 + nameLength + extraLength + entryCommentLength;
    if (end > eocd) {
      fail('SOURCE_MALFORMED', 'container', 'The DOCX ZIP entry exceeds the directory bounds.');
    }

    const name = decodeEntryName(bytes.subarray(offset + 46, offset + 46 + nameLength));
    validateEntryPath(name);
    const canonicalName = name.toLowerCase();
    if (names.has(canonicalName)) {
      fail('SOURCE_MALFORMED', 'container', 'The DOCX contains a duplicate ZIP entry.');
    }
    names.add(canonicalName);

    if ((flags & 0x1) !== 0) {
      fail('SOURCE_MALFORMED', 'security', 'Encrypted ZIP entries are not accepted as DOCX input.');
    }
    if (method !== 0 && method !== 8) {
      fail('SOURCE_MALFORMED', 'container', 'The DOCX uses an unsupported ZIP compression method.');
    }
    if (expandedSize > limits.maxExpandedBytes - expandedBytes) {
      fail('RESOURCE_LIMIT_EXCEEDED', 'container', 'The DOCX exceeds the expanded-byte limit.');
    }
    if (expandedSize > 0 && expandedSize / Math.max(1, compressedSize) > limits.maxCompressionRatio) {
      fail('RESOURCE_LIMIT_EXCEEDED', 'container', 'The DOCX exceeds the per-entry compression-ratio limit.');
    }

    expandedBytes += expandedSize;
    compressedBytes += compressedSize;
    if (!hasSignature(bytes, localHeaderOffset, 0x04034b50) || localHeaderOffset + 30 > directoryOffset) {
      fail('SOURCE_MALFORMED', 'container', 'The DOCX ZIP local header is malformed.');
    }
    const localFlags = u16(bytes, localHeaderOffset + 6);
    const localMethod = u16(bytes, localHeaderOffset + 8);
    const localNameLength = u16(bytes, localHeaderOffset + 26);
    const localExtraLength = u16(bytes, localHeaderOffset + 28);
    const localDataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
    if (
      localFlags !== flags ||
      localMethod !== method ||
      localDataOffset + compressedSize > directoryOffset ||
      decodeEntryName(bytes.subarray(localHeaderOffset + 30, localHeaderOffset + 30 + localNameLength)) !== name
    ) {
      fail('SOURCE_MALFORMED', 'container', 'The DOCX ZIP local and central headers disagree.');
    }
    if ((flags & 0x8) === 0 && (
      u32(bytes, localHeaderOffset + 14) !== crc ||
      u32(bytes, localHeaderOffset + 18) !== compressedSize ||
      u32(bytes, localHeaderOffset + 22) !== expandedSize
    )) {
      fail('SOURCE_MALFORMED', 'container', 'The DOCX ZIP local integrity metadata is inconsistent.');
    }
    entries.push({ name, compressedSize, expandedSize, crc });
    offset = end;
  }

  if (offset !== eocd) {
    fail('SOURCE_MALFORMED', 'container', 'The DOCX ZIP directory size is inconsistent.');
  }
  if (expandedBytes / Math.max(1, compressedBytes) > limits.maxCompressionRatio) {
    fail('RESOURCE_LIMIT_EXCEEDED', 'container', 'The DOCX exceeds the aggregate compression-ratio limit.');
  }
  return { entries, expandedBytes };
}

function validateEntryPath(name) {
  if (
    !name ||
    name.includes('\\') ||
    name.includes('\0') ||
    name.startsWith('/') ||
    /(^|\/)\.\.?($|\/)/.test(name)
  ) {
    fail('SOURCE_MALFORMED', 'security', 'The DOCX contains an unsafe ZIP entry path.');
  }
  if (MACRO_ENTRY.test(name) || /(?:^|\/)macros?(?:\/|$)/i.test(name)) {
    fail('SOURCE_MALFORMED', 'security', 'Macro-enabled DOCX content is not allowed.');
  }
  if (name.endsWith('/')) {
    if (!/^(?:_rels|docProps|word(?:\/(?:_rels|theme|media|fonts))?|customXml(?:\/_rels)?)\/$/i.test(name)) {
      fail('SOURCE_MALFORMED', 'security', 'The DOCX contains a ZIP directory outside the allowlist.');
    }
    return;
  }

  // ITI's own VPAT 2.5Rev WCAG template contains two inert package-debris
  // records produced by Word. They are neither parsed nor exposed.
  if (/^\[trash\]\/\d{4}\.dat$/i.test(name)) return;

  const allowed =
    name === '[Content_Types].xml' ||
    name === '_rels/.rels' ||
    /^docProps\/(?:app|core|custom)\.xml$/i.test(name) ||
    /^docProps\/thumbnail\.(?:jpe?g|png)$/i.test(name) ||
    /^word\/(?:document|styles(?:WithEffects)?|numbering|settings|fontTable|webSettings|footnotes|endnotes|comments(?:Extended|Ids)?|people)\.xml$/i.test(name) ||
    /^word\/(?:header|footer)\d+\.xml$/i.test(name) ||
    /^word\/_rels\/[A-Za-z0-9_.-]+\.rels$/i.test(name) ||
    /^word\/theme\/theme\d+\.xml$/i.test(name) ||
    /^word\/media\/[A-Za-z0-9_.-]+\.(?:png|jpe?g|gif|bmp|tiff?|svg|emf|wmf)$/i.test(name) ||
    /^word\/fonts\/[A-Za-z0-9_.-]+\.odttf$/i.test(name) ||
    /^customXml\/(?:item\d+|itemProps\d+)\.xml$/i.test(name) ||
    /^customXml\/_rels\/item\d+\.xml\.rels$/i.test(name);

  if (!allowed) {
    fail('SOURCE_MALFORMED', 'security', 'The DOCX contains a ZIP entry outside the allowlist.');
  }
}

function crc32(bytes, budget) {
  let crc = 0xffffffff;
  for (let offset = 0; offset < bytes.length; offset += 1) {
    if (offset % 1024 === 0) consumeWork(budget);
    crc ^= bytes[offset];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function inflatePackage(bytes, directory, budget) {
  let files;
  try {
    files = unzipSync(bytes);
  } catch (error) {
    fail('SOURCE_MALFORMED', 'container', 'The DOCX ZIP data could not be decompressed.', error);
  }

  const actualNames = Object.keys(files).filter((name) => !name.endsWith('/'));
  const declaredFiles = directory.entries.filter(({ name }) => !name.endsWith('/'));
  if (actualNames.length !== declaredFiles.length) {
    fail('SOURCE_MALFORMED', 'container', 'The DOCX ZIP directory does not match its extracted entries.');
  }
  for (const entry of declaredFiles) {
    const content = files[entry.name];
    if (!(content instanceof Uint8Array) || content.byteLength !== entry.expandedSize) {
      fail('SOURCE_MALFORMED', 'container', 'A DOCX entry has an inconsistent extracted size.');
    }
    if (crc32(content, budget) !== entry.crc) {
      fail('SOURCE_MALFORMED', 'container', 'A DOCX entry failed its ZIP integrity check.');
    }
  }
  for (const required of REQUIRED_ENTRIES) {
    if (!(files[required] instanceof Uint8Array)) {
      fail('SOURCE_MALFORMED', 'package', `Required DOCX entry is missing: ${required}.`);
    }
  }
  return files;
}

function decodeXml(bytes, entryName) {
  let text;
  try {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      text = new TextDecoder('utf-16le', { fatal: true }).decode(bytes.subarray(2));
    } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      const swapped = new Uint8Array(bytes.length - 2);
      for (let index = 2; index + 1 < bytes.length; index += 2) {
        swapped[index - 2] = bytes[index + 1];
        swapped[index - 1] = bytes[index];
      }
      text = new TextDecoder('utf-16le', { fatal: true }).decode(swapped);
    } else {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    }
  } catch (error) {
    fail('SOURCE_MALFORMED', 'xml', 'A DOCX XML part has an invalid encoding.', error);
  }
  if (/<!DOCTYPE\b|<!ENTITY\b/i.test(text)) {
    fail('SOURCE_MALFORMED', 'security', 'DOCTYPE and ENTITY declarations are forbidden in DOCX XML.');
  }
  return text.replace(/^\uFEFF/, '');
}

function decodeEntities(value, entryName) {
  if (/&(?!(?:amp|lt|gt|quot|apos|#(?:x[0-9a-f]+|[0-9]+));)/i.test(value)) {
    fail('SOURCE_MALFORMED', 'xml', 'A DOCX XML part contains a malformed entity reference.');
  }
  return value.replace(/&([^;]+);/g, (full, entity) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[entity];
    if (named !== undefined) return named;
    const numeric = entity.match(/^#(x[0-9a-f]+|[0-9]+)$/i);
    if (numeric) {
      const codePoint = numeric[1][0].toLowerCase() === 'x'
        ? Number.parseInt(numeric[1].slice(1), 16)
        : Number.parseInt(numeric[1], 10);
      const validXmlCharacter =
        codePoint === 0x9 ||
        codePoint === 0xa ||
        codePoint === 0xd ||
        (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
        (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
        (codePoint >= 0x10000 && codePoint <= 0x10ffff);
      if (Number.isInteger(codePoint) && validXmlCharacter) return String.fromCodePoint(codePoint);
    }
    fail('SOURCE_MALFORMED', 'xml', 'A DOCX XML part contains an unsupported entity.');
  });
}

function findTagEnd(xml, start, entryName) {
  let quote = '';
  for (let index = start; index < xml.length; index += 1) {
    const char = xml[index];
    if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return index;
    }
  }
  fail('SOURCE_MALFORMED', 'xml', 'A DOCX XML part contains an unterminated tag.');
}

function validateQualifiedName(name) {
  const parts = name.split(':');
  if (
    parts.length > 2 ||
    parts.some((part) => !/^[A-Za-z_][\w.-]*$/.test(part))
  ) {
    fail('SOURCE_MALFORMED', 'xml', 'A DOCX XML part contains a malformed qualified name.');
  }
}

function parseAttributes(raw, entryName) {
  const attributes = Object.create(null);
  let offset = 0;
  while (offset < raw.length) {
    while (/\s/.test(raw[offset] || '')) offset += 1;
    if (offset >= raw.length) break;
    const nameMatch = raw.slice(offset).match(/^([A-Za-z_][\w.:-]*)/);
    if (!nameMatch) fail('SOURCE_MALFORMED', 'xml', 'A DOCX XML part contains a malformed attribute.');
    const name = nameMatch[1];
    validateQualifiedName(name);
    offset += name.length;
    while (/\s/.test(raw[offset] || '')) offset += 1;
    if (raw[offset] !== '=') fail('SOURCE_MALFORMED', 'xml', 'A DOCX XML attribute is missing a value.');
    offset += 1;
    while (/\s/.test(raw[offset] || '')) offset += 1;
    const quote = raw[offset];
    if (quote !== '"' && quote !== "'") fail('SOURCE_MALFORMED', 'xml', 'A DOCX XML attribute is not quoted.');
    const end = raw.indexOf(quote, offset + 1);
    if (end < 0) fail('SOURCE_MALFORMED', 'xml', 'A DOCX XML attribute is unterminated.');
    if (Object.hasOwn(attributes, name)) fail('SOURCE_MALFORMED', 'xml', 'A DOCX XML part contains a duplicate attribute.');
    const rawValue = raw.slice(offset + 1, end);
    if (rawValue.includes('<')) fail('SOURCE_MALFORMED', 'xml', 'A DOCX XML part contains a malformed attribute.');
    attributes[name] = decodeEntities(rawValue, entryName);
    offset = end + 1;
  }
  return attributes;
}

function parseXml(xml, entryName, nodeBudget, budget) {
  const document = { name: '#document', localName: '#document', namespaceURI: '', namespaces: Object.create(null), attributes: {}, children: [] };
  const stack = [document];
  let offset = 0;

  while (offset < xml.length) {
    consumeWork(budget);
    const open = xml.indexOf('<', offset);
    if (open < 0) {
      const text = decodeEntities(xml.slice(offset), entryName);
      if (stack.length === 1 && text.trim()) {
        fail('SOURCE_MALFORMED', 'xml', 'A DOCX XML part contains text outside its root element.');
      }
      if (text) stack.at(-1).children.push(text);
      break;
    }
    if (open > offset) {
      const text = decodeEntities(xml.slice(offset, open), entryName);
      if (stack.length === 1 && text.trim()) {
        fail('SOURCE_MALFORMED', 'xml', 'A DOCX XML part contains text outside its root element.');
      }
      stack.at(-1).children.push(text);
    }

    if (xml.startsWith('<!--', open)) {
      const end = xml.indexOf('-->', open + 4);
      if (end < 0) fail('SOURCE_MALFORMED', 'xml', 'A DOCX XML part contains an unterminated comment.');
      offset = end + 3;
      continue;
    }
    if (xml.startsWith('<?', open)) {
      const end = xml.indexOf('?>', open + 2);
      if (end < 0) fail('SOURCE_MALFORMED', 'xml', 'A DOCX XML part contains an unterminated processing instruction.');
      offset = end + 2;
      continue;
    }
    if (xml.startsWith('<![CDATA[', open)) {
      const end = xml.indexOf(']]>', open + 9);
      if (end < 0) fail('SOURCE_MALFORMED', 'xml', 'A DOCX XML part contains an unterminated CDATA section.');
      if (stack.length === 1) fail('SOURCE_MALFORMED', 'xml', 'A DOCX XML part contains CDATA outside its root element.');
      stack.at(-1).children.push(xml.slice(open + 9, end));
      offset = end + 3;
      continue;
    }
    if (xml.startsWith('<!', open)) {
      fail('SOURCE_MALFORMED', 'security', 'A DOCX XML part contains an unsupported declaration.');
    }

    const end = findTagEnd(xml, open + 1, entryName);
    let raw = xml.slice(open + 1, end).trim();
    if (raw.startsWith('/')) {
      const closeName = raw.slice(1).trim();
      if (!/^[A-Za-z_][\w.:-]*$/.test(closeName) || stack.length === 1 || stack.at(-1).name !== closeName) {
        fail('SOURCE_MALFORMED', 'xml', 'A DOCX XML part contains a mismatched closing tag.');
      }
      stack.pop();
      offset = end + 1;
      continue;
    }

    const selfClosing = raw.endsWith('/');
    if (selfClosing) raw = raw.slice(0, -1).trimEnd();
    const nameMatch = raw.match(/^([A-Za-z_][\w.:-]*)(?:\s|$)/);
    if (!nameMatch) fail('SOURCE_MALFORMED', 'xml', 'A DOCX XML part contains a malformed element.');
    const name = nameMatch[1];
    validateQualifiedName(name);
    const attributes = parseAttributes(raw.slice(name.length), entryName);
    const namespaces = Object.create(stack.at(-1).namespaces || null);
    for (const [attributeName, value] of Object.entries(attributes)) {
      if (attributeName === 'xmlns') namespaces[''] = value;
      else if (attributeName.startsWith('xmlns:')) namespaces[attributeName.slice(6)] = value;
    }
    const separator = name.indexOf(':');
    const prefix = separator < 0 ? '' : name.slice(0, separator);
    const node = {
      name,
      localName: name.includes(':') ? name.slice(name.lastIndexOf(':') + 1) : name,
      namespaceURI: namespaces[prefix] || '',
      namespaces,
      attributes,
      children: [],
    };
    nodeBudget.count += 1;
    if (nodeBudget.count > nodeBudget.limit) {
      fail('RESOURCE_LIMIT_EXCEEDED', 'xml', 'The DOCX exceeds the XML-node limit.');
    }
    stack.at(-1).children.push(node);
    if (!selfClosing) {
      stack.push(node);
      if (stack.length - 1 > nodeBudget.maxDepth) {
        fail('RESOURCE_LIMIT_EXCEEDED', 'xml', 'The DOCX exceeds the XML-depth limit.');
      }
    }
    offset = end + 1;
  }

  if (stack.length !== 1 || document.children.filter((child) => typeof child !== 'string').length !== 1) {
    fail('SOURCE_MALFORMED', 'xml', 'A DOCX XML part is malformed.');
  }
  return document.children.find((child) => typeof child !== 'string');
}

function elements(node, localName, namespaceSet) {
  return node.children.filter((child) =>
    typeof child !== 'string' &&
    (!localName || child.localName === localName) &&
    (!namespaceSet || namespaceSet.has(child.namespaceURI))
  );
}

function descendants(node, localName, stopAt = new Set(), namespaceSet) {
  const found = [];
  const visit = (candidate) => {
    for (const child of elements(candidate)) {
      if (child.localName === localName && (!namespaceSet || namespaceSet.has(child.namespaceURI))) found.push(child);
      const stop = stopAt.has(child.localName) && (!namespaceSet || namespaceSet.has(child.namespaceURI));
      if (!stop) visit(child);
    }
  };
  visit(node);
  return found;
}

function namespacedAttribute(node, localName, allowedNamespaces) {
  const candidates = [];
  for (const [name, value] of Object.entries(node.attributes)) {
    if (name === 'xmlns' || name.startsWith('xmlns:')) continue;
    const separator = name.indexOf(':');
    const candidateLocalName = separator < 0 ? name : name.slice(separator + 1);
    if (candidateLocalName !== localName) continue;
    const prefix = separator < 0 ? '' : name.slice(0, separator);
    candidates.push({
      prefixed: separator >= 0,
      namespaceURI: prefix ? node.namespaces[prefix] : '',
      value,
    });
  }
  if (candidates.length > 1) {
    fail('SOURCE_MALFORMED', 'security', 'A DOCX XML element contains ambiguous attributes.');
  }
  const candidate = candidates[0];
  const recognized = candidate && (
    candidate.prefixed
      ? Boolean(candidate.namespaceURI) && allowedNamespaces.has(candidate.namespaceURI)
      : allowedNamespaces.has('')
  );
  return recognized
    ? candidate.value
    : undefined;
}

function packageAttribute(node, localName) {
  return namespacedAttribute(node, localName, UNQUALIFIED_ATTRIBUTE_NAMESPACES);
}

function wordAttribute(node, localName) {
  return namespacedAttribute(node, localName, WORD_NAMESPACES);
}

function elementNamespace(node) {
  return node.namespaceURI;
}

function validatePackageXml(files, limits, budget) {
  const parsed = new Map();
  const nodeBudget = { count: 0, limit: limits.maxXmlNodes, maxDepth: limits.maxXmlDepth };
  let xmlCharacterCount = 0;
  for (const [name, bytes] of Object.entries(files)) {
    consumeWork(budget);
    if (!XML_ENTRY.test(name)) continue;
    const xml = decodeXml(bytes, name);
    if (xml.length > limits.maxXmlChars - xmlCharacterCount) {
      fail('RESOURCE_LIMIT_EXCEEDED', 'xml', 'The DOCX exceeds the aggregate XML-character limit.');
    }
    xmlCharacterCount += xml.length;
    const root = parseXml(xml, name, nodeBudget, budget);
    parsed.set(name, root);
  }
  return { parsed, xmlNodeCount: nodeBudget.count, xmlCharacterCount };
}

function validateContentTypes(root) {
  if (root.localName !== 'Types' || !CONTENT_TYPES_NAMESPACES.has(elementNamespace(root))) {
    fail('SOURCE_MALFORMED', 'package', 'Invalid OOXML content-types manifest.');
  }
  for (const declaration of [...descendants(root, 'Default', new Set(), CONTENT_TYPES_NAMESPACES), ...descendants(root, 'Override', new Set(), CONTENT_TYPES_NAMESPACES)]) {
    const contentType = packageAttribute(declaration, 'ContentType') || '';
    if (/macroenabled|vbaProject/i.test(contentType)) {
      fail('SOURCE_MALFORMED', 'security', 'Macro-enabled DOCX content is not allowed.');
    }
  }
  const documentOverride = descendants(root, 'Override', new Set(), CONTENT_TYPES_NAMESPACES).find(
    (node) => (packageAttribute(node, 'PartName') || '').replace(/^\//, '') === 'word/document.xml',
  );
  if (!documentOverride || packageAttribute(documentOverride, 'ContentType') !== DOCUMENT_CONTENT_TYPE) {
    fail('SOURCE_MALFORMED', 'package', 'The package does not declare a standard DOCX main document.');
  }
}

function validateRelationships(parsed) {
  for (const [name, root] of parsed) {
    if (!name.endsWith('.rels')) continue;
    if (root.localName !== 'Relationships' || !RELATIONSHIPS_NAMESPACES.has(elementNamespace(root))) {
      fail('SOURCE_MALFORMED', 'package', 'The DOCX contains an invalid relationships document.');
    }
    for (const relationship of descendants(root, 'Relationship', new Set(), RELATIONSHIPS_NAMESPACES)) {
      const targetMode = packageAttribute(relationship, 'TargetMode') || '';
      const target = packageAttribute(relationship, 'Target') || '';
      const type = packageAttribute(relationship, 'Type') || '';
      const external = /^external$/i.test(targetMode) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(target);
      if (external && !HYPERLINK_RELATIONSHIP.test(type)) {
        fail('SOURCE_MALFORMED', 'security', 'External active OOXML relationships are not allowed.');
      }
      if (UNSAFE_RELATIONSHIP.test(type)) {
        fail('SOURCE_MALFORMED', 'security', 'Active or embedded OOXML relationships are not allowed.');
      }
    }
  }

  const rootRelationships = parsed.get('_rels/.rels');
  const main = descendants(rootRelationships, 'Relationship', new Set(), RELATIONSHIPS_NAMESPACES).find((node) => OFFICE_DOCUMENT_REL.test(packageAttribute(node, 'Type') || ''));
  if (!main || (packageAttribute(main, 'Target') || '').replace(/^\//, '') !== 'word/document.xml') {
    fail('SOURCE_MALFORMED', 'package', 'The package root does not target word/document.xml.');
  }
}

function normalizeText(value) {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n+ */g, ' ')
    .trim();
}

function paragraphText(paragraph) {
  let value = '';
  const walk = (node) => {
    for (const child of node.children) {
      if (typeof child === 'string') {
        if (node.localName === 't' && WORD_NAMESPACES.has(node.namespaceURI)) value += child;
        continue;
      }
      if (!WORD_NAMESPACES.has(child.namespaceURI)) continue;
      if (child.localName === 'tab' || child.localName === 'br' || child.localName === 'cr') value += ' ';
      else walk(child);
    }
  };
  walk(paragraph);
  return normalizeText(value);
}

function paragraphHeadingLevel(paragraph) {
  const properties = elements(paragraph, 'pPr', WORD_NAMESPACES)[0];
  const style = properties ? firstDescendant(properties, 'pStyle') : undefined;
  const value = String(style ? wordAttribute(style, 'val') || '' : '').replace(/[\s_-]+/g, '').toLowerCase();
  if (value === 'title') return 1;
  const heading = value.match(/^heading([1-9])$/);
  return heading ? Number(heading[1]) : 0;
}

function wordElements(node, localName) {
  return elements(node, localName, WORD_NAMESPACES);
}

function wordDescendants(node, localName, stopAt = new Set()) {
  return descendants(node, localName, stopAt, WORD_NAMESPACES);
}

function tableContext(headings, nearestProse) {
  const values = [...headings.filter(Boolean), nearestProse].filter(Boolean);
  return normalizeText(values.join(' | ')).slice(0, 2000);
}

function cellText(cell) {
  if (wordDescendants(cell, 'tbl').length) {
    fail('SOURCE_MALFORMED', 'extract', 'Nested DOCX tables inside table cells cannot be analyzed safely.');
  }
  return normalizeText(wordDescendants(cell, 'p', new Set(['tbl'])).map(paragraphText).filter(Boolean).join(' '));
}

function directTableRows(table) {
  return wordDescendants(table, 'tr', new Set(['tbl']));
}

function directRowCells(row) {
  return wordDescendants(row, 'tc', new Set(['tr', 'tbl']));
}

function firstDescendant(node, localName) {
  return wordDescendants(node, localName)[0];
}

function cellProperty(cell, localName) {
  const properties = wordElements(cell, 'tcPr')[0];
  return properties ? firstDescendant(properties, localName) : undefined;
}

function rowGridOffset(row, localName, limits) {
  const properties = wordElements(row, 'trPr')[0];
  const offsetNode = properties ? firstDescendant(properties, localName) : undefined;
  if (!offsetNode) return 0;
  const value = Number(wordAttribute(offsetNode, 'val'));
  if (!Number.isInteger(value) || value < 0 || value > limits.maxCells) {
    fail('SOURCE_MALFORMED', 'extract', `Invalid DOCX ${localName} value.`);
  }
  return value;
}

function reserveCells(state, count) {
  if (state.cellCount + count > state.limits.maxCells) {
    fail('RESOURCE_LIMIT_EXCEEDED', 'extract', 'The DOCX exceeds the table-cell limit.');
  }
  state.cellCount += count;
}

function consumeText(budget, text) {
  if (text.length > budget.remaining) {
    fail('RESOURCE_LIMIT_EXCEEDED', 'extract', 'The DOCX exceeds the extracted-text limit.');
  }
  budget.remaining -= text.length;
  return text;
}

function expandRow(row, state) {
  const leadingCells = rowGridOffset(row, 'gridBefore', state.limits);
  const trailingCells = rowGridOffset(row, 'gridAfter', state.limits);
  reserveCells(state, leadingCells + trailingCells);
  const output = Array.from({ length: leadingCells }, () => '');
  const priorVerticalMerges = state.verticalMerges;
  const nextVerticalMerges = new Map();
  let column = leadingCells;
  for (const cell of directRowCells(row)) {
    consumeWork(state.budget);
    const spanNode = cellProperty(cell, 'gridSpan');
    const rawSpan = spanNode ? wordAttribute(spanNode, 'val') : '1';
    const span = Number(rawSpan || 1);
    if (!Number.isInteger(span) || span < 1 || span > state.limits.maxCells) {
      fail('SOURCE_MALFORMED', 'extract', 'Invalid DOCX gridSpan value.');
    }
    reserveCells(state, span);

    const merge = cellProperty(cell, 'vMerge');
    const mergeValue = merge ? (wordAttribute(merge, 'val') || 'continue').toLowerCase() : '';
    if (merge && mergeValue !== 'restart' && mergeValue !== 'continue') {
      fail('SOURCE_MALFORMED', 'extract', 'Invalid DOCX vMerge value.');
    }
    let text = cellText(cell);
    let mergeGroup;
    if (mergeValue === 'continue') {
      mergeGroup = priorVerticalMerges.get(column);
      const topologyMatches =
        mergeGroup &&
        mergeGroup.start === column &&
        mergeGroup.span === span &&
        Array.from({ length: span }, (_, offset) => priorVerticalMerges.get(column + offset))
          .every((candidate) => candidate === mergeGroup);
      if (!topologyMatches || text) {
        fail('SOURCE_MALFORMED', 'extract', 'Invalid DOCX vertical-merge continuation.');
      }
      text = mergeGroup.value;
    } else if (mergeValue === 'restart') {
      mergeGroup = { start: column, span, value: text };
    }
    text = consumeText(state.textBudget, text);
    output.push(text, ...Array.from({ length: span - 1 }, () => ''));

    for (let offset = 0; offset < span; offset += 1) {
      if (mergeGroup) nextVerticalMerges.set(column + offset, mergeGroup);
    }
    column += span;
  }
  output.push(...Array.from({ length: trailingCells }, () => ''));
  state.verticalMerges = nextVerticalMerges;
  return output;
}

function parseTable(table, sourceOrder, context, state) {
  const sourceRows = directTableRows(table);
  if (state.rowCount + sourceRows.length > state.limits.maxRows) {
    fail('RESOURCE_LIMIT_EXCEEDED', 'extract', 'The DOCX exceeds the table-row limit.');
  }
  state.rowCount += sourceRows.length;
  const rowState = { ...state, verticalMerges: new Map() };
  const logicalRows = sourceRows.map((row) => expandRow(row, rowState));
  state.cellCount = rowState.cellCount;
  return {
    tableId: `docx-table-${sourceOrder + 1}`,
    sourceOrder,
    context,
    headers: logicalRows[0] || [],
    rows: logicalRows.slice(1).map((cells, index) => ({ sourceRowIndex: index + 1, cells })),
  };
}

function extractCandidateDocument(documentRoot, limits, packageMetadata, budget) {
  if (documentRoot.localName !== 'document' || !WORD_NAMESPACES.has(elementNamespace(documentRoot))) {
    fail('SOURCE_MALFORMED', 'extract', 'The DOCX main part is not a Word document.');
  }
  const body = firstDescendant(documentRoot, 'body');
  if (!body) fail('SOURCE_MALFORMED', 'extract', 'The DOCX main document has no body.');

  const bodyProse = [];
  const tables = [];
  const state = {
    limits,
    rowCount: 0,
    cellCount: 0,
    textBudget: { remaining: limits.maxTextChars },
    budget,
  };
  let context = '';
  const headings = Array(9).fill('');

  const walk = (node) => {
    for (const child of wordElements(node)) {
      consumeWork(budget);
      if (child.localName === 'tbl') {
        if (tables.length >= limits.maxTables) {
          fail('RESOURCE_LIMIT_EXCEEDED', 'extract', 'The DOCX exceeds the table-count limit.');
        }
        tables.push(parseTable(child, tables.length, tableContext(headings, context), state));
      } else if (child.localName === 'p') {
        const text = paragraphText(child);
        if (text) {
          consumeText(state.textBudget, text);
          bodyProse.push(text);
          context = text;
          const headingLevel = paragraphHeadingLevel(child);
          if (headingLevel) {
            headings[headingLevel - 1] = text;
            for (let index = headingLevel; index < headings.length; index += 1) headings[index] = '';
          }
        }
      } else {
        walk(child);
      }
    }
  };
  walk(body);

  return {
    bodyProse,
    tables,
    metadata: {
      format: 'docx',
      adapter: 'fflate-ooxml',
      parser: 'fflate-ooxml',
      parserVersion: '1.0.0',
      sourceBytes: packageMetadata.sourceBytes,
      zipEntryCount: packageMetadata.zipEntryCount,
      expandedBytes: packageMetadata.expandedBytes,
      xmlNodeCount: packageMetadata.xmlNodeCount,
      xmlCharacterCount: packageMetadata.xmlCharacterCount,
      tableCount: tables.length,
      bodyParagraphCount: bodyProse.length,
    },
  };
}

export function parseDocxBytesSync(input, options = {}) {
  try {
    const limits = resolveLimits(options.limits);
    const budget = createBudget(limits);
    const bytes = asBytes(input);
    const directory = readZipDirectory(bytes, limits, budget);
    const files = inflatePackage(bytes, directory, budget);
    consumeWork(budget, directory.entries.length);
    const { parsed, xmlNodeCount, xmlCharacterCount } = validatePackageXml(files, limits, budget);
    validateContentTypes(parsed.get('[Content_Types].xml'));
    validateRelationships(parsed);
    return extractCandidateDocument(parsed.get('word/document.xml'), limits, {
      sourceBytes: bytes.byteLength,
      zipEntryCount: directory.entries.length,
      expandedBytes: directory.expandedBytes,
      xmlNodeCount,
      xmlCharacterCount,
    }, budget);
  } catch (error) {
    if (error instanceof IngestionParserError) throw error;
    fail('SOURCE_MALFORMED', 'parse', 'The DOCX could not be parsed safely.', error);
  }
}

export async function parseDocxBytes(input, options = {}) {
  return parseDocxBytesSync(input, options);
}

export const DOCX_PARSER_DEFAULT_LIMITS = DEFAULT_LIMITS;
