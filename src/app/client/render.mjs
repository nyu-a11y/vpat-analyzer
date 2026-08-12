import {
  CLIENT_STATES,
  PROCESSING_STAGES,
  REVIEW_VIEWS,
  isCompletedState,
} from './model.mjs';
import { createDomHelpers } from './dom.mjs';
import { isTrustedGoogleSheetUrl } from './sheet-url.mjs';

const ERROR_CONTENT = Object.freeze({
  [CLIENT_STATES.INACCESSIBLE]: Object.freeze({
    eyebrow: 'Source not available',
    heading: 'We can’t access this file',
    strong: 'Confirm that you can open the file in Google Drive.',
    explanation: 'Then choose it again, or select another supported file.',
    action: 'Choose another file',
  }),
  [CLIENT_STATES.UNSUPPORTED]: Object.freeze({
    eyebrow: 'Source not eligible',
    heading: 'This file isn’t supported',
    strong: 'V1 accepts one VPAT 2.5 Google Doc, DOCX, or searchable PDF.',
    explanation: 'Choose a supported VPAT 2.5 file from Google Drive.',
    action: 'Choose another file',
  }),
  [CLIENT_STATES.NON_SEARCHABLE_PDF]: Object.freeze({
    eyebrow: 'Source not eligible',
    heading: 'This PDF doesn’t contain enough searchable text',
    strong: 'Scanned or image-only PDFs cannot be analyzed.',
    explanation: 'V1 does not use OCR. Choose a Google Doc, DOCX, or searchable PDF.',
    action: 'Choose another file',
  }),
  [CLIENT_STATES.NO_WCAG_TABLES]: Object.freeze({
    eyebrow: 'Source not eligible',
    heading: 'We couldn’t find VPAT 2.5 WCAG tables',
    strong: 'Only WCAG conformance tables are analyzed.',
    explanation: 'Body prose and other standards tables are outside this focused review.',
    action: 'Choose another file',
  }),
  [CLIENT_STATES.ANALYSIS_PERMANENT]: Object.freeze({
    eyebrow: 'Analysis incomplete',
    heading: 'We couldn’t complete this analysis',
    strong: 'No quality grade was assigned.',
    explanation: 'The result is incomplete, not a report-quality failure. Choose another eligible file and try again.',
    action: 'Analyze another file',
  }),
  [CLIENT_STATES.NYU_ACCESS_ERROR]: Object.freeze({
    eyebrow: 'Access required',
    heading: 'NYU access is required',
    strong: 'The app is available through the authorized NYU deployment.',
    explanation: 'Try again with an eligible NYU account.',
    action: 'Try again',
  }),
});

export function qualityPresentation(summary = {}) {
  const score = summary.score;
  const grade = typeof summary.grade === 'string' ? summary.grade.trim() : '';
  if (!grade || typeof score !== 'number' || !Number.isFinite(score)) {
    return {
      scored: false,
      score: Number.NaN,
      label: 'Incomplete',
      context: 'A report-quality grade was not assigned because the analysis did not have complete, valid results.',
    };
  }
  const context = score >= 90
    ? 'Outstanding report completeness and clarity.'
    : score >= 80
      ? 'Strong report quality with limited review needs.'
      : score >= 70
        ? 'Report quality meets expectations with improvements needed.'
        : score >= 61
          ? 'Material report-quality improvements are needed.'
          : 'Substantial report-quality gaps require review.';
  return { scored: true, score, label: `${grade} (${score}%)`, context };
}

export function confidencePresentation(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Incomplete';
  return value < 70 ? `${value} · Below threshold` : String(value);
}

function sourceMeta(source, textList) {
  return textList([source?.type, source?.sizeLabel]);
}

function coverageText(source, textList) {
  const wcag = source?.wcagVersion ? `WCAG ${source.wcagVersion}` : '';
  const levels = Array.isArray(source?.levels) && source.levels.length ? source.levels.join('/') : '';
  return textList([source?.vpatVersion ? `VPAT ${source.vpatVersion}` : '', textList([wcag, levels])]);
}

