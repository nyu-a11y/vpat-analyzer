import catalog from '../../../config/vpat-2.5-wcag-criteria.v1.json' with { type: 'json' };
import rubric from '../../../config/quality-rubric.v1.json' with { type: 'json' };
import scoringRules from '../../../config/scoring-rules.v1.json' with { type: 'json' };

import { createAnalysisOutput } from '../../domain/analysis-output.mjs';
import { validateConformanceResponse, validateQualityResponse } from '../../domain/ai-response-validator.mjs';
import { buildExportModel } from '../../domain/export-model.mjs';
import { QUALITY_REQUIREMENT_IDS } from '../../domain/quality-ids.mjs';
import { exportProvenance } from '../../domain/versions.mjs';

function sourceType(source, ingestion) {
  const type = source?.sourceType || ingestion?.sourceType;
  if (!['google-doc', 'docx', 'pdf'].includes(type)) throw new Error('The source type is unavailable for finalization.');
  return type;
}

export function finalizeProductionAnalysis({
  requestId,
  source,
  ingestion,
  conformanceResponse,
  qualityResponse,
}) {
  const expectedCriterionIds = ingestion.coverage.expectedCriterionIds;
  const validatedConformance = validateConformanceResponse(conformanceResponse, {
    requestId,
    expectedCriterionIds,
    confidenceThreshold: scoringRules.confidenceThreshold,
  });
  const validatedQuality = validateQualityResponse(qualityResponse, {
    requestId,
    expectedRequirementIds: QUALITY_REQUIREMENT_IDS,
    confidenceThreshold: scoringRules.confidenceThreshold,
  });
  const analysisOutput = createAnalysisOutput({
    requestId,
    source: {
      displayName: String(source?.name || ''),
      sourceType: sourceType(source, ingestion),
      vpatVersion: '2.5',
      declaredWcagVersions: [...ingestion.coverage.declaredWcagVersions],
      declaredLevels: [...ingestion.coverage.declaredLevels],
    },
    ingestionResult: ingestion,
    conformanceResponse: validatedConformance,
    qualityResponse: validatedQuality,
    catalog,
    rubric,
    scoringRules,
    provenance: exportProvenance(),
  });
  return {
    analysisOutput,
    exportModel: buildExportModel(analysisOutput),
  };
}

export function mapProductionCompletedResult(payload, sourceFallback = {}) {
  if (!payload || typeof payload !== 'object') return payload;
  if (payload.summary && Array.isArray(payload.wcagItems) && Array.isArray(payload.qualityItems)) {
    const summary = payload.summary.scoreSummary
      ? {
          analysisStatus: payload.summary.analysisStatus,
          grade: payload.summary.scoreSummary.grade,
          score: payload.summary.scoreSummary.percentage,
          criteriaReviewed: payload.summary.counts?.criteria ?? payload.wcagItems.length,
          qualityRequirements: payload.summary.counts?.qualityRequirements ?? payload.qualityItems.length,
        }
      : payload.summary;
    const source = payload.source || {};
    const normalizedType = source.sourceType || sourceFallback.sourceType || '';
    const displayTypes = { 'google-doc': 'GOOGLE DOC', docx: 'DOCX', pdf: 'PDF' };
    return {
      ...payload,
      localPreview: false,
      summary,
      source: {
        ...source,
        id: source.id || sourceFallback.id,
        name: source.name || source.displayName || sourceFallback.name,
        type: source.type || displayTypes[normalizedType] || String(normalizedType).toUpperCase(),
        sourceType: normalizedType,
        sizeLabel: source.sizeLabel || sourceFallback.sizeLabel || '',
        wcagVersion: source.wcagVersion || source.declaredWcagVersions?.at(-1) || '',
        levels: source.levels || (Array.isArray(source.declaredLevels) ? [...source.declaredLevels] : []),
      },
    };
  }
  const analysis = payload.analysisOutput || payload.analysis || payload;
  const receipt = payload.receipt || payload.sheetReceipt || {};
  if (!analysis || !Array.isArray(analysis.wcagFindings) || !Array.isArray(analysis.qualityFindings)) return payload;
  const score = analysis.scoreSummary || {};
  const source = analysis.source || {};
  return {
    localPreview: false,
    analysisId: analysis.requestId,
    summary: {
      analysisStatus: analysis.analysisStatus,
      grade: score.grade,
      score: score.percentage,
      criteriaReviewed: analysis.counts?.criteria ?? analysis.wcagFindings.length,
      qualityRequirements: analysis.counts?.qualityRequirements ?? analysis.qualityFindings.length,
    },
    source: {
      id: sourceFallback.id,
      name: source.displayName || sourceFallback.name,
      type: ({ 'google-doc': 'GOOGLE DOC', docx: 'DOCX', pdf: 'PDF' })[source.sourceType || sourceFallback.sourceType]
        || String(source.sourceType || sourceFallback.sourceType || '').toUpperCase(),
      sourceType: source.sourceType || sourceFallback.sourceType,
      sizeLabel: sourceFallback.sizeLabel || '',
      vpatVersion: source.vpatVersion,
      wcagVersion: Array.isArray(source.declaredWcagVersions) ? source.declaredWcagVersions.at(-1) : '',
      levels: Array.isArray(source.declaredLevels) ? [...source.declaredLevels] : [],
    },
    wcagItems: analysis.wcagFindings.map(finding => ({
      id: finding.criterionId,
      criterion: finding.sc,
      title: finding.title,
      authorConformance: finding.sourceConformance ?? 'Not provided',
      authorRemarks: finding.sourceRemarks ?? 'No author remarks were extracted.',
      assessmentSummary: finding.evidence,
      assessment: finding.status === 'Complete' ? finding.evidence : `Incomplete: ${finding.incompleteReason || 'additional evidence is required'}.`,
      reviewerAction: finding.reviewRequired ? 'Review the source response and analyzer evidence before relying on this finding.' : 'No additional review is indicated by this automated finding.',
      confidence: finding.confidence,
      needsReview: Boolean(finding.reviewRequired),
    })),
    qualityItems: analysis.qualityFindings.map((finding, index) => ({
      id: finding.requirementId,
      displayId: finding.aliases?.[0] || `Quality ${index + 1}`,
      title: finding.title,
      result: finding.result,
      evidenceLocation: 'Extracted VPAT 2.5 WCAG table content',
      exactEvidence: finding.evidence,
      evidenceSummary: finding.evidence,
      assessment: finding.status === 'Complete' ? `${finding.result}. ${finding.evidence}` : `Incomplete: ${finding.incompleteReason || 'additional evidence is required'}.`,
      reviewerAction: finding.guidance,
      needsReview: Boolean(finding.reviewRequired),
    })),
    sheet: {
      location: receipt.folderPath || receipt.location || 'My Drive/VPAT Analyzer Results',
      url: receipt.spreadsheetUrl || receipt.url || '',
      tabs: ['Overview', 'Line-item Review', 'Quality Requirements', 'Scoring', 'Methodology & disclaimer'],
    },
    methodology: {
      confidenceThreshold: scoringRules.confidenceThreshold,
      versions: { ...analysis.provenance },
    },
  };
}
