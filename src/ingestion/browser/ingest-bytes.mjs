import { parseDocxBytes } from "./docx-parser.mjs";
import { parsePdfBytes } from "./pdf-parser.mjs";
import { ingestCandidateDocument, validateIngestionResult } from "../core/index.mjs";

const MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MIME_PDF = "application/pdf";

function baseResult(requestId, sourceType, catalogVersion = "1.0.0") {
  return {
    schemaVersion: "1.0.0",
    requestId:
      typeof requestId === "string" && requestId.length >= 1 && requestId.length <= 128
        ? requestId
        : "invalid-request",
    parserVersion: "1.0.0",
    catalogVersion: catalogVersion === "1.0.0" ? catalogVersion : "1.0.0",
    sourceType: ["google-doc", "docx", "pdf"].includes(sourceType) ? sourceType : "unknown",
  };
}

function rejected(base, code, stage, safeMessage) {
  const result = { ...base, status: "rejected", rejection: { code, stage, safeMessage } };
  try {
    return validateIngestionResult(result);
  } catch {
    return validateIngestionResult({
      ...base,
      status: "rejected",
      rejection: {
        code: "SOURCE_MALFORMED",
        stage: "container-parse",
        safeMessage: "The source structure is malformed and could not be analyzed.",
      },
    });
  }
}

function classifyBytes(bytes, mimeType) {
  const isPdf =
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d;
  const isZip =
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04;

  if (mimeType === MIME_PDF && isPdf) return "pdf";
  if (mimeType === MIME_DOCX && isZip) return "docx";
  return "unknown";
}

function parserFailure(error, base) {
  const code = typeof error?.code === "string" ? error.code : "SOURCE_MALFORMED";
  const stage = typeof error?.stage === "string" ? error.stage : "container-parse";
  const safeMessage =
    typeof error?.safeMessage === "string" && error.safeMessage
      ? error.safeMessage
      : "The source is malformed and could not be analyzed safely.";
  return rejected(base, code, stage, safeMessage);
}

function detectVpatVersions(candidateDocument) {
  // Version identity is document metadata, not report evidence. Restrict the
  // scan to bounded prose and field/value metadata so historical version text
  // inside remarks cannot poison classification.
  const bodyIdentityValues = (Array.isArray(candidateDocument?.bodyProse) ? candidateDocument.bodyProse : [])
    .slice(0, 32);
  const metadataValues = [];
  for (const table of Array.isArray(candidateDocument?.tables) ? candidateDocument.tables : []) {
    const headers = Array.isArray(table?.headers) ? table.headers : [];
    const isMetadata = headers.some(value => /^field$/i.test(String(value).trim())) &&
      headers.some(value => /^value$/i.test(String(value).trim()));
    if (!isMetadata) continue;
    for (const row of Array.isArray(table?.rows) ? table.rows : []) {
      if (Array.isArray(row?.cells) && /vpat\s*(?:template\s*)?version/i.test(String(row.cells[0] ?? ""))) {
        metadataValues.push(`VPAT version ${String(row.cells[1] ?? "")}`);
      }
    }
  }
  const versions = new Set();
  const normalizedBody = bodyIdentityValues.map(value => String(value).normalize("NFKC").trim());
  const identityValues = [...normalizedBody, ...metadataValues];
  for (const value of identityValues) {
    // Accept only explicit VPAT/template identity forms. An arbitrary nearby
    // product or changelog version must never become the template version.
    for (const match of value.matchAll(/\bVPAT\s*[\u00ae®]?(?:\s+template)?(?:\s+(?:template\s+)?version)?\s*(\d+(?:\.\d+)+)(?:rev)?(?![.\d])/gi)) {
      versions.add(match[1]);
    }
    for (const match of value.matchAll(/\btemplate\s+version\s*(\d+(?:\.\d+)+)(?:rev)?(?![.\d])/gi)) {
      versions.add(match[1]);
    }
  }
  // Official VPAT 2.5Rev separates its identity and version into adjacent
  // paragraphs. Bind only an exact next-item Version field to a VPAT item.
  for (let index = 0; index + 1 < normalizedBody.length; index += 1) {
    if (!/\bVPAT(?:\s*[\u00ae®])?(?:\W|$)/i.test(normalizedBody[index])) continue;
    for (let offset = 1; offset <= 2 && index + offset < normalizedBody.length; offset += 1) {
      const next = normalizedBody[index + offset];
      const adjacent = next.match(/^version\s*(\d+(?:\.\d+)+)(?:rev)?$/i);
      if (adjacent) {
        versions.add(adjacent[1]);
        break;
      }
      if (!/^(?:wcag|international|eu|en\s+301\s+549|revised section 508)\s+edition$/i.test(next)) break;
    }
  }
  return versions;
}