function fileCard(el, source) {
  return el('div', { className: 'file-card', 'data-ui': 'selected-source-card' },
    el('span', { className: 'file-type' }, source?.type || 'FILE'),
    el('div', {},
      el('p', { className: 'file-name' }, source?.name || 'Selected file'),
      el('p', { className: 'file-meta' }, sourceMeta(source, values => values.filter(Boolean).join(' · '))),
    ),
  );
}

function sourcePanel(documentRef, state) {
  const { el, textList } = createDomHelpers(documentRef);
  const ready = state.status === CLIENT_STATES.READY;
  if (ready) {
    return el('section', { className: 'source-panel source-panel-ready', 'aria-labelledby': 'source-heading' },
      el('h2', { id: 'source-heading' }, 'Choose a VPAT'),
      el('button', { className: 'btn btn-primary', type: 'button', 'data-action': 'choose-source' }, 'Choose from Google Drive'),
      el('p', { className: 'privacy-note' }, el('strong', {}, 'Private output.'), ' A new Google Sheet is created in My Drive/VPAT Analyzer Results.'),
    );
  }

  return el('section', { className: 'source-panel source-panel-selected', 'aria-label': 'Selected source' },
    fileCard(el, state.source),
    coverageText(state.source, textList)
      ? el('div', { className: 'tag-list', 'aria-label': 'Source details' },
          ...(state.source?.vpatVersion ? [el('span', { className: 'tag' }, `VPAT ${state.source.vpatVersion}`)] : []),
          ...(state.source?.wcagVersion ? [el('span', { className: 'tag' }, textList([`WCAG ${state.source.wcagVersion}`, (state.source.levels || []).join('/')]))] : []),
        )
      : null,
  );
}

function stageList(documentRef, state) {
  const { el } = createDomHelpers(documentRef);
  return el('ol', { className: 'stage-list', 'aria-label': 'Analysis stages' },
    ...PROCESSING_STAGES.map((stage, index) => {
      const stageState = index < state.stageIndex ? 'complete' : index === state.stageIndex ? 'current' : 'waiting';
      const status = stageState === 'complete' ? 'Completed' : stageState === 'current' ? 'In progress' : 'Waiting';
      return el('li', { className: 'stage-item', 'data-state': stageState },
        el('span', { className: 'stage-marker', 'aria-hidden': 'true' }, stageState === 'complete' ? 'Done' : String(index + 1)),
        el('span', { className: 'stage-name' }, stage),
        el('span', { className: 'stage-status' }, status),
      );
    }),
  );
}

function errorState(documentRef, state) {
  const { el } = createDomHelpers(documentRef);
  const content = ERROR_CONTENT[state.status];
  const detail = state.errorDetail ? el('p', { className: 'supporting-copy' }, state.errorDetail) : null;
  return el('section', { className: 'state-card', 'aria-labelledby': 'state-heading' },
    el('p', { className: 'eyebrow' }, content.eyebrow),
    el('h2', { className: 'error-heading', id: 'state-heading', tabIndex: -1, 'data-state-heading': 'true' }, content.heading),
    el('div', { className: 'error-note' },
      el('strong', {}, content.strong),
      content.explanation,
      detail,
    ),
    el('div', { className: 'action-row' },
      el('button', { className: 'btn btn-primary', type: 'button', 'data-action': 'choose-different' }, content.action),
    ),
  );
}

