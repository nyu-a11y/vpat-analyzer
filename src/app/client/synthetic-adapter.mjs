import { PROCESSING_STAGES, SHEET_TABS } from './model.mjs';

export const SYNTHETIC_SOURCE = Object.freeze({
  id: 'synthetic-northstar-docx',
  name: 'Northstar Collaboration Suite VPAT 2.5.docx',
  type: 'DOCX',
  sizeLabel: '1.8 MB',
  vpatVersion: '2.5',
  wcagVersion: '2.2',
  levels: Object.freeze(['A', 'AA']),
});

const SYNTHETIC_PDF = Object.freeze({
  id: 'synthetic-northstar-pdf',
  name: 'Northstar Collaboration Suite VPAT 2.5.pdf',
  type: 'PDF',
  sizeLabel: '1.3 MB',
  vpatVersion: '2.5',
  wcagVersion: '2.2',
  levels: Object.freeze(['A', 'AA']),
});

const SYNTHETIC_SCANNED_PDF = Object.freeze({
  id: 'synthetic-scanned-pdf',
  name: 'Scanned Accessibility Conformance Report.pdf',
  type: 'PDF',
  sizeLabel: '2.4 MB',
});

export const SYNTHETIC_WCAG_ITEMS = Object.freeze([
  Object.freeze({
    id: 'wcag-sc-1-1-1',
    criterion: '1.1.1',
    title: 'Non-text Content',
    authorConformance: 'Supports',
    authorRemarks: 'Alternative text is provided for application icons and system-generated images. User-uploaded images rely on the author to provide alternative text.',
    assessmentSummary: 'The author response includes a user-upload exception.',
    assessment: 'Needs review. The remarks describe an exception while the stated level is Supports.',
    reviewerAction: 'Confirm whether any user-upload workflow permits informative images without equivalent text, then reconcile the level and remarks if needed.',
    confidence: 84,
    needsReview: true,
  }),
  Object.freeze({
    id: 'wcag-sc-1-2-1',
    criterion: '1.2.1',
    title: 'Audio-only and Video-only (Prerecorded)',
    authorConformance: 'Partially Supports',
    authorRemarks: 'Prerecorded video produced by Northstar includes captions. Equivalent alternatives are not available for all customer-uploaded audio-only or video-only content.',
    assessmentSummary: 'The response does not fully evidence equivalent alternatives.',
    assessment: 'Needs review. The first sentence addresses captions rather than the equivalent alternatives covered by 1.2.1; the second identifies incomplete coverage.',
    reviewerAction: 'Confirm the scope and evidence for audio-only and video-only content.',
    confidence: 76,
    needsReview: true,
  }),
  Object.freeze({
    id: 'wcag-sc-1-3-1',
    criterion: '1.3.1',
    title: 'Info and Relationships',
    authorConformance: 'Supports',
    authorRemarks: 'Headings, lists, form labels, and data-table relationships are programmatically conveyed in the web and desktop applications.',
    assessmentSummary: 'The response directly addresses structure and relationships.',
    assessment: 'Clear. The response directly addresses the criterion and contains no contradictory exception in the extracted row.',
    reviewerAction: 'No additional review is indicated for this representative row.',
    confidence: 91,
    needsReview: false,
  }),
  Object.freeze({
    id: 'wcag-sc-2-1-1',
    criterion: '2.1.1',
    title: 'Keyboard',
    authorConformance: 'Supports',
    authorRemarks: 'All documented product functions can be operated through a keyboard interface without requiring specific timings for individual keystrokes.',
    assessmentSummary: 'The response directly addresses keyboard operation.',
    assessment: 'Clear. The response addresses keyboard operation and the keystroke-timing qualifier.',
    reviewerAction: 'No additional review is indicated for this representative row.',
    confidence: 88,
    needsReview: false,
  }),
  Object.freeze({
    id: 'wcag-sc-2-4-7',
    criterion: '2.4.7',
    title: 'Focus Visible',
    authorConformance: 'Partially Supports',
    authorRemarks: 'Keyboard focus is visible in the default theme. Some toolbar controls in customer-created themes may not display a visible focus indicator.',
    assessmentSummary: 'The author identifies a focus-visibility exception.',
    assessment: 'Needs review. The remarks identify a known exception.',
    reviewerAction: 'Confirm the affected controls and themes, and verify that the conformance level reflects their scope.',
    confidence: 68,
    needsReview: true,
  }),
]);

