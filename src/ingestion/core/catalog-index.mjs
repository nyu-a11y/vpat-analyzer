import { normalizeAliasText } from "./normalization.mjs";

const SUPPORTED_VERSIONS = new Set(["2.0", "2.1", "2.2"]);
const SUPPORTED_LEVELS = new Set(["A", "AA", "AAA"]);

function addAlias(aliasMap, alias, criterion, aliasMatch) {
  const normalized = normalizeAliasText(alias);
  if (!normalized) return;

  const existing = aliasMap.get(normalized);
  if (!existing) {
    aliasMap.set(normalized, [{ criterion, aliasMatch }]);
    return;
  }

  if (!existing.some((entry) => entry.criterion.id === criterion.id)) {
    existing.push({ criterion, aliasMatch });
  }
}

function officialLevelSuffix(criterion) {
  if (criterion.sc === "4.1.1") {
    return " (Level A) WCAG 2.0 and 2.1 – Always answer ‘Supports’ WCAG 2.2 (obsolete and removed) - Does not apply";
  }
  if (criterion.activeIn.length === 1 && criterion.activeIn[0] === "2.2") {
    return ` (Level ${criterion.level} 2.2 only)`;
  }
  if (
    criterion.activeIn.length === 2 &&
    criterion.activeIn[0] === "2.1" &&
    criterion.activeIn[1] === "2.2"
  ) {
    return ` (Level ${criterion.level} 2.1 and 2.2)`;
  }
  return ` (Level ${criterion.level})`;
}

function addOfficialLabelAliases(aliasMap, criterion, title) {
  const base = `${criterion.sc} ${title}`;
  addAlias(aliasMap, base, criterion, "exact-sc-plus-official-title");
  addAlias(aliasMap, `${base} (Level ${criterion.level})`, criterion, "exact-sc-plus-official-title");
  if (criterion.activeIn.includes("2.1")) {
    addAlias(aliasMap, `${base} (Level ${criterion.level} 2.1 only)`, criterion, "exact-sc-plus-official-title");
  }
  addAlias(aliasMap, `${base}${officialLevelSuffix(criterion)}`, criterion, "exact-sc-plus-official-title");
}

const SINGLE_NON_APPLICABLE_TAIL = /^(.*?) (?:en 301 549 criteria|revised section 508)\s*(?:–|-)\s*does not apply$/i;

function isOfficialCrosswalkTail(value) {
  let rest = value.trim();
  let sawStandard = false;
  const tokens = [
    [/^(?:en 301 549 criteria|revised section 508)\b/i, () => { sawStandard = true; }],
    [/^wcag 2\.0(?: and 2\.1)?\b/i],
    [/^wcag 2\.2\b/i],
    [/^always answer [‘']supports[’']/i],
    [/^\(obsolete and removed\)/i],
    [/^does not apply(?: to non-web (?:software|docs))?\b/i],
    [/^\d+(?:\.\d+)*/],
    // ITI 2.5Rev INT/EU contain two literal missing-close-parenthesis
    // crosswalk typos before the following 11.8.2 entry.
    [/^\(closed software(?=\s+11\.8\.2\b)/i],
    [/^\((?:web|software|non-web document|open functionality software|closed(?: functionality)? software|authoring tool|product docs|support docs)\)/i],
    [/^and\b/i],
    [/^(?:–|-)/],
  ];
  let tokenCount = 0;
  while (rest) {
    rest = rest.replace(/^\s+/, "");
    if (!rest) break;
    const token = tokens.find(([pattern]) => pattern.test(rest));
    if (!token) return false;
    const match = rest.match(token[0]);
    token[1]?.();
    rest = rest.slice(match[0].length);
    tokenCount += 1;
    if (tokenCount > 256) return false;
  }
  return sawStandard && tokenCount >= 3;
}

export function buildCatalogIndex(catalog) {
  if (!catalog || typeof catalog !== "object" || !Array.isArray(catalog.criteria)) {
    throw new TypeError("The WCAG catalog is malformed.");
  }
  if (catalog.criteria.length === 0 || catalog.criteria.length > 87) {
    throw new TypeError("The WCAG catalog exceeds the supported v1 boundary.");
  }
  if (typeof catalog.version !== "string" || catalog.version.length === 0) {
    throw new TypeError("The WCAG catalog version is missing.");
  }

  const ids = new Set();
  const scs = new Set();
  const aliasMap = new Map();
  const criteria = [];

  for (const rawCriterion of catalog.criteria) {
    const criterion = rawCriterion && typeof rawCriterion === "object" ? rawCriterion : null;
    if (
      !criterion ||
      typeof criterion.id !== "string" ||
      typeof criterion.sc !== "string" ||
      typeof criterion.title !== "string" ||
      !SUPPORTED_LEVELS.has(criterion.level) ||
      !Array.isArray(criterion.activeIn) ||
      criterion.activeIn.length === 0 ||
      criterion.activeIn.some((version) => !SUPPORTED_VERSIONS.has(version)) ||
      ids.has(criterion.id) ||
      scs.has(criterion.sc)
    ) {
      throw new TypeError("The WCAG catalog contains an invalid or duplicate criterion.");
    }

    ids.add(criterion.id);
    scs.add(criterion.sc);
    criteria.push(criterion);

    addAlias(aliasMap, criterion.sc, criterion, "exact-sc");
    addOfficialLabelAliases(aliasMap, criterion, criterion.title);
    for (const titleAlias of criterion.titleAliases ?? []) {
      if (typeof titleAlias !== "string" || titleAlias.length === 0) {
        throw new TypeError("The WCAG catalog contains an invalid title alias.");
      }
      addOfficialLabelAliases(aliasMap, criterion, titleAlias);
    }
  }

  return { catalogVersion: catalog.version, criteria, aliasMap, ids, scs };
}

export function resolveCriterionLabel(label, index) {
  const normalized = normalizeAliasText(label);
  let matches = index.aliasMap.get(normalized) ?? [];
  if (matches.length === 0) {
    // Official INT/EU/508 templates append finite, data-only crosswalks after
    // an already exact WCAG label. Match the entire suffix grammar; never
    // accept a marker and ignore arbitrary trailing text.
    const crosswalk = normalized.match(/^(.*?) (?:also )?applies to: (.+)$/);
    const nonApplicable = normalized.match(/^(.*?) en 301 549 criteria\s*(?:–|-)\s*does not apply revised section 508\s*(?:–|-)\s*does not apply$/);
    const singleNonApplicable = normalized.match(SINGLE_NON_APPLICABLE_TAIL);
    const prefix = crosswalk?.[1] ?? nonApplicable?.[1] ?? singleNonApplicable?.[1];
    const tail = crosswalk?.[2] ?? "";
    const validCrosswalk = crosswalk && isOfficialCrosswalkTail(tail);
    if (prefix && (validCrosswalk || nonApplicable || singleNonApplicable)) {
      matches = index.aliasMap.get(prefix.trim()) ?? [];
    }
  }
  if (matches.length === 1) return { status: "matched", ...matches[0] };
  if (matches.length > 1) return { status: "ambiguous" };
  return { status: "unmatched" };
}

export function expectedCriterionIds(index, declaredWcagVersions, declaredLevels) {
  const versionSet = new Set(declaredWcagVersions);
  const levelSet = new Set(declaredLevels);
  return index.criteria
    .filter(
      (criterion) =>
        levelSet.has(criterion.level) &&
        criterion.activeIn.some((version) => versionSet.has(version)),
    )
    .map((criterion) => criterion.id);
}

export { SUPPORTED_LEVELS, SUPPORTED_VERSIONS };
