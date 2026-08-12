import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';

import { chromium } from 'playwright-core';

const ROOT = resolve(import.meta.dirname, '..');
const BUILD = resolve(ROOT, 'build/v1');
const OUTPUT = resolve(ROOT, 'output/v1-browser');
const AXE_SOURCE = readFileSync(resolve(ROOT, 'node_modules/axe-core/axe.min.js'), 'utf8');
const EXPECTED_SHEET_TABS = [
  'Overview',
  'Line-item Review',
  'Quality Requirements',
  'Scoring',
  'Methodology & disclaimer',
];
const EXPECTED_REVIEW_VIEWS = ['Summary', 'WCAG criteria', 'Report quality'];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function startServer() {
  const html = readFileSync(resolve(BUILD, 'local.html'));
  const server = createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    if (url.pathname === '/favicon.ico') {
      response.writeHead(204).end();
      return;
    }
    if (url.pathname !== '/' && url.pathname !== '/local.html') {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(html);
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  return {
    server,
    url: `http://127.0.0.1:${address.port}/local.html`,
  };
}

async function runAxe(page, label) {
  await page.addScriptTag({ content: AXE_SOURCE });
  const result = await page.evaluate(async () => {
    const output = await globalThis.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
    });
    return output.violations.map(violation => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.length,
    }));
  });
  assert(result.length === 0, `${label} has axe violations: ${JSON.stringify(result)}`);
  return result;
}

async function openChooserAndSelect(page, fileName = 'Northstar Collaboration') {
  await page.getByRole('button', { name: 'Choose from Google Drive' }).click();
  const dialog = page.getByRole('dialog', { name: 'Google Drive picker' });
  await assert(await dialog.isVisible(), 'Drive chooser did not open.');
  const fileButton = dialog.getByRole('button', { name: new RegExp(fileName, 'i') }).first();
  await fileButton.click();
}