function collectVersionList(value, versionSet) {
  for (const match of value.matchAll(/\b(?:web content accessibility guidelines|wcag)\s*((?:2\.[012])(?:\s*(?:(?:,|\/)\s*(?:and\s+)?|\band\s+)(?:2\.[012]))*)/gi)) {
    for (const version of match[1].matchAll(/\b2\.[012]\b/g)) versionSet.add(version[0]);
    const range = match[1].match(/^(2\.[012])\s+through\s+(2\.[012])$/i);
    if (range) {
      for (const version of ["2.0", "2.1", "2.2"]) {
        if (version >= range[1] && version <= range[2]) versionSet.add(version);
      }
    }
  }
  const range = value.match(/\b(?:web content accessibility guidelines|wcag)\s*(2\.[012])\s+through\s+(2\.[012])\b/i);
  if (range) {
    for (const version of ["2.0", "2.1", "2.2"]) {
      if (version >= range[1] && version <= range[2]) versionSet.add(version);
    }
  }
}

function collectLevelList(value, levelSet) {
  for (const match of value.matchAll(/\blevels?\s*((?:AAA|AA|A)(?:\s*(?:(?:,|\/)\s*(?:and\s+)?|\band\s+)(?:AAA|AA|A))*)/gi)) {
    for (const level of match[1].matchAll(/\b(?:AAA|AA|A)\b/gi)) {
      levelSet.add(level[0].toUpperCase());
    }
  }
  for (const match of value.matchAll(/\b(?:web content accessibility guidelines|wcag)\s*2\.[012](?:\s*(?:,|\/|\band\b)\s*2\.[012])*\s+((?:AAA|AA|A)(?:\s*(?:(?:,|\/)\s*(?:and\s+)?|\band\s+)(?:AAA|AA|A))*)\b/gi)) {
    for (const level of match[1].matchAll(/\b(?:AAA|AA|A)\b/gi)) levelSet.add(level[0].toUpperCase());
  }
}

function deriveDeclaredScope(candidateDocument) {
  const values = [
    ...(Array.isArray(candidateDocument?.bodyProse) ? candidateDocument.bodyProse : []),
    ...(Array.isArray(candidateDocument?.tables)
      ? candidateDocument.tables.flatMap(table => [table?.context ?? "", ...(table?.headers ?? [])])
      : []),
  ].filter(value => typeof value === "string");

  const versionSet = new Set();
  const levelSet = new Set();
  for (const raw of values) {
    const value = raw.normalize("NFKC");
    collectVersionList(value, versionSet);
    collectLevelList(value, levelSet);
  }

  // Fail open only within the immutable 87-item catalog union: an edition
  // whose converted representation loses headings must retain rows rather
  // than silently dropping a WCAG version or level.
  return {
    declaredWcagVersions: ["2.0", "2.1", "2.2"].filter(version =>
      versionSet.size === 0 || versionSet.has(version)),
    declaredLevels: ["A", "AA", "AAA"].filter(level =>
      levelSet.size === 0 || levelSet.has(level)),
  };
}

export function ingestStructuredSource({
  requestId,
  sourceType,
  candidateDocument,
  catalog,
  declaredWcagVersions,
  declaredLevels,
}) {
  const base = baseResult(requestId, sourceType, catalog?.version);
  const vpatVersions = detectVpatVersions(candidateDocument);
  if (vpatVersions.size !== 1 || !vpatVersions.has("2.5")) {
    return rejected(
      base,
      "VPAT_VERSION_UNSUPPORTED",
      "classification",
      "The source does not declare one supported VPAT 2.5 template version.",
    );
  }
  const derivedScope = deriveDeclaredScope(candidateDocument);
  return ingestCandidateDocument({
    requestId,
    sourceType,
    candidateDocument,
    catalog,
    declaredWcagVersions: declaredWcagVersions ?? derivedScope.declaredWcagVersions,
    declaredLevels: declaredLevels ?? derivedScope.declaredLevels,
  });
}

/**
 * Parse authoritative Drive bytes and run the shared deterministic WCAG core.
 * No filename or extension is used for source classification.
 */
export async function ingestSourceBytes({
  requestId,
  bytes,
  mimeType,
  catalog,
  declaredWcagVersions,
  declaredLevels,
  limits = {},
}) {
  if (!(bytes instanceof Uint8Array)) {
    return rejected(
      baseResult(requestId, "unknown", catalog?.version),
      "SOURCE_MALFORMED",
      "transport",
      "The transported source bytes are malformed.",
    );
  }

  const sourceType = classifyBytes(bytes, mimeType);
  const base = baseResult(requestId, sourceType, catalog?.version);
  if (sourceType === "unknown") {
    return rejected(
      base,
      "SOURCE_TYPE_UNSUPPORTED",
      "classification",
      "The authoritative source type and binary signature are unsupported or inconsistent.",
    );
  }

  try {
    const candidateDocument =
      sourceType === "docx"
        ? await parseDocxBytes(bytes, { limits: limits.docx })
        : await parsePdfBytes(bytes, { limits: limits.pdf });
    return ingestStructuredSource({
      requestId,
      sourceType,
      candidateDocument,
      catalog,
      declaredWcagVersions,
      declaredLevels,
    });
  } catch (error) {
    return parserFailure(error, base);
  }
}

export const AUTHORITATIVE_MIME_TYPES = Object.freeze({
  docx: MIME_DOCX,
  pdf: MIME_PDF,
});

export { deriveDeclaredScope };