function stateCard(documentRef, state) {
  const { el } = createDomHelpers(documentRef);
  if (state.status === CLIENT_STATES.VALIDATING) {
    return el('section', { className: 'state-card', 'aria-labelledby': 'state-heading', 'aria-busy': 'true' },
      el('p', { className: 'eyebrow' }, 'Eligibility review'),
      el('h2', { id: 'state-heading', tabIndex: -1, 'data-state-heading': 'true' }, 'Checking file access and format…'),
      el('p', { className: 'state-lead' }, 'The source stays visible while its access, file type, VPAT version, and WCAG-table scope are checked.'),
    );
  }

  if (state.status === CLIENT_STATES.SELECTED) {
    return el('section', { className: 'state-card', 'aria-labelledby': 'state-heading' },
      el('p', { className: 'eyebrow' }, 'Source selected'),
      el('h2', { id: 'state-heading', tabIndex: -1, 'data-state-heading': 'true' }, 'Source is ready'),
      el('p', { className: 'state-lead' }, 'The Drive file is accessible and uses a supported format. VPAT 2.5 and WCAG-table eligibility are checked during analysis.'),
      el('div', { className: 'eligibility' }, el('p', {}, el('strong', {}, 'Ready to analyze WCAG tables.'))),
      el('div', { className: 'action-row' },
        el('button', { className: 'btn btn-primary', type: 'button', 'data-action': 'analyze' }, 'Analyze VPAT'),
        el('button', { className: 'btn btn-secondary', type: 'button', 'data-action': 'choose-different' }, 'Choose a different file'),
      ),
    );
  }

  if (state.status === CLIENT_STATES.PROCESSING) {
    return el('section', { className: 'state-card', 'aria-labelledby': 'state-heading', 'aria-busy': 'true' },
      el('p', { className: 'eyebrow' }, 'Analysis in progress'),
      el('h2', { id: 'state-heading', tabIndex: -1, 'data-state-heading': 'true' }, 'Analyzing VPAT'),
      el('p', { className: 'state-lead' }, 'The selected source stays visible while the WCAG tables are reviewed and the private result is prepared.'),
      stageList(documentRef, state),
    );
  }

  if (state.status === CLIENT_STATES.ANALYSIS_RETRYABLE) {
    return el('section', { className: 'state-card', 'aria-labelledby': 'state-heading' },
      el('p', { className: 'eyebrow' }, 'Analysis interrupted'),
      el('h2', { className: 'error-heading', id: 'state-heading', tabIndex: -1, 'data-state-heading': 'true' }, 'Analysis was interrupted'),
      el('div', { className: 'error-note' },
        el('strong', {}, 'Your selected source is still available.'),
        'No quality grade was assigned. Try the analysis again or choose a different file.',
        state.errorDetail ? el('p', { className: 'supporting-copy' }, state.errorDetail) : null,
      ),
      el('div', { className: 'action-row' },
        el('button', { className: 'btn btn-primary', type: 'button', 'data-action': 'retry-analysis' }, 'Try analysis again'),
        el('button', { className: 'btn btn-secondary', type: 'button', 'data-action': 'choose-different' }, 'Choose a different file'),
      ),
    );
  }

  if (state.status === CLIENT_STATES.EXPORT_ERROR) {
    return el('section', { className: 'state-card', 'aria-labelledby': 'state-heading' },
      el('p', { className: 'eyebrow' }, 'Google Sheet not created'),
      el('h2', { className: 'error-heading', id: 'state-heading', tabIndex: -1, 'data-state-heading': 'true' }, 'Your analysis is complete, but the Sheet wasn’t created'),
      el('div', { className: 'error-note' },
        el('strong', {}, 'Your completed analysis is preserved.'),
        'Try creating the Sheet again without reanalyzing the VPAT. This issue does not change the report-quality result.',
        state.errorDetail ? el('p', { className: 'supporting-copy' }, state.errorDetail) : null,
      ),
      el('div', { className: 'action-row result-actions' },
        el('button', { className: 'btn btn-primary', type: 'button', 'data-action': 'retry-export', disabled: state.exportRetrying }, state.exportRetrying ? 'Creating the Sheet…' : 'Try creating the Sheet again'),
        el('button', { className: 'btn btn-secondary', type: 'button', 'data-action': 'save-pdf' }, 'Save as PDF'),
      ),
    );
  }

  if (state.status === CLIENT_STATES.SUCCESS) return successState(documentRef, state);
  return errorState(documentRef, state);
}

