import rubric from '../../../config/quality-rubric.v1.json' with { type: 'json' };

const MAX_EVIDENCE_ITEMS = 16;
const MAX_VALUE_CHARACTERS = 4000;
const MAX_TOTAL_EVIDENCE_CHARACTERS = 20000;

function bounded(value, budget) {
  const normalized = String(value ?? '')
    .replace(/\b(?:https?|ftp):\/\/\S+|\bwww\.\S+|\bdata:[^\s]+/giu, '[link omitted]')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized || budget.remaining <= 0) return '';
  const next = normalized.slice(0, Math.min(MAX_VALUE_CHARACTERS, budget.remaining));
  budget.remaining -= next.length;
  return next;
}

function joined(values) {
  return values.map(value => String(value ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | ');
}

function evidenceItem(fieldId, value, budget) {
  const text = bounded(value, budget);
  return text ? { fieldId, value: text } : null;
}

function selectEvidence(requirementId, context, budget) {
  const { source, ingestion } = context;
  const rows = Array.isArray(ingestion?.rows) ? ingestion.rows : [];
  const coverage = ingestion?.coverage || {};
  const report = ingestion?.reportEvidence || {};
  const versions = joined(coverage.declaredWcagVersions || []);
  const levels = joined(coverage.declaredLevels || []);
  const missingCriteria = Array.isArray(coverage.missingCriterionIds) ? coverage.missingCriterionIds : [];
  const expectedCriteria = Array.isArray(coverage.expectedCriterionIds) ? coverage.expectedCriterionIds : [];
  const unansweredCriteria = rows.filter(row => !String(row.sourceConformance || '').trim()).map(row => row.criterionId);
  const missingRemarks = rows.filter(row => !String(row.sourceRemarks || '').trim()).map(row => row.criterionId);
  const conformanceTerms = [...new Set(rows.map(row => String(row.sourceConformance || '').trim()).filter(Boolean))];
  const coverageSummary = `${rows.length} extracted of ${expectedCriteria.length || rows.length} expected criteria; ${missingCriteria.length} missing`;
  const answerSummary = `${rows.length - unansweredCriteria.length} of ${rows.length} extracted criteria contain a conformance answer${unansweredCriteria.length ? `; unanswered: ${unansweredCriteria.join(', ')}` : '; unanswered: none'}`;
  const remarksSummary = `${rows.length - missingRemarks.length} of ${rows.length} extracted criteria contain remarks${missingRemarks.length ? `; missing remarks: ${missingRemarks.join(', ')}` : '; missing remarks: none'}`;
  const remarksSample = joined(rows.slice(0, 3).map(row => `${row.criterionId}: ${row.sourceRemarks}`));
  const candidates = [];
  const add = (fieldId, value) => candidates.push([fieldId, value]);

  if (['qr-e12', 'qr-e13', 'qr-bp04'].includes(requirementId)) {
    add('declared-wcag-versions', versions);
    add('declared-levels', levels);
  }
  if (['qr-e13', 'qr-e14', 'qr-bp24'].includes(requirementId)) add('criterion-coverage', coverageSummary);
  if (requirementId === 'qr-bp24') add('criterion-answer-coverage', answerSummary);
  if (requirementId === 'qr-e16') {
    add('conformance-terms-used', conformanceTerms.join(' | '));
    add('conformance-term-definitions', report.conformanceDefinitions);
  }
  if (requirementId === 'qr-e11') add('evaluation-methods', report.evaluationMethods);
  if (requirementId === 'qr-bp09') add('assistive-technology-testing', report.assistiveTechnologyTesting);
  if (requirementId === 'qr-bp10') add('manual-testing', report.manualTesting);
  if (requirementId === 'qr-bp11') add('automated-testing', report.automatedTesting);
  if (requirementId === 'qr-e09') add('contact-information', report.contactInformation);
  if (requirementId === 'qr-bp07') add('tester-familiarity', report.testerFamiliarity);
  if (requirementId === 'qr-e08') {
    add('product-description', report.productDescription);
    add('source-display-name', source?.name);
    add('source-type', source?.sourceType || ingestion?.sourceType);
  }
  if (requirementId === 'qr-bp04') add('scope-notes', report.scopeNotes);
  if (requirementId === 'qr-e19') {
    add('remarks-coverage', remarksSummary);
    add('remarks-sample', remarksSample);
  }
  if (requirementId === 'qr-e04') add('vpat-template-version', report.templateVersion);
  if (requirementId === 'qr-e06') add('report-date', report.reportDate);

  return candidates
    .slice(0, MAX_EVIDENCE_ITEMS)
    .map(([fieldId, value]) => evidenceItem(fieldId, value, budget))
    .filter(Boolean);
}

export function buildQualityEvidence({ source, ingestion }) {
  if (!ingestion || ingestion.status !== 'complete') throw new Error('Complete deterministic ingestion is required for quality evidence.');
  const budget = { remaining: MAX_TOTAL_EVIDENCE_CHARACTERS };
  return rubric.requirements.map(requirement => ({
    requirementId: requirement.id,
    aliases: [...requirement.aliases],
    title: requirement.title,
    type: requirement.type,
    impact: { weight: requirement.impact.weight, label: requirement.impact.label },
    description: requirement.description,
    guidance: requirement.guidance,
    evidence: selectEvidence(requirement.id, { source, ingestion }, budget),
  }));
}