export const SYNTHETIC_QUALITY_ITEMS = Object.freeze([
  Object.freeze({
    id: 'qr-vpat-wcag-version',
    displayId: 'QR-01',
    title: 'VPAT and WCAG version identified',
    result: 'Met',
    evidenceLocation: 'Document heading; WCAG table heading',
    exactEvidence: 'Northstar Collaboration Suite Accessibility Conformance Report — VPAT Version 2.5; WCAG 2.2 Report — Levels A and AA.',
    evidenceSummary: 'The document and table identify compatible versions.',
    assessment: 'Met. The document and table identify compatible VPAT and WCAG versions.',
    reviewerAction: 'No additional review is indicated for this representative check.',
    needsReview: false,
  }),
  Object.freeze({
    id: 'qr-conformance-language',
    displayId: 'QR-04',
    title: 'Conformance language used consistently',
    result: 'Needs review',
    evidenceLocation: 'WCAG table introduction · Notes',
    exactEvidence: 'Customer-configured content is generally supported where applicable.',
    evidenceSummary: 'One scope statement uses undefined qualifiers.',
    assessment: 'Needs review. “Generally” and “where applicable” do not identify which features are covered or what exceptions apply.',
    reviewerAction: 'Replace or qualify the statement with specific scope and exceptions.',
    needsReview: true,
  }),
  Object.freeze({
    id: 'qr-remarks-support-conformance',
    displayId: 'QR-07',
    title: 'Remarks support stated conformance',
    result: 'Met',
    evidenceLocation: 'WCAG rows 1.3.1 and 2.1.1 · Remarks and Explanations',
    exactEvidence: 'The sampled remarks describe programmatic structure and complete keyboard operation.',
    evidenceSummary: 'Sampled remarks describe criterion-relevant behavior.',
    assessment: 'Met. The sampled remarks describe product behavior relevant to their stated conformance levels.',
    reviewerAction: 'No additional review is indicated for this representative check.',
    needsReview: false,
  }),
  Object.freeze({
    id: 'qr-unsupported-claims-flagged',
    displayId: 'QR-11',
    title: 'Unsupported claims are flagged',
    result: 'Met',
    evidenceLocation: 'WCAG rows 1.1.1, 1.2.1, and 2.4.7',
    exactEvidence: 'The source identifies user-uploaded image, media-alternative, and themed-focus limitations.',
    evidenceSummary: 'Limitations are routed to review rather than treated as clear.',
    assessment: 'Met. Each limitation is surfaced as a review item instead of being treated as a clear claim.',
    reviewerAction: 'No additional review is indicated for this representative check.',
    needsReview: false,
  }),
  Object.freeze({
    id: 'qr-limitations-explicit',
    displayId: 'QR-16',
    title: 'Limitations and exceptions are explicit',
    result: 'Met',
    evidenceLocation: 'WCAG rows 1.2.1 and 2.4.7 · Remarks and Explanations',
    exactEvidence: 'The sampled exceptions identify affected customer-uploaded content and customer-created theme controls.',
    evidenceSummary: 'The sampled exceptions identify affected content or controls.',
    assessment: 'Met. The source names both the affected content or controls and the limitation.',
    reviewerAction: 'No additional review is indicated for this representative check.',
    needsReview: false,
  }),
]);

export const SYNTHETIC_RESULT = Object.freeze({
  localPreview: true,
  analysisId: 'synthetic-analysis-northstar',
  summary: Object.freeze({
    grade: 'B',
    score: 82,
    criteriaReviewed: 55,
    qualityRequirements: 16,
  }),
  source: SYNTHETIC_SOURCE,
  wcagItems: SYNTHETIC_WCAG_ITEMS,
  qualityItems: SYNTHETIC_QUALITY_ITEMS,
  sheet: Object.freeze({
    location: 'My Drive/VPAT Analyzer Results',
    url: '',
    tabs: SHEET_TABS,
  }),
  methodology: Object.freeze({
    confidenceThreshold: 70,
    versions: Object.freeze({
      catalog: 'vpat-2.5-wcag-criteria.v1',
      rubric: 'quality-rubric.v1',
      scoring: 'scoring.v1',
      prompt: 'analysis-prompt.v1',
      responseSchema: 'analysis-response.v1',
    }),
  }),
});

function delay(milliseconds) {
  return new Promise(resolve => globalThis.setTimeout(resolve, milliseconds));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createSyntheticClientBridge(options = {}) {
  const stageDelay = Number.isFinite(options.stageDelay) ? Math.max(0, options.stageDelay) : 180;
  const files = options.files || [SYNTHETIC_SOURCE, SYNTHETIC_PDF, SYNTHETIC_SCANNED_PDF];
  const scenario = String(options.scenario || '');
  let analysisAttempts = 0;

  return {
    async resumeActive() {
      return { status: 'ready' };
    },

    async listDriveFiles({ query = '' } = {}) {
      const normalized = String(query).trim().toLocaleLowerCase();
      await delay(Math.min(stageDelay, 80));
      return files.filter(file => !normalized || file.name.toLocaleLowerCase().includes(normalized)).map(clone);
    },

    async validateSource({ requestId, source }) {
      await delay(stageDelay);
      if (source.id === SYNTHETIC_SCANNED_PDF.id) {
        return { requestId, status: 'rejected', kind: 'non-searchable-pdf' };
      }
      return { requestId, status: 'selected', source: clone(source) };
    },

    async startAnalysis({ requestId, source, onEvent }) {
      analysisAttempts += 1;
      for (let stageIndex = 0; stageIndex < PROCESSING_STAGES.length; stageIndex += 1) {
        await delay(stageDelay);
        onEvent({ type: 'STAGE_CHANGED', requestId, stageIndex });
      }
      await delay(stageDelay);
      if (scenario === 'analysis-retry' && analysisAttempts === 1) {
        return {
          requestId,
          status: 'error',
          retryable: true,
          detail: 'The synthetic provider was interrupted once for local recovery proof.',
        };
      }
      if (scenario === 'export-retry' && analysisAttempts === 1) {
        return {
          requestId,
          status: 'export-error',
          result: { ...clone(SYNTHETIC_RESULT), source: clone(source) },
          detail: 'The synthetic Sheet export was interrupted once for local recovery proof.',
        };
      }
      return {
        requestId,
        status: 'complete',
        result: { ...clone(SYNTHETIC_RESULT), source: clone(source) },
      };
    },

    async retryExport({ requestId }) {
      await delay(stageDelay * 2);
      return { requestId, status: 'complete', result: clone(SYNTHETIC_RESULT) };
    },
  };
}