function successState(documentRef, state) {
  const { el } = createDomHelpers(documentRef);
  const result = state.result || {};
  const summary = result.summary || {};
  const quality = qualityPresentation(summary);
  const sheetCreated = isTrustedGoogleSheetUrl(result.sheet?.url);
  const localPreview = result.localPreview === true;
  const reviewCount = [...(result.wcagItems || []), ...(result.qualityItems || [])].filter(item => item.needsReview).length;
  return el('section', { className: 'state-card', 'aria-labelledby': 'state-heading' },
    el('p', { className: 'eyebrow' }, 'Analysis complete'),
    el('h2', { id: 'state-heading', tabIndex: -1, 'data-state-heading': 'true' }, 'Your VPAT analysis is ready'),
    el('div', { className: 'result-grade' },
      el('p', { className: 'grade-label' }, 'Report quality'),
      el('p', { className: 'grade-value' }, quality.label),
      el('p', { className: 'grade-context' }, quality.context),
      reviewCount > 0
        ? el('button', { className: 'review-jump', type: 'button', 'data-action': 'show-review-items', 'aria-label': `${reviewCount} items to review. Go to Items needing review.` }, el('strong', {}, reviewCount), ' items to review')
        : null,
    ),
    el('p', { className: 'destination' }, el('strong', {}, sheetCreated
      ? 'Created privately in My Drive/VPAT Analyzer Results.'
      : localPreview
        ? 'Local synthetic preview. No Google Sheet was created.'
        : 'Analysis complete. The Google Sheet receipt is unavailable.')),
    el('div', { className: 'action-row result-actions' },
      el('button', { className: 'btn btn-primary', type: 'button', 'data-action': 'open-sheet' }, localPreview ? 'Open local Sheet preview (new tab)' : 'Open Google Sheet (new tab)'),
      el('button', { className: 'btn btn-secondary', type: 'button', 'data-action': 'save-pdf' }, 'Save as PDF'),
    ),
    el('p', { className: 'action-feedback', id: 'result-action-feedback', hidden: true }),
  );
}

function detailList(documentRef, pairs) {
  const { el } = createDomHelpers(documentRef);
  const nodes = [];
  for (const [label, value, className = ''] of pairs) {
    nodes.push(el('dt', {}, label));
    nodes.push(el('dd', { className }, value == null ? '' : String(value)));
  }
  return el('dl', { className: 'detail-list' }, nodes);
}

function wcagDetails(documentRef, item) {
  return detailList(documentRef, [
    ['Conformance Level (author)', item.authorConformance],
    ['Remarks and Explanations (author)', item.authorRemarks, 'author-response'],
    ['Analyzer assessment', item.assessment, 'analyzer-assessment'],
    ['Reviewer action', item.reviewerAction, 'reviewer-action'],
    ['Confidence', confidencePresentation(item.confidence)],
  ]);
}

function qualityDetails(documentRef, item) {
  return detailList(documentRef, [
    ['Evidence location', item.evidenceLocation],
    ['Exact evidence', item.exactEvidence, 'author-response'],
    ['Analyzer assessment', item.assessment, 'analyzer-assessment'],
    ['Reviewer action', item.reviewerAction, 'reviewer-action'],
  ]);
}

function itemDisclosure(documentRef, item, type) {
  const { el } = createDomHelpers(documentRef);
  const title = type === 'wcag' ? `${item.criterion} — ${item.title}` : `${item.displayId || item.id} — ${item.title}`;
  const needsReview = Boolean(item.needsReview);
  return el('details', { className: 'item-disclosure', 'data-review': String(needsReview) },
    el('summary', {}, el('span', { className: `status-badge ${needsReview ? 'review' : 'clear'}` }, needsReview ? 'Needs review' : 'Clear'), el('span', { className: 'disclosure-title' }, title)),
    el('div', { className: 'disclosure-content' }, type === 'wcag' ? wcagDetails(documentRef, item) : qualityDetails(documentRef, item)),
  );
}

