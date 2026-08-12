const SHEET_PATH = /^\/spreadsheets\/d\/[A-Za-z0-9_-]+(?:\/|$)/u;

export function isTrustedGoogleSheetUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'docs.google.com' && SHEET_PATH.test(url.pathname);
  } catch {
    return false;
  }
}
