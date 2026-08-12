const REPORT_EVIDENCE_FIELDS = Object.freeze([
  "templateVersion",
  "productDescription",
  "reportDate",
  "contactInformation",
  "evaluationMethods",
  "assistiveTechnologyTesting",
  "manualTesting",
  "automatedTesting",
  "testerFamiliarity",
  "conformanceDefinitions",
  "scopeNotes",
]);

const MAX_FIELD_CHARACTERS = 1000;
const MAX_TOTAL_CHARACTERS = 12000;
const MAX_MATCHES_PER_FIELD = 8;

const FIELD_PATTERNS = Object.freeze({
  templateVersion: /\b(?:vpat(?:\s+template)?(?:\s+version)?|template\s+version|version\s+2\.5(?:rev)?)\b/iu,
  productDescription: /\b(?:product(?:\s+(?:name|description|version))?|description\s+of\s+(?:the\s+)?product|service\s+description)\b/iu,
  reportDate: /\b(?:report|publication|completion|issue|issued|last\s+updated)\s+date\b|\bdate\s+of\s+(?:the\s+)?report\b/iu,
  contactInformation: /\b(?:accessibility\s+contact|contact\s+(?:information|details|email)|e-?mail\s+address|contact\s+us)\b|\b[^\s@]+@[^\s@]+\.[^\s@]+\b/iu,
  evaluationMethods: /\b(?:evaluation|testing|assessment)\s+(?:method|methods|methodology|process|approach)\b|\bmethods?\s+used\b/iu,
  assistiveTechnologyTesting: /\b(?:assistive\s+technolog(?:y|ies)|screen\s+reader|voiceover|jaws|nvda|talkback|switch\s+access)\b/iu,
  manualTesting: /\bmanual(?:ly)?\b.{0,80}\b(?:test|testing|evaluation|review)\b|\b(?:keyboard\s+testing|human\s+review)\b/iu,
  automatedTesting: /\bautomated?\b.{0,80}\b(?:tool|tools|test|testing|evaluation|axe(?:-core)?|wave)\b|\b(?:accessibility\s+(?:scanner|checker)|axe(?:-core)?|wave\s+tool)\b/iu,
  testerFamiliarity: /\b(?:tester|evaluator|reviewer)s?'?\s+(?:product\s+)?(?:familiarity|experience|knowledge)|\bproduct\s+familiarity\b/iu,
  conformanceDefinitions: /\b(?:conformance\s+(?:term|terms|level\s+term|definitions?)|supports\s+means|partially\s+supports\s+means|does\s+not\s+support\s+means)\b/iu,
  scopeNotes: /\b(?:evaluation\s+scope|report\s+scope|scope\s+and\s+coverage|coverage\s+boundary|tested\s+(?:platform|environment)|material\s+exclusion|product\s+areas?\s+included)\b/iu,
});

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
}

function sourceLines(document) {
  const output = [];
  const add = (label, value) => {
    const normalizedLabel = normalize(label);
    const normalizedValue = normalize(value);
    if (!normalizedValue) return;
    output.push({
      search: `${normalizedLabel} ${normalizedValue}`.trim(),
      value: normalizedLabel ? `${normalizedLabel}: ${normalizedValue}` : normalizedValue,
    });
  };

  document.bodyProse.forEach((paragraph) => add("", paragraph));
  document.tables.forEach((table) => {
    add("Section", table.context);
    table.rows.forEach((row) => {
      const cells = row.cells.map(normalize);
      if (!cells.some(Boolean)) return;
      if (cells.length >= 2 && cells[0]) add(cells[0], cells.slice(1).join(" | "));
      else add("", cells.join(" | "));
    });
  });
  return output;
}

function selectField(lines, pattern, budget) {
  const selected = [];
  const seen = new Set();
  for (const line of lines) {
    if (selected.length >= MAX_MATCHES_PER_FIELD || budget.remaining <= 0) break;
    if (!pattern.test(line.search) || seen.has(line.value)) continue;
    const remainingField = MAX_FIELD_CHARACTERS - selected.join(" | ").length;
    if (remainingField <= 0) break;
    const value = line.value.slice(0, Math.min(remainingField, budget.remaining));
    if (!value) break;
    selected.push(value);
    seen.add(line.value);
    budget.remaining -= value.length;
  }
  return selected.join(" | ");
}

export function extractReportEvidence(document) {
  const lines = sourceLines(document);
  const budget = { remaining: MAX_TOTAL_CHARACTERS };
  const evidence = {};
  for (const field of REPORT_EVIDENCE_FIELDS) {
    evidence[field] = selectField(lines, FIELD_PATTERNS[field], budget);
  }
  return evidence;
}

export {
  MAX_FIELD_CHARACTERS,
  MAX_TOTAL_CHARACTERS,
  REPORT_EVIDENCE_FIELDS,
};