async function runHappyFlow(page, baseUrl, viewport, screenshotName) {
  await page.setViewportSize(viewport);
  await page.goto(`${baseUrl}?proof=1`);
  await page.getByRole('button', { name: 'Choose from Google Drive' }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Google Drive picker' });
  await dialog.getByRole('button', { name: /Northstar Collaboration Suite VPAT 2\.5\.docx/i }).click();
  await page.getByRole('heading', { name: 'Source is ready' }).waitFor();
  await page.getByRole('button', { name: 'Analyze VPAT' }).click();
  await page.getByRole('heading', { name: 'Your VPAT analysis is ready' }).waitFor();

  const tabs = await page.getByRole('tab').allTextContents();
  assert(JSON.stringify(tabs) === JSON.stringify(EXPECTED_REVIEW_VIEWS), 'Web review tabs drifted.');
  const sheetTabs = await page.evaluate(() => globalThis.NYU_VPAT_ANALYZER.getState().result.sheet.tabs);
  assert(JSON.stringify(sheetTabs) === JSON.stringify(EXPECTED_SHEET_TABS), 'Sheet tabs drifted.');
  assert(await page.locator('.sheet-tabs-description').count() === 0, 'Sheet-tab filler is still rendered in results.');
  assert(!(await page.locator('body').innerText()).includes('exactly five tabs'), 'Sheet-tab filler copy is still rendered in results.');
  assert(!(await page.locator('body').innerText()).includes('NYU internal · Private results'), 'Redundant header metadata is still rendered.');
  assert(await page.locator('.source-rail').count() === 0, 'The removed two-column source rail is still rendered.');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  assert(!overflow, `Page-level horizontal overflow at ${viewport.width}x${viewport.height}.`);
  const undersized = await page.locator('button:visible, summary:visible, input:visible').evaluateAll(nodes => nodes
    .map(node => ({ label: node.textContent || node.getAttribute('aria-label') || node.id, rect: node.getBoundingClientRect().toJSON() }))
    .filter(item => item.rect.width < 44 || item.rect.height < 44));
  assert(undersized.length === 0, `Undersized controls: ${JSON.stringify(undersized)}`);

  const firstTab = page.getByRole('tab', { name: 'Summary' });
  await firstTab.focus();
  await page.keyboard.press(viewport.width <= 690 ? 'ArrowDown' : 'ArrowRight');
  const wcagTab = page.getByRole('tab', { name: 'WCAG criteria' });
  assert(await wcagTab.getAttribute('aria-selected') === 'true', 'Roving tab navigation failed.');
  await wcagTab.focus();
  await page.keyboard.press('End');
  assert(await page.getByRole('tab', { name: 'Report quality' }).getAttribute('aria-selected') === 'true', 'Tab End navigation failed.');

  await wcagTab.click();
  const wcagDisclosure = page.locator('#panel-wcag-criteria details.item-disclosure').first();
  const wcagSummary = wcagDisclosure.locator('summary');
  const wcagContent = wcagDisclosure.locator('.disclosure-content');
  assert(await wcagDisclosure.getAttribute('open') === null, 'WCAG disclosure should start collapsed.');
  assert(!(await wcagContent.isVisible()), 'Collapsed WCAG disclosure content is visible.');
  await wcagSummary.click();
  assert(await wcagDisclosure.getAttribute('open') !== null, 'WCAG disclosure did not expand.');
  assert(await wcagContent.isVisible(), 'Expanded WCAG disclosure content is hidden.');
  await wcagSummary.click();
  assert(await wcagDisclosure.getAttribute('open') === null, 'WCAG disclosure did not collapse.');
  assert(!(await wcagContent.isVisible()), 'Collapsed WCAG disclosure content remained visible.');

  const qualityTab = page.getByRole('tab', { name: 'Report quality' });
  await qualityTab.click();
  const qualityDisclosure = page.locator('#panel-report-quality details.item-disclosure').first();
  const qualitySummary = qualityDisclosure.locator('summary');
  const qualityContent = qualityDisclosure.locator('.disclosure-content');
  assert(await qualityDisclosure.getAttribute('open') === null, 'Report-quality disclosure should start collapsed.');
  assert(!(await qualityContent.isVisible()), 'Collapsed report-quality disclosure content is visible.');
  await qualitySummary.click();
  assert(await qualityContent.isVisible(), 'Report-quality disclosure did not expand.');
  await qualitySummary.click();
  assert(!(await qualityContent.isVisible()), 'Report-quality disclosure did not collapse.');

  await runAxe(page, `success ${viewport.width}x${viewport.height}`);
  if (screenshotName) await page.screenshot({ path: resolve(OUTPUT, screenshotName), fullPage: true });
  return {
    viewport,
    reviewViews: tabs,
    sheetTabsContract: sheetTabs,
    pageOverflow: overflow,
    undersizedControlCount: undersized.length,
  };
}

async function provePrintAndStale(page) {
  await page.getByRole('tab', { name: 'Summary' }).click();
  await page.evaluate(() => new Promise(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
  const before = await page.evaluate(() => ({
    html: document.querySelector('#app-root').innerHTML,
    live: [...document.querySelectorAll('[aria-live]')].map(node => node.textContent),
    active: document.activeElement?.id || document.activeElement?.textContent || '',
    state: globalThis.NYU_VPAT_ANALYZER.getState(),
  }));
  await page.evaluate(() => globalThis.NYU_VPAT_ANALYZER.acceptServerEvent({
    type: 'STAGE_CHANGED', requestId: 'stale-request', stageIndex: 4,
  }));
  const after = await page.evaluate(() => ({
    html: document.querySelector('#app-root').innerHTML,
    live: [...document.querySelectorAll('[aria-live]')].map(node => node.textContent),
    active: document.activeElement?.id || document.activeElement?.textContent || '',
    state: globalThis.NYU_VPAT_ANALYZER.getState(),
  }));
  assert(JSON.stringify(after) === JSON.stringify(before), 'A stale callback caused a client effect.');

  const printBefore = await page.evaluate(() => ({
    hiddenPanels: [...document.querySelectorAll('[role="tabpanel"]')].map(node => node.hidden),
    openDetails: [...document.querySelectorAll('.output-section details')].map(node => node.open),
  }));
  await page.evaluate(() => dispatchEvent(new Event('beforeprint')));
  const during = await page.evaluate(() => ({
    hiddenPanels: [...document.querySelectorAll('[role="tabpanel"]')].map(node => node.hidden),
    openDetails: [...document.querySelectorAll('.output-section details')].map(node => node.open),
  }));
  assert(during.hiddenPanels.every(value => value === false), 'Print did not expose every review panel.');
  assert(during.openDetails.every(value => value === true), 'Print did not expand disclosures.');
  await page.evaluate(() => dispatchEvent(new Event('afterprint')));
  const printAfter = await page.evaluate(() => ({
    hiddenPanels: [...document.querySelectorAll('[role="tabpanel"]')].map(node => node.hidden),
    openDetails: [...document.querySelectorAll('.output-section details')].map(node => node.open),
  }));
  assert(JSON.stringify(printAfter) === JSON.stringify(printBefore), 'Print state was not restored.');
}

async function proveErrorRecovery(page, baseUrl) {
  await page.goto(`${baseUrl}?proof=1`);
  await openChooserAndSelect(page, 'Scanned Accessibility Conformance Report.pdf');
  await page.getByRole('heading', { name: 'This PDF doesn’t contain enough searchable text' }).waitFor();
  assert((await page.locator('body').innerText()).includes('V1 does not use OCR'), 'Scanned-PDF error does not state the no-OCR boundary.');

  await page.goto(`${baseUrl}?proof=1&scenario=analysis-retry`);
  await openChooserAndSelect(page);
  await page.getByRole('button', { name: 'Analyze VPAT' }).click();
  await page.getByRole('heading', { name: 'Analysis was interrupted' }).waitFor();
  assert(!(await page.locator('body').innerText()).match(/\bF\b.*grade/i), 'Analysis error manufactured an F grade.');
  await page.getByRole('button', { name: 'Try analysis again' }).click();
  await page.getByRole('heading', { name: 'Your VPAT analysis is ready' }).waitFor();

  await page.goto(`${baseUrl}?proof=1&scenario=export-retry`);
  await openChooserAndSelect(page);
  await page.getByRole('button', { name: 'Analyze VPAT' }).click();
  await page.getByRole('heading', { name: 'Your analysis is complete, but the Sheet wasn’t created' }).waitFor();
  const analysisId = await page.evaluate(() => globalThis.NYU_VPAT_ANALYZER.getState().result.analysisId);
  await page.getByRole('button', { name: 'Try creating the Sheet again' }).click();
  await page.getByRole('heading', { name: 'Your VPAT analysis is ready' }).waitFor();
  const afterId = await page.evaluate(() => globalThis.NYU_VPAT_ANALYZER.getState().result.analysisId);
  assert(afterId === analysisId, 'Export retry changed the immutable analysis identity.');
}

mkdirSync(OUTPUT, { recursive: true });
const { server, url } = await startServer();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const consoleFailures = [];
page.on('console', message => {
  if (message.type() === 'error' || message.type() === 'warning') consoleFailures.push(`${message.type()}: ${message.text()}`);
});
page.on('pageerror', error => consoleFailures.push(`pageerror: ${error.message}`));

const summary = {
  schemaVersion: '1.0.0',
  result: 'failed',
  viewports: [],
  accessibility: { axeViolations: 0, keyboardTabs: false, targetSize: false },
  recovery: { scannedPdf: false, analysisRetry: false, exportOnlyRetry: false },
  printRestoration: false,
  staleCallbackSilence: false,
  forcedColors: false,
  reducedMotion: false,
  zoom200: false,
  consoleFailures: [],
};

try {
  const viewports = [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ];
  for (const viewport of viewports) {
    summary.viewports.push(await runHappyFlow(
      page,
      url,
      viewport,
      viewport.width === 1440 ? 'success-1440x900.png' : viewport.width === 390 ? 'success-390x844.png' : null,
    ));
  }
  summary.accessibility.axeViolations = 0;
  summary.accessibility.keyboardTabs = true;
  summary.accessibility.targetSize = true;

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${url}?proof=1`);
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  const zoomOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  assert(!zoomOverflow, 'Desktop 200% zoom caused page-level horizontal overflow.');
  summary.zoom200 = true;

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reducedAnimation = await page.evaluate(() => getComputedStyle(document.querySelector('.skip-link')).transitionDuration);
  assert(reducedAnimation === '0s' || Number.parseFloat(reducedAnimation) <= 0.01, 'Reduced motion did not suppress transitions.');
  summary.reducedMotion = true;

  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'no-preference' });
  const forcedBorder = await page.getByRole('button', { name: 'Choose from Google Drive' }).evaluate(node => getComputedStyle(node).borderStyle);
  assert(forcedBorder !== 'none', 'Forced colors lost the primary control boundary.');
  summary.forcedColors = true;
  await page.emulateMedia({ forcedColors: 'none' });

  await runHappyFlow(page, url, { width: 1280, height: 720 }, 'implementation-success-1280x720.png');
  await provePrintAndStale(page);
  summary.printRestoration = true;
  summary.staleCallbackSilence = true;
  await proveErrorRecovery(page, url);
  summary.recovery = { scannedPdf: true, analysisRetry: true, exportOnlyRetry: true };

  assert(consoleFailures.length === 0, `Browser console failures: ${JSON.stringify(consoleFailures)}`);
  summary.consoleFailures = [];
  summary.result = 'passed';
} finally {
  summary.consoleFailures = consoleFailures;
  writeFileSync(resolve(OUTPUT, 'proof-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  await context.close();
  await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}

console.log(`V1 browser proof ${summary.result}: ${summary.viewports.length} responsive viewports`);
