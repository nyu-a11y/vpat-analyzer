export const PROCESSING_STAGES = Object.freeze([
  'Preparing the source',
  'Extracting WCAG tables',
  'Checking criteria and coverage',
  'Analyzing report quality',
  'Preparing your Google Sheet',
]);

export const REVIEW_VIEWS = Object.freeze([
  Object.freeze({ id: 'summary', label: 'Summary' }),
  Object.freeze({ id: 'wcag-criteria', label: 'WCAG criteria' }),
  Object.freeze({ id: 'report-quality', label: 'Report quality' }),
]);

export const SHEET_TABS = Object.freeze([
  'Overview',
  'Line-item Review',
  'Quality Requirements',
  'Scoring',
  'Methodology & disclaimer',
]);

export const CLIENT_STATES = Object.freeze({
  READY: 'ready',
  VALIDATING: 'validating',
  SELECTED: 'selected',
  PROCESSING: 'processing',
  SUCCESS: 'success',
  INACCESSIBLE: 'inaccessible',
  UNSUPPORTED: 'unsupported',
  NON_SEARCHABLE_PDF: 'non-searchable-pdf',
  NO_WCAG_TABLES: 'no-wcag-tables',
  ANALYSIS_RETRYABLE: 'analysis-retryable',
  ANALYSIS_PERMANENT: 'analysis-permanent',
  EXPORT_ERROR: 'export-error',
  NYU_ACCESS_ERROR: 'nyu-access-error',
});

const FILTERS = Object.freeze({ wcag: 'all', quality: 'all' });

export function createInitialState() {
  return {
    status: CLIENT_STATES.READY,
    activeRequestId: null,
    source: null,
    result: null,
    stageIndex: -1,
    activeTab: 0,
    filters: { ...FILTERS },
    exportRetrying: false,
    errorDetail: '',
  };
}

function hasStaleRequest(state, event) {
  if (!Object.hasOwn(event, 'requestId')) return false;
  if (event.type === 'VALIDATION_STARTED') return false;
  return !event.requestId || event.requestId !== state.activeRequestId;
}

function validTabIndex(value) {
  return Number.isInteger(value) && value >= 0 && value < REVIEW_VIEWS.length;
}

function errorState(kind) {
  const states = {
    inaccessible: CLIENT_STATES.INACCESSIBLE,
    unsupported: CLIENT_STATES.UNSUPPORTED,
    'non-searchable-pdf': CLIENT_STATES.NON_SEARCHABLE_PDF,
    'no-wcag-tables': CLIENT_STATES.NO_WCAG_TABLES,
    retryable: CLIENT_STATES.ANALYSIS_RETRYABLE,
    permanent: CLIENT_STATES.ANALYSIS_PERMANENT,
    'nyu-access': CLIENT_STATES.NYU_ACCESS_ERROR,
  };
  return states[kind] || CLIENT_STATES.ANALYSIS_PERMANENT;
}

/**
 * Pure client projection reducer. Returning the same object is meaningful: the
 * controller must not render, focus, announce, navigate, or export for an
 * ignored event.
 */