function summaryPanel(documentRef, state) {
  const { el } = createDomHelpers(documentRef);
  const result = state.result || {};
  const reviewItems = [
    ...(result.wcagItems || []).filter(item => item.needsReview).map(item => itemDisclosure(documentRef, item, 'wcag')),
    ...(result.qualityItems || []).filter(item => item.needsReview).map(item => itemDisclosure(documentRef, item, 'quality')),
  ];
  const source = result.source || state.source || {};
  const sheetStatus = state.status === CLIENT_STATES.EXPORT_ERROR
    ? 'Not created — retry Sheet creation'
    : isTrustedGoogleSheetUrl(result.sheet?.url)
      ? 'My Drive/VPAT Analyzer Results'
      : result.localPreview === true
        ? 'Local synthetic preview only'
        : 'Receipt unavailable';
  return el('div', {},
    el('div', { className: 'panel-heading' },
      el('h3', {}, 'Summary'),
      state.status === CLIENT_STATES.EXPORT_ERROR ? el('span', { className: 'status-tag attention' }, 'Analysis complete · Sheet pending') : null,
    ),
    el('div', { className: 'overview-stack' },
      reviewItems.length
        ? el('section', { className: 'overview-block' },
            el('h4', { id: 'items-needing-review-heading', tabIndex: -1 }, 'Items needing review'),
            el('div', { className: 'disclosure-list' }, reviewItems),
          )
        : null,
      el('section', { className: 'overview-block' },
        el('h4', {}, 'Source'),
        el('ul', { className: 'overview-detail-list' },
          el('li', {}, el('span', { className: 'overview-label' }, 'File'), el('strong', {}, source.name || 'Selected source')),
          el('li', {}, el('span', { className: 'overview-label' }, 'Coverage'), el('strong', {}, coverageText(source, values => values.filter(Boolean).join(' · ')) || 'VPAT 2.5 · WCAG tables')),
          el('li', {}, el('span', { className: 'overview-label' }, 'Google Sheet'), el('strong', {}, sheetStatus)),
        ),
      ),
    ),
  );
}

function filterControls(documentRef, target, label, items, selected) {
  const { el } = createDomHelpers(documentRef);
  const reviewCount = items.filter(item => item.needsReview).length;
  return el('div', { className: 'filter-block' },
    el('p', { className: 'filter-label', id: `${target}-filter-label` }, label),
    el('div', { className: 'filter-group', role: 'group', 'aria-labelledby': `${target}-filter-label` },
      el('button', { className: 'filter-button', id: `${target}-filter-all`, type: 'button', 'aria-pressed': selected === 'all', 'data-action': 'filter-results', 'data-filter-target': target, 'data-filter-value': 'all' }, `All shown (${items.length})`),
      reviewCount ? el('button', { className: 'filter-button', id: `${target}-filter-review`, type: 'button', 'aria-pressed': selected === 'review', 'data-action': 'filter-results', 'data-filter-target': target, 'data-filter-value': 'review' }, `Needs review (${reviewCount})`) : null,
    ),
  );
}

function resultDisclosures(documentRef, type, items, selected) {
  const { el } = createDomHelpers(documentRef);
  const visible = selected === 'review' ? items.filter(item => item.needsReview) : items;
  return el('div', { className: 'disclosure-list', 'data-filter-set': type }, ...visible.map(item => itemDisclosure(documentRef, item, type)));
}

function wcagPanel(documentRef, state) {
  const { el } = createDomHelpers(documentRef);
  const result = state.result || {};
  const items = result.wcagItems || [];
  const reviewed = result.summary?.criteriaReviewed || items.length;
  const selected = state.filters.wcag;
  const shown = selected === 'review' ? items.filter(item => item.needsReview).length : items.length;
  const representative = items.length < reviewed;
  return el('div', {},
    el('div', { className: 'panel-heading' }, el('h3', {}, 'WCAG criteria')),
    filterControls(documentRef, 'wcag', 'Filter criteria', items, selected),
    el('p', { className: 'sample-note', id: 'wcag-filter-summary' }, selected === 'review' ? `Showing ${shown}${representative ? ' representative' : ''} criteria that need review.` : `Showing ${shown}${representative ? ' representative' : ''} criteria of ${reviewed} reviewed.`),
    resultDisclosures(documentRef, 'wcag', items, selected),
  );
}

