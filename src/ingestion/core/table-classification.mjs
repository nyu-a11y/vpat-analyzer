import { normalizeAliasText } from "./normalization.mjs";

function containsAny(value, terms) {
  return terms.some((term) => value.includes(term));
}

export function classifyTable(table) {
  const headers = table.headers.map(normalizeAliasText);
  const context = normalizeAliasText(table.context);
  const allText = `${context} ${headers.join(" ")}`.trim();

  const isCriteriaHeader = header => /^(?:criteria|criterion|success criteria|wcag success criteria)$/.test(header);
  const isConformanceHeader = header => /^(?:conformance|conformance level)$/.test(header);
  const isRemarksHeader = header => /^(?:remarks|remarks and explanations|evidence)$/.test(header);
  const hasCriteriaHeader = headers.some(isCriteriaHeader);
  const hasConformanceHeader = headers.some(isConformanceHeader);
  const hasRemarksHeader = headers.some(isRemarksHeader);
  const roleCount = [hasCriteriaHeader, hasConformanceHeader, hasRemarksHeader].filter(Boolean).length;
  const claimsWcag = allText.includes("wcag");
  const canonicalWcagHeaders = headers.length === 3 &&
    isCriteriaHeader(headers[0]) &&
    isConformanceHeader(headers[1]) &&
    isRemarksHeader(headers[2]);

  const contextSegments = context.split(/\s*(?:\||>)\s*/).filter(Boolean);
  const explicitSection508 = contextSegments.some(segment => /^(?:revised )?section 508(?: report)?$/.test(segment)) ||
    headers.some(header => /^(?:revised )?section 508 (?:provision|criteria)$/.test(header));
  const explicitEn301549 = contextSegments.some(segment => /^en 301 549(?: report)?$/.test(segment)) ||
    headers.some(header => /^en 301 549 (?:clause|criteria)$/.test(header));
  const explicitWcagSection = contextSegments.some(segment =>
    /^wcag(?:\s+2(?:\.x|\.0|\.1|\.2))?(?:\s+(?:level )?(?:a|aa|aaa)(?:\s+and\s+(?:a|aa|aaa))?)?(?: report)?$/.test(segment));

  if (!explicitWcagSection && explicitSection508) {
    return { classification: "non-wcag", reasonCode: "SECTION_508_TABLE" };
  }
  if (!explicitWcagSection && explicitEn301549) {
    return { classification: "non-wcag", reasonCode: "EN_301_549_TABLE" };
  }

  // The neutral row model has fixed criterion/conformance/remarks positions.
  // Require those exact ordered roles and reject permutations or extra columns
  // instead of silently assigning evidence to the wrong field.
  if (
    canonicalWcagHeaders
  ) {
    return { classification: "wcag", reasonCode: "ELIGIBLE_WCAG_HEADERS" };
  }
  if (claimsWcag || roleCount >= 2) {
    return { classification: "ambiguous", reasonCode: "AMBIGUOUS_HEADERS" };
  }
  if (containsAny(allText, ["decorative", "layout table", "body layout"])) {
    return { classification: "non-wcag", reasonCode: "BODY_OR_LAYOUT_TABLE" };
  }
  return { classification: "non-wcag", reasonCode: "NON_WCAG_TABLE" };
}
