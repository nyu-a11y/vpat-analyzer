const ASCII_WHITESPACE = /[\t\n\f\r ]+/g;
const HORIZONTAL_ASCII_WHITESPACE = /[\t\f\v ]+/g;

export function normalizeAliasText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+([)])/g, "$1")
    .replace(ASCII_WHITESPACE, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

export function normalizeCellText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(HORIZONTAL_ASCII_WHITESPACE, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    // Searchable PDF text layers commonly split punctuation into a separate
    // glyph item. Treat the resulting ASCII space as representation noise so
    // DOCX, DocumentApp, and PDF retain the same literal textual evidence.
    .replace(/ +([)\],.;:!?])/g, "$1")
    .replace(/([(\[]) +/g, "$1")
    .trim();
}

export function hasScLikeText(value) {
  return /(?:^|[^0-9.])(?:[1-4]\.[0-9]+\.[0-9]+)(?=$|[^0-9.])/.test(
    normalizeAliasText(value),
  );
}

export function hasLooseScPrefix(value) {
  return /^[1-4]\.[0-9]+\.[0-9]+(?=$|[^0-9.])/.test(normalizeAliasText(value));
}

export function isFormulaLike(value) {
  return /^[=+\-@\t\r\n]/.test(String(value ?? ""));
}