function scoringBands(documentRef, score) {
  const { el } = createDomHelpers(documentRef);
  const rows = [
    ['90–100', 'Outstanding completeness and clarity'],
    ['80–89', 'Strong quality with limited review needs'],
    ['70–79', 'Meets expectations with improvements needed'],
    ['61–69', 'Material improvements are needed'],
    ['0–60', 'Substantial quality gaps require review'],
  ];
  return el('details', { className: 'scoring-bands' },
    el('summary', {}, 'View all scoring bands'),
    el('div', { className: 'disclosure-content' },
      el('table', { className: 'band-table' },
        el('caption', {}, 'Report-quality scoring bands'),
        el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Range'), el('th', { scope: 'col' }, 'Meaning'))),
        el('tbody', {}, ...rows.map(([range, meaning]) => {
          const [minimum, maximum] = range.split('–').map(Number);
          return el('tr', { className: score >= minimum && score <= maximum ? 'current' : '' }, el('th', { scope: 'row' }, range), el('td', {}, `${meaning}${score >= minimum && score <= maximum ? ' — current band' : ''}`));
        })),
      ),
    ),
  );
}

function qualityPanel(documentRef, state) {
  const { el } = createDomHelpers(documentRef);
  const result = state.result || {};
  const items = result.qualityItems || [];
  const completed = result.summary?.qualityRequirements || items.length;
  const selected = state.filters.quality;
  const shown = selected === 'review' ? items.filter(item => item.needsReview).length : items.length;
  const representative = items.length < completed;
  const quality = qualityPresentation(result.summary);
  return el('div', {},
    el('div', { className: 'panel-heading' }, el('h3', {}, 'Report quality')),
    el('section', { className: 'quality-score-summary' },
      el('p', { className: 'eyebrow' }, quality.scored ? 'Current quality band' : 'Report quality status'),
      el('p', { className: 'score-line' }, quality.label),
      el('p', {}, `${quality.context} ${quality.scored ? 'The score reflects report completeness and clarity; it does not test the product.' : 'Incomplete is not a report-quality failure and is not an F grade.'}`),
    ),
    el('h4', { id: 'quality-checks-heading' }, 'Quality checks'),
    filterControls(documentRef, 'quality', 'Filter quality checks', items, selected),
    el('p', { className: 'sample-note', id: 'quality-filter-summary' }, selected === 'review' ? `Showing ${shown}${representative ? ' representative' : ''} checks that need review.` : `Showing ${shown}${representative ? ' representative' : ''} checks of ${completed} completed.`),
    resultDisclosures(documentRef, 'quality', items, selected),
    scoringBands(documentRef, quality.score),
  );
}

function methodology(documentRef, state) {
  const { el } = createDomHelpers(documentRef);
  const methodologyData = state.result?.methodology || {};
  const threshold = methodologyData.confidenceThreshold || 70;
  const versions = methodologyData.versions || {};
  return el('details', { className: 'methodology-accordion' },
    el('summary', {}, el('span', { className: 'summary-heading', role: 'heading', 'aria-level': '3' }, 'Methodology & disclaimer')),
    el('div', { className: 'methodology-content' },
      el('div', { className: 'method-grid' },
        el('section', { className: 'method-section' }, el('h4', {}, 'Qualified review required'), el('p', {}, 'Automated findings may be incomplete or incorrect. A qualified reviewer should confirm them. This is not certification or legal approval.')),
        el('section', { className: 'method-section' }, el('h4', {}, 'What is reviewed'), el('p', {}, 'Only extracted VPAT 2.5 WCAG conformance-table content is reviewed. Source statements are kept separate from report-quality checks.')),
        el('section', { className: 'method-section' }, el('h4', {}, 'What is not tested'), el('p', {}, 'The product described by the VPAT is not tested. Other conformance frameworks are outside this focused review.')),
        el('section', { className: 'method-section' }, el('h4', {}, 'Confidence and review'), el('p', {}, `The confidence threshold is ${threshold}. Findings below the threshold are marked for review; other findings may still require reviewer judgment.`)),
        el('section', { className: 'method-section' }, el('h4', {}, 'Operational errors'), el('p', {}, 'Ingestion, missing-result, provider, and export problems are Incomplete or Error. They are never recorded as a quality Fail and do not produce an F grade.')),
        el('section', { className: 'method-section' }, el('h4', {}, 'Disclaimer'), el('p', {}, 'Results support review and are not certification, legal advice, NYU endorsement of vendor claims, or proof of product accessibility.')),
        el('section', { className: 'provenance' },
          el('h4', {}, 'Version provenance'),
          el('dl', { className: 'fact-list' },
            ...Object.entries(versions).flatMap(([label, value]) => [el('dt', {}, label), el('dd', {}, value)]),
          ),
        ),
      ),
    ),
  );
}