export function reduceClientState(state, event) {
  if (!state || !event || typeof event.type !== 'string') return state;
  if (hasStaleRequest(state, event)) return state;

  switch (event.type) {
    case 'RESET':
      return createInitialState();

    case 'VALIDATION_STARTED':
      if (!event.requestId || !event.source) return state;
      return {
        ...createInitialState(),
        status: CLIENT_STATES.VALIDATING,
        activeRequestId: event.requestId,
        source: event.source,
      };

    case 'VALIDATION_SUCCEEDED':
      if (state.status !== CLIENT_STATES.VALIDATING || !event.source) return state;
      return {
        ...state,
        status: CLIENT_STATES.SELECTED,
        source: event.source,
        errorDetail: '',
      };

    case 'VALIDATION_FAILED':
      if (state.status !== CLIENT_STATES.VALIDATING) return state;
      return {
        ...state,
        status: errorState(event.kind),
        errorDetail: typeof event.detail === 'string' ? event.detail : '',
      };

    case 'ANALYSIS_STARTED':
      if (![CLIENT_STATES.SELECTED, CLIENT_STATES.ANALYSIS_RETRYABLE].includes(state.status)) return state;
      return {
        ...state,
        status: CLIENT_STATES.PROCESSING,
        result: null,
        stageIndex: -1,
        activeTab: 0,
        filters: { ...FILTERS },
        errorDetail: '',
      };

    case 'STAGE_CHANGED': {
      if (state.status !== CLIENT_STATES.PROCESSING) return state;
      const stageIndex = Number(event.stageIndex);
      if (!Number.isInteger(stageIndex) || stageIndex < 0 || stageIndex >= PROCESSING_STAGES.length) return state;
      if (stageIndex <= state.stageIndex) return state;
      return { ...state, stageIndex };
    }

    case 'ANALYSIS_FAILED':
      if (state.status !== CLIENT_STATES.PROCESSING) return state;
      return {
        ...state,
        status: errorState(event.retryable ? 'retryable' : 'permanent'),
        result: null,
        errorDetail: typeof event.detail === 'string' ? event.detail : '',
      };

    case 'ANALYSIS_REJECTED':
      if (state.status !== CLIENT_STATES.PROCESSING) return state;
      return {
        ...state,
        status: errorState(event.kind),
        result: null,
        errorDetail: typeof event.detail === 'string' ? event.detail : '',
      };

    case 'ANALYSIS_COMPLETED':
      if (state.status !== CLIENT_STATES.PROCESSING || !event.result) return state;
      return {
        ...state,
        status: CLIENT_STATES.SUCCESS,
        result: event.result,
        source: event.result.source || state.source,
        stageIndex: PROCESSING_STAGES.length - 1,
        activeTab: 0,
        filters: { ...FILTERS },
        exportRetrying: false,
        errorDetail: '',
      };

    case 'EXPORT_FAILED':
      if (!event.result && !state.result) return state;
      if (![CLIENT_STATES.PROCESSING, CLIENT_STATES.SUCCESS, CLIENT_STATES.EXPORT_ERROR].includes(state.status)) return state;
      return {
        ...state,
        status: CLIENT_STATES.EXPORT_ERROR,
        result: event.result || state.result,
        source: event.result?.source || state.result?.source || state.source,
        stageIndex: PROCESSING_STAGES.length - 1,
        exportRetrying: false,
        errorDetail: typeof event.detail === 'string' ? event.detail : '',
      };

    case 'EXPORT_RETRY_STARTED':
      if (state.status !== CLIENT_STATES.EXPORT_ERROR || state.exportRetrying || !state.result) return state;
      return { ...state, exportRetrying: true, errorDetail: '' };

    case 'EXPORT_RETRY_FAILED':
      if (state.status !== CLIENT_STATES.EXPORT_ERROR || !state.result) return state;
      return {
        ...state,
        exportRetrying: false,
        errorDetail: typeof event.detail === 'string' ? event.detail : '',
      };

    case 'EXPORT_SUCCEEDED':
      if (state.status !== CLIENT_STATES.EXPORT_ERROR || !state.result) return state;
      return {
        ...state,
        status: CLIENT_STATES.SUCCESS,
        result: event.result || state.result,
        source: event.result?.source || state.result?.source || state.source,
        exportRetrying: false,
        errorDetail: '',
      };

    case 'TAB_ACTIVATED':
      if (![CLIENT_STATES.SUCCESS, CLIENT_STATES.EXPORT_ERROR].includes(state.status) || !validTabIndex(event.index)) return state;
      if (event.index === state.activeTab) return state;
      return { ...state, activeTab: event.index };

    case 'FILTER_CHANGED':
      if (![CLIENT_STATES.SUCCESS, CLIENT_STATES.EXPORT_ERROR].includes(state.status)) return state;
      if (!['wcag', 'quality'].includes(event.target) || !['all', 'review'].includes(event.value)) return state;
      if (state.filters[event.target] === event.value) return state;
      return { ...state, filters: { ...state.filters, [event.target]: event.value } };

    default:
      return state;
  }
}

export function isCompletedState(state) {
  return state.status === CLIENT_STATES.SUCCESS || state.status === CLIENT_STATES.EXPORT_ERROR;
}
