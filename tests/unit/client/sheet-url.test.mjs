import assert from 'node:assert/strict';
import test from 'node:test';

import { isTrustedGoogleSheetUrl } from '../../../src/app/client/sheet-url.mjs';

test('only an HTTPS Google Sheets receipt URL is treated as an openable production result', () => {
  assert.equal(isTrustedGoogleSheetUrl('https://docs.google.com/spreadsheets/d/test-sheet_123/edit'), true);
  for (const value of [
    '',
    null,
    'http://docs.google.com/spreadsheets/d/test/edit',
    'https://docs.google.com.evil.invalid/spreadsheets/d/test/edit',
    'https://docs.google.com/document/d/test/edit',
    'https://docs.google.com/spreadsheets/evil',
    'javascript:alert(1)',
  ]) assert.equal(isTrustedGoogleSheetUrl(value), false);
});