function outputWorkspace(documentRef, state) {
  const { el } = createDomHelpers(documentRef);
  const panels = [summaryPanel(documentRef, state), wcagPanel(documentRef, state), qualityPanel(documentRef, state)];
  const tabs = REVIEW_VIEWS.map((view, index) => el('button', {
    className: 'tab',
    type: 'button',
    role: 'tab',
    id: `tab-${view.id}`,
    'aria-selected': index === state.activeTab,
    'aria-controls': `panel-${view.id}`,
    tabIndex: index === state.activeTab ? 0 : -1,
    'data-action': 'activate-tab',
    'data-tab-index': index,
  }, view.label));
  const tabpanels = REVIEW_VIEWS.map((view, index) => el('section', {
    className: 'tabpanel',
    role: 'tabpanel',
    id: `panel-${view.id}`,
    'aria-labelledby': `tab-${view.id}`,
    tabIndex: 0,
    hidden: index !== state.activeTab,
  }, panels[index]));
  return el('section', { className: 'output-section', 'aria-labelledby': 'output-heading' },
    el('div', { className: 'output-header' }, el('h2', { id: 'output-heading' }, 'Analysis results'), state.status === CLIENT_STATES.EXPORT_ERROR ? el('p', {}, 'Results remain available while Sheet creation is retried.') : null),
    el('div', { className: 'tabs', role: 'tablist', 'aria-labelledby': 'output-heading', 'aria-orientation': 'horizontal' }, tabs),
    tabpanels,
    methodology(documentRef, state),
    el('div', { className: 'final-actions' }, el('button', { className: 'btn btn-secondary', type: 'button', 'data-action': 'analyze-another' }, 'Analyze another')),
  );
}

function driveDialog(documentRef) {
  const { el } = createDomHelpers(documentRef);
  return el('dialog', { className: 'drive-dialog', id: 'drive-dialog', 'aria-labelledby': 'drive-dialog-heading', 'aria-describedby': 'drive-dialog-description' },
    el('div', { className: 'dialog-header' },
      el('div', {}, el('h2', { id: 'drive-dialog-heading', tabIndex: -1 }, 'Google Drive picker'), el('p', { id: 'drive-dialog-description' }, 'Production uses Google Picker. Select a synthetic VPAT for this preview.')),
      el('button', { className: 'dialog-close', type: 'button', 'data-action': 'close-chooser', 'aria-label': 'Close file chooser' }, 'Close'),
    ),
    el('div', { className: 'dialog-body' },
      el('p', { className: 'dialog-status', id: 'drive-dialog-status', role: 'status', 'aria-live': 'polite' }),
      el('ul', { className: 'drive-file-list', id: 'drive-file-list', 'aria-label': 'Available VPAT files' }),
    ),
  );
}

export function renderClient(documentRef, root, state) {
  const { el } = createDomHelpers(documentRef);
  const complete = isCompletedState(state);
  const frame = el('div', { className: 'app-frame' },
    el('header', { className: 'app-header' },
      el('div', { className: 'brand-lockup' }, el('span', { className: 'nyu-wordmark', 'aria-label': 'New York University' }, 'NYU'), el('h1', {}, 'NYU VPAT Analyzer')),
    ),
    el('main', { className: 'workbench', id: 'main-workbench', tabIndex: -1, 'data-scenario': state.status },
      complete ? null : sourcePanel(documentRef, state),
      state.status === CLIENT_STATES.READY ? null : el('div', { className: 'result-workspace', 'data-has-results': complete }, stateCard(documentRef, state), complete ? outputWorkspace(documentRef, state) : null),
    ),
  );
  root.replaceChildren(frame, driveDialog(documentRef));
  return frame;
}
