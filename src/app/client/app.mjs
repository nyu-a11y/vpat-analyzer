import { assertClientBridge } from './client-contract.mjs';
import {
  CLIENT_STATES,
  PROCESSING_STAGES,
  REVIEW_VIEWS,
  createInitialState,
  reduceClientState,
} from './model.mjs';
import { createDomHelpers } from './dom.mjs';
import { renderClient } from './render.mjs';
import { isTrustedGoogleSheetUrl } from './sheet-url.mjs';

function defaultRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function errorMessage(error) {
  if (typeof error?.safeMessage === 'string') return error.safeMessage;
  if (typeof error?.message === 'string') return error.message;
  return '';
}

function validationKind(value) {
  return [
    'inaccessible',
    'unsupported',
    'non-searchable-pdf',
    'no-wcag-tables',
    'nyu-access',
  ].includes(value) ? value : 'unsupported';
}

function outcomeRequestId(outcome, fallback) {
  return typeof outcome?.requestId === 'string' ? outcome.requestId : fallback;
}

export function createVpatAnalyzerApp(options = {}) {
  const root = options.root;
  const documentRef = options.document || root?.ownerDocument || globalThis.document;
  const windowRef = options.window || documentRef?.defaultView || globalThis.window;
  if (!root || !documentRef || !windowRef) throw new TypeError('A browser root element is required.');

  const bridge = assertClientBridge(options.bridge);
  const requestIdFactory = options.requestIdFactory || defaultRequestId;
  let state = createInitialState();
  let announcementSequence = 0;
  let chooserQuerySequence = 0;
  let chooserReturnFocus = null;
  let currentChooserFiles = [];
  let layoutObserver = null;
  let printSnapshot = null;
  let destroyed = false;

  function liveRegion(id) {
    return documentRef.getElementById(id);
  }

  function clearAnnouncements() {
    announcementSequence += 1;
    for (const id of ['polite-status', 'error-status', 'completion-status']) {
      const node = liveRegion(id);
      if (node) node.textContent = '';
    }
  }

  function announce(id, message) {
    const node = liveRegion(id);
    if (!node || !message) return;
    const sequence = ++announcementSequence;
    node.textContent = '';
    windowRef.requestAnimationFrame(() => {
      if (!destroyed && sequence === announcementSequence) node.textContent = String(message);
    });
  }

  function focusSelector(selector) {
    windowRef.requestAnimationFrame(() => {
      if (destroyed) return;
      const target = root.querySelector(selector);
      if (target) target.focus();
    });
  }

  function focusedElementSelector() {
    const active = documentRef.activeElement;
    if (!active || !root.contains(active) || !active.id) return '';
    const escaped = globalThis.CSS?.escape ? globalThis.CSS.escape(active.id) : active.id.replace(/[^a-zA-Z0-9_-]/g, '');
    return escaped ? `#${escaped}` : '';
  }

  function syncResponsiveSemantics() {
    const frame = root.querySelector('.app-frame');
    const tablist = root.querySelector('[role="tablist"]');
    if (frame && tablist) tablist.setAttribute('aria-orientation', frame.clientWidth <= 690 ? 'vertical' : 'horizontal');
  }

  function observeLayout() {
    layoutObserver?.disconnect();
    const frame = root.querySelector('.app-frame');
    if ('ResizeObserver' in windowRef) {
      layoutObserver = new windowRef.ResizeObserver(syncResponsiveSemantics);
      if (frame) layoutObserver.observe(frame);
    }
    syncResponsiveSemantics();
  }

  function attachDialogCloseHandler() {
    const dialog = root.querySelector('#drive-dialog');
    if (!dialog) return;
    dialog.addEventListener('close', () => {
      chooserQuerySequence += 1;
      const fallback = root.querySelector('[data-action="choose-source"], [data-action="choose-different"]');
      const target = chooserReturnFocus?.isConnected ? chooserReturnFocus : fallback;
      chooserReturnFocus = null;
      if (target) target.focus();
    }, { once: true });
  }

  function render() {
    if (destroyed) return;
    renderClient(documentRef, root, state);
    windowRef.requestAnimationFrame(observeLayout);
  }

  /**
   * Stale events produce the identical state object. In that case this method
   * deliberately performs no render, focus, announcement, navigation, or
   * export effect.
   */
  function accept(event, effects = {}) {
    const next = reduceClientState(state, event);
    if (next === state) return false;
    const restoreFocus = effects.focus ? '' : focusedElementSelector();
    state = next;
    if (effects.clear !== false) clearAnnouncements();
    render();
    if (effects.focus) focusSelector(effects.focus);
    else if (restoreFocus) focusSelector(restoreFocus);
    if (effects.announce) announce(effects.region || 'polite-status', effects.announce);
    return true;
  }

  async function loadChooserFiles() {
    const sequence = ++chooserQuerySequence;
    const status = root.querySelector('#drive-dialog-status');
    const list = root.querySelector('#drive-file-list');
    if (!status || !list) return;
    status.textContent = 'Loading picker preview…';
    list.replaceChildren();
    try {
      const files = await bridge.listDriveFiles({ query: '' });
      if (destroyed || sequence !== chooserQuerySequence || !root.querySelector('#drive-dialog')?.open) return;
      currentChooserFiles = Array.isArray(files) ? files : [];
      const { el } = createDomHelpers(documentRef);
      for (const [index, file] of currentChooserFiles.entries()) {
        list.append(el('li', {},
          el('button', { className: 'drive-file-button', type: 'button', 'data-action': 'select-drive-file', 'data-file-index': index },
            el('span', { className: 'file-type' }, file.type || 'FILE'),
            el('span', { className: 'file-name' }, file.name || 'Untitled file'),
            el('span', { className: 'file-meta' }, [file.type, file.sizeLabel].filter(Boolean).join(' · ')),
          ),
        ));
      }
      status.textContent = currentChooserFiles.length
        ? `${currentChooserFiles.length} synthetic ${currentChooserFiles.length === 1 ? 'file' : 'files'} available.`
        : 'No synthetic files are available.';
    } catch (error) {
      if (destroyed || sequence !== chooserQuerySequence || !root.querySelector('#drive-dialog')?.open) return;
      currentChooserFiles = [];
      status.textContent = 'The picker preview is unavailable. Close this dialog and try again.';
      announce('error-status', errorMessage(error) || 'The picker preview is unavailable.');
    }
  }

  function openChooser(trigger) {
    const dialog = root.querySelector('#drive-dialog');
    if (!dialog) return;
    chooserReturnFocus = trigger || documentRef.activeElement;
    currentChooserFiles = [];
    attachDialogCloseHandler();
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    dialog.querySelector('#drive-dialog-heading')?.focus();
    loadChooserFiles();
  }

  function closeChooser() {
    const dialog = root.querySelector('#drive-dialog');
    if (!dialog) return;
    chooserQuerySequence += 1;
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  async function validateSource(source) {
    const requestId = String(requestIdFactory());
    accept({ type: 'VALIDATION_STARTED', requestId, source }, {
      focus: '[data-state-heading]',
      announce: 'Checking file access and format.',
    });
    try {
      const response = await bridge.validateSource({ requestId, source });
      const responseRequestId = outcomeRequestId(response, requestId);
      if (response?.status === 'selected') {
        accept({ type: 'VALIDATION_SUCCEEDED', requestId: responseRequestId, source: response.source || source }, {
          focus: '[data-state-heading]',
          announce: 'Source selected and ready to analyze.',
        });
      } else {
        const kind = validationKind(response?.kind);
        accept({ type: 'VALIDATION_FAILED', requestId: responseRequestId, kind, detail: response?.detail }, {
          focus: '[data-state-heading]',
          announce: errorAnnouncement(kind),
          region: 'error-status',
        });
      }
    } catch (error) {
      const kind = validationKind(error?.kind || 'inaccessible');
      accept({ type: 'VALIDATION_FAILED', requestId, kind, detail: errorMessage(error) }, {
        focus: '[data-state-heading]',
        announce: errorAnnouncement(kind),
        region: 'error-status',
      });
    }
  }

  function errorAnnouncement(kind) {
    const messages = {
      inaccessible: 'We can’t access this file. Confirm that you can open it in Google Drive, then choose it again.',
      unsupported: 'This file isn’t supported. Choose a VPAT 2.5 Google Doc, DOCX, or searchable PDF.',
      'non-searchable-pdf': 'This PDF doesn’t contain enough searchable text. Scanned PDFs are not supported.',
      'no-wcag-tables': 'We couldn’t find VPAT 2.5 WCAG tables in this file.',
      'nyu-access': 'NYU access is required.',
    };
    return messages[kind] || messages.unsupported;
  }

  function acceptAnalysisEvent(event) {
    if (event?.type !== 'STAGE_CHANGED') return false;
    const accepted = accept(event, { clear: false });
    if (accepted) announce('polite-status', `Stage updated: ${PROCESSING_STAGES[event.stageIndex]}.`);
    return accepted;
  }

  async function runAnalysis() {
    const requestId = state.activeRequestId;
    const source = state.source;
    if (!requestId || !source) return;
    const started = accept({ type: 'ANALYSIS_STARTED', requestId }, {
      focus: '[data-state-heading]',
      announce: 'Analysis started.',
    });
    if (!started) return;
    try {
      const outcome = await bridge.startAnalysis({ requestId, source, onEvent: acceptAnalysisEvent });
      const resultRequestId = outcomeRequestId(outcome, requestId);
      if (outcome?.status === 'complete' && outcome.result) {
        accept({ type: 'ANALYSIS_COMPLETED', requestId: resultRequestId, result: outcome.result }, {
          focus: '[data-state-heading]',
          announce: 'Analysis complete. Results are ready to review.',
          region: 'completion-status',
        });
      } else if (outcome?.status === 'export-error' && outcome.result) {
        accept({ type: 'EXPORT_FAILED', requestId: resultRequestId, result: outcome.result, detail: outcome.detail }, {
          focus: '[data-state-heading]',
          announce: 'The analysis is complete, but the Google Sheet was not created.',
          region: 'error-status',
        });
      } else if (outcome?.kind) {
        const kind = validationKind(outcome.kind);
        accept({ type: 'ANALYSIS_REJECTED', requestId: resultRequestId, kind, detail: outcome?.detail }, {
          focus: '[data-state-heading]',
          announce: errorAnnouncement(kind),
          region: 'error-status',
        });
      } else {
        accept({ type: 'ANALYSIS_FAILED', requestId: resultRequestId, retryable: Boolean(outcome?.retryable), detail: outcome?.detail }, {
          focus: '[data-state-heading]',
          announce: outcome?.retryable ? 'Analysis was interrupted. No quality grade was assigned.' : 'We couldn’t complete this analysis. No quality grade was assigned.',
          region: 'error-status',
        });
      }
    } catch (error) {
      accept({ type: 'ANALYSIS_FAILED', requestId, retryable: error?.retryable !== false, detail: errorMessage(error) }, {
        focus: '[data-state-heading]',
        announce: 'Analysis was interrupted. No quality grade was assigned.',
        region: 'error-status',
      });
    }
  }

  async function retryExport() {
    const requestId = state.activeRequestId;
    const analysisId = state.result?.analysisId;
    if (!requestId || !analysisId) return;
    const started = accept({ type: 'EXPORT_RETRY_STARTED', requestId }, {
      focus: '[data-state-heading]',
      announce: 'Trying Google Sheet creation again. The VPAT will not be reanalyzed.',
    });
    if (!started) return;
    try {
      const outcome = await bridge.retryExport({ requestId, analysisId, source: state.source });
      const resultRequestId = outcomeRequestId(outcome, requestId);
      if (outcome?.status === 'complete') {
        accept({ type: 'EXPORT_SUCCEEDED', requestId: resultRequestId, result: outcome.result }, {
          focus: '[data-state-heading]',
          announce: 'Google Sheet creation completed without reanalyzing the source.',
          region: 'completion-status',
        });
      } else {
        accept({ type: 'EXPORT_RETRY_FAILED', requestId: resultRequestId, detail: outcome?.detail }, {
          focus: '[data-state-heading]',
          announce: 'The Google Sheet still could not be created. Your completed analysis remains available.',
          region: 'error-status',
        });
      }
    } catch (error) {
      accept({ type: 'EXPORT_RETRY_FAILED', requestId, detail: errorMessage(error) }, {
        focus: '[data-state-heading]',
        announce: 'The Google Sheet still could not be created. Your completed analysis remains available.',
        region: 'error-status',
      });
    }
  }

  function showActionFeedback(message) {
    const feedback = root.querySelector('#result-action-feedback');
    if (!feedback) return;
    feedback.textContent = String(message);
    feedback.hidden = false;
  }

  function openSheetPreview() {
    const sheetUrl = state.result?.sheet?.url;
    if (isTrustedGoogleSheetUrl(sheetUrl)) {
      windowRef.open(sheetUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    if (state.result?.localPreview !== true) {
      const message = 'The Google Sheet receipt is unavailable. Try creating the Sheet again before opening it.';
      showActionFeedback(message);
      announce('error-status', message);
      return;
    }
    const preview = windowRef.open('', '_blank');
    if (!preview) {
      const message = 'The result tab could not be opened. Allow new tabs and try again.';
      showActionFeedback(message);
      announce('error-status', message);
      return;
    }
    preview.opener = null;
    const previewDocument = preview.document;
    previewDocument.documentElement.lang = 'en';
    previewDocument.title = 'NYU VPAT Analyzer — Google Sheet preview';
    const { el } = createDomHelpers(previewDocument);
    const content = el('main', {},
      el('h1', {}, 'NYU VPAT Analyzer — Overview'),
      el('p', {}, 'Local synthetic preview. No Google Sheet or external connection was created.'),
      el('h2', {}, 'Five exported Sheet tabs'),
      el('ol', {}, ...['Overview', 'Line-item Review', 'Quality Requirements', 'Scoring', 'Methodology & disclaimer'].map(tab => el('li', {}, tab))),
      el('h2', {}, state.result?.source?.name || state.source?.name || 'Selected VPAT'),
      el('dl', {},
        el('dt', {}, 'Report quality'), el('dd', {}, `${state.result?.summary?.grade || ''} (${state.result?.summary?.score || 0}%)`),
        el('dt', {}, 'WCAG criteria reviewed'), el('dd', {}, state.result?.summary?.criteriaReviewed || 0),
        el('dt', {}, 'Quality requirements'), el('dd', {}, state.result?.summary?.qualityRequirements || 0),
      ),
    );
    const style = previewDocument.createElement('style');
    style.textContent = 'body{max-width:900px;margin:32px auto;padding:0 20px;color:#242536;background:#f8f7fb;font:16px/1.5 Arial,sans-serif}main{padding:24px;background:#fff;border:1px solid #e7e7ed;border-radius:8px}h1,h2{color:#3e006d}dt{margin-top:12px;color:#667085}dd{margin-left:0;font-weight:700}li{margin:6px 0}';
    previewDocument.head.append(style);
    previewDocument.body.replaceChildren(content);
    announce('polite-status', 'Google Sheet result opened in a new tab.');
  }

  function preparePrint() {
    if (printSnapshot || !state.result) return;
    const panels = [...root.querySelectorAll('[role="tabpanel"]')];
    const disclosures = [...root.querySelectorAll('.output-section details')];
    printSnapshot = {
      panels: panels.map(node => [node, node.hidden]),
      disclosures: disclosures.map(node => [node, node.open]),
    };
    for (const panel of panels) panel.hidden = false;
    for (const disclosure of disclosures) disclosure.open = true;
  }

  function restorePrint() {
    if (!printSnapshot) return;
    for (const [node, hidden] of printSnapshot.panels) node.hidden = hidden;
    for (const [node, open] of printSnapshot.disclosures) node.open = open;
    printSnapshot = null;
    windowRef.requestAnimationFrame(syncResponsiveSemantics);
  }

  function saveAsPdf() {
    announce('polite-status', 'Opening the print dialog. Choose Save as PDF to create a local copy.');
    preparePrint();
    windowRef.requestAnimationFrame(() => windowRef.requestAnimationFrame(() => {
      try {
        windowRef.print();
      } catch {
        restorePrint();
        const message = 'The print dialog could not be opened. Try again from your browser menu.';
        showActionFeedback(message);
        announce('error-status', message);
      }
    }));
  }

  function activateTab(index, moveFocus = true) {
    const accepted = accept({ type: 'TAB_ACTIVATED', index }, { clear: false });
    if (moveFocus) focusSelector(`#tab-${REVIEW_VIEWS[index]?.id}`);
    return accepted;
  }

  function filterResults(target, value) {
    const accepted = accept({ type: 'FILTER_CHANGED', target, value }, { clear: false });
    if (!accepted) return;
    const items = target === 'wcag' ? state.result?.wcagItems || [] : state.result?.qualityItems || [];
    const count = value === 'review' ? items.filter(item => item.needsReview).length : items.length;
    const completed = target === 'wcag' ? state.result?.summary?.criteriaReviewed : state.result?.summary?.qualityRequirements;
    const representative = Number.isFinite(completed) && items.length < completed;
    const noun = target === 'wcag' ? 'WCAG criteria' : count === 1 ? 'quality check' : 'quality checks';
    announce('polite-status', value === 'review' ? `Showing ${count}${representative ? ' representative' : ''} ${noun} that need review.` : `Showing all ${count}${representative ? ' representative' : ''} ${noun}.`);
  }

  function resetAndChoose(trigger) {
    accept({ type: 'RESET' }, { clear: true });
    windowRef.requestAnimationFrame(() => openChooser(root.querySelector('[data-action="choose-source"]') || trigger));
  }

  function handleClick(event) {
    const actionNode = event.target.closest('[data-action]');
    if (!actionNode || !root.contains(actionNode)) return;
    const action = actionNode.dataset.action;
    if (action === 'choose-source') openChooser(actionNode);
    else if (action === 'close-chooser') closeChooser();
    else if (action === 'select-drive-file') {
      const file = currentChooserFiles[Number(actionNode.dataset.fileIndex)];
      if (!file) return;
      chooserReturnFocus = null;
      closeChooser();
      validateSource(file);
    } else if (action === 'choose-different') resetAndChoose(actionNode);
    else if (action === 'analyze' || action === 'retry-analysis') runAnalysis();
    else if (action === 'retry-export') retryExport();
    else if (action === 'open-sheet') openSheetPreview();
    else if (action === 'save-pdf') saveAsPdf();
    else if (action === 'analyze-another') accept({ type: 'RESET' }, { focus: '[data-action="choose-source"]', announce: 'Ready to analyze another source.' });
    else if (action === 'show-review-items') {
      activateTab(0, false);
      focusSelector('#items-needing-review-heading');
    } else if (action === 'activate-tab') activateTab(Number(actionNode.dataset.tabIndex));
    else if (action === 'filter-results') filterResults(actionNode.dataset.filterTarget, actionNode.dataset.filterValue);
  }

  function handleKeydown(event) {
    const current = event.target.closest('[role="tab"]');
    if (!current || !root.contains(current)) return;
    const index = Number(current.dataset.tabIndex);
    const tablist = current.closest('[role="tablist"]');
    const vertical = tablist?.getAttribute('aria-orientation') === 'vertical';
    let next = index;
    if ((!vertical && event.key === 'ArrowRight') || (vertical && event.key === 'ArrowDown')) next = (index + 1) % REVIEW_VIEWS.length;
    else if ((!vertical && event.key === 'ArrowLeft') || (vertical && event.key === 'ArrowUp')) next = (index - 1 + REVIEW_VIEWS.length) % REVIEW_VIEWS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = REVIEW_VIEWS.length - 1;
    else return;
    event.preventDefault();
    activateTab(next);
  }

  function showAccessError(detail = '') {
    const requestId = String(requestIdFactory());
    const source = { id: 'access-check', name: 'Google Drive', type: 'DRIVE', sizeLabel: '' };
    accept({ type: 'VALIDATION_STARTED', requestId, source }, { clear: true });
    accept({ type: 'VALIDATION_FAILED', requestId, kind: 'nyu-access', detail }, {
      focus: '[data-state-heading]',
      announce: 'NYU access is required.',
      region: 'error-status',
    });
  }

  async function reconcileActiveRequest() {
    if (typeof bridge.resumeActive !== 'function') return;
    let resumed;
    try {
      resumed = await bridge.resumeActive();
    } catch {
      return;
    }
    if (destroyed || state.status !== CLIENT_STATES.READY || state.activeRequestId !== null) return;
    if (!resumed || ['ready', 'stale'].includes(resumed.status)) return;
    const requestId = resumed.requestId;
    const source = resumed.source || resumed.result?.source;
    if (typeof requestId !== 'string' || !source) return;
    accept({ type: 'VALIDATION_STARTED', requestId, source }, { clear: true });
    if (!accept({ type: 'VALIDATION_SUCCEEDED', requestId, source }, {
      focus: '[data-state-heading]',
      announce: 'An unfinished request was found and reconciled.',
    })) return;

    if (resumed.status === 'selected') return;
    if (resumed.status === 'pending' || (resumed.status === 'error' && resumed.retryable)) {
      await runAnalysis();
      return;
    }
    if (!accept({ type: 'ANALYSIS_STARTED', requestId }, { clear: false })) return;
    if (resumed.status === 'complete' && resumed.result) {
      accept({ type: 'ANALYSIS_COMPLETED', requestId, result: resumed.result }, {
        focus: '[data-state-heading]',
        announce: 'The completed analysis and Google Sheet receipt were restored.',
        region: 'completion-status',
      });
    } else if (resumed.status === 'export-error' && resumed.result) {
      accept({ type: 'EXPORT_FAILED', requestId, result: resumed.result, detail: resumed.detail }, {
        focus: '[data-state-heading]',
        announce: 'The completed analysis was restored. Google Sheet creation can be retried.',
        region: 'error-status',
      });
    } else {
      accept({ type: 'ANALYSIS_FAILED', requestId, retryable: Boolean(resumed.retryable), detail: resumed.detail }, {
        focus: '[data-state-heading]',
        announce: 'The saved request could not be completed. No quality grade was assigned.',
        region: 'error-status',
      });
    }
  }

  function destroy() {
    destroyed = true;
    announcementSequence += 1;
    chooserQuerySequence += 1;
    layoutObserver?.disconnect();
    root.removeEventListener('click', handleClick);
    root.removeEventListener('keydown', handleKeydown);
    windowRef.removeEventListener('resize', syncResponsiveSemantics);
    windowRef.removeEventListener('beforeprint', preparePrint);
    windowRef.removeEventListener('afterprint', restorePrint);
    windowRef.removeEventListener('focus', restorePrint);
  }

  root.addEventListener('click', handleClick);
  root.addEventListener('keydown', handleKeydown);
  windowRef.addEventListener('resize', syncResponsiveSemantics);
  windowRef.addEventListener('beforeprint', preparePrint);
  windowRef.addEventListener('afterprint', restorePrint);
  windowRef.addEventListener('focus', restorePrint);
  render();
  const resumePromise = reconcileActiveRequest();

  return Object.freeze({
    acceptServerEvent: acceptAnalysisEvent,
    destroy,
    getState: () => state,
    openChooser: () => openChooser(root.querySelector('[data-action="choose-source"]')),
    showAccessError,
    whenReady: () => resumePromise,
  });
}
