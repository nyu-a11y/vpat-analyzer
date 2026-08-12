import { EXPORT_TAB_NAMES, ServerContractError, requireRequestId } from './server-contracts.mjs';
import { canonicalJson } from './property-record-store.mjs';

export const TRUSTED_FORMULA_ALLOWLIST = Object.freeze({
  'formula-score-earned-v1': '=SUMIF(\'Quality Requirements\'!G:G,"Pass",\'Quality Requirements\'!E:E)',
  'formula-score-percentage-v1': '=IFERROR(ROUND(B2/B3*100),"")'
});

export function validateExportModelShape(model) {
  if (!model || typeof model !== 'object' || model.schemaVersion !== '1.0.0') {
    throw new ServerContractError('EXPORT_MODEL_INVALID');
  }
  requireRequestId(model.requestId);
  if (model.outputFolder !== 'My Drive/VPAT Analyzer Results' || !Array.isArray(model.tabs) || model.tabs.length !== 5) {
    throw new ServerContractError('EXPORT_MODEL_INVALID');
  }
  model.tabs.forEach((tab, index) => {
    if (!tab || tab.name !== EXPORT_TAB_NAMES[index] || tab.order !== index + 1 || !Array.isArray(tab.sections)) {
      throw new ServerContractError('EXPORT_MODEL_INVALID');
    }
    for (const section of tab.sections) {
      if (!section || typeof section.heading !== 'string' || !Array.isArray(section.columns) || !Array.isArray(section.rows)) {
        throw new ServerContractError('EXPORT_MODEL_INVALID');
      }
      for (const row of section.rows) {
        if (!row || !Array.isArray(row.cells)) throw new ServerContractError('EXPORT_MODEL_INVALID');
        for (const cell of row.cells) {
          if (cell?.kind === 'literal') {
            if (!['string', 'number', 'boolean'].includes(typeof cell.value) && cell.value !== null) {
              throw new ServerContractError('EXPORT_MODEL_INVALID');
            }
          } else if (cell?.kind === 'trusted-template-formula-reference') {
            if (!Object.prototype.hasOwnProperty.call(TRUSTED_FORMULA_ALLOWLIST, cell.templateFormulaId)) {
              throw new ServerContractError('EXPORT_MODEL_INVALID');
            }
          } else {
            throw new ServerContractError('EXPORT_MODEL_INVALID');
          }
        }
      }
    }
  });
  return model;
}

export function renderTabRawValues(tab) {
  const values = [];
  for (const section of tab.sections) {
    values.push([section.heading]);
    values.push(section.columns.slice());
    for (const row of section.rows) {
      const byColumn = new Map(row.cells.map((cell) => [cell.columnId, cell]));
      values.push(section.columns.map((columnId) => {
        const cell = byColumn.get(columnId);
        if (!cell) return '';
        if (cell.kind === 'literal') return cell.value === null ? '' : cell.value;
        return TRUSTED_FORMULA_ALLOWLIST[cell.templateFormulaId];
      }));
    }
    values.push([]);
  }
  return values;
}

export function analysisDigest(analysisOutput, digestText) {
  return digestText(JSON.stringify(canonicalJson(analysisOutput)));
}

export class ExactlyOnceExportCoordinator {
  constructor({ records, lock, clock, ids, artifactPort, digestText, rebuildExportModel }) {
    this.records = records;
    this.lock = lock;
    this.clock = clock;
    this.ids = ids;
    this.artifactPort = artifactPort;
    this.digestText = digestText;
    this.rebuildExportModel = rebuildExportModel;
  }

  storeImmutable(requestId, analysisOutput, exportModel) {
    requireRequestId(requestId);
    validateExportModelShape(exportModel);
    if (exportModel.requestId !== requestId) throw new ServerContractError('EXPORT_MODEL_INVALID');
    if (typeof this.rebuildExportModel !== 'function') throw new ServerContractError('INTERNAL_ERROR');
    const expectedExportModel = validateExportModelShape(this.rebuildExportModel(analysisOutput));
    if (JSON.stringify(canonicalJson(exportModel)) !== JSON.stringify(canonicalJson(expectedExportModel))) {
      throw new ServerContractError('EXPORT_MODEL_INVALID');
    }
    const next = { requestId, analysisOutput };
    const digest = analysisDigest(next, this.digestText);
    return this.lock.run(() => {
      const existing = this.records.get('analysis', requestId);
      if (existing) {
        const existingDigest = analysisDigest(existing.value, this.digestText);
        if (existingDigest !== digest) throw new ServerContractError('ANALYSIS_IMMUTABLE');
        return { requestId, analysisDigest: digest, stored: false };
      }
      this.records.put('analysis', requestId, next);
      return { requestId, analysisDigest: digest, stored: true };
    });
  }

  exportStored(requestId) {
    requireRequestId(requestId);
    const prepared = this.lock.run(() => {
      const receiptRecord = this.records.get('receipt', requestId);
      if (receiptRecord) return { receipt: receiptRecord.value };
      const analysis = this.records.get('analysis', requestId);
      if (!analysis) throw new ServerContractError('REQUEST_NOT_FOUND');
      const digest = analysisDigest(analysis.value, this.digestText);
      const exportModel = validateExportModelShape(this.rebuildExportModel(analysis.value.analysisOutput));
      let claimRecord = this.records.get('export-claim', requestId);
      let claim = claimRecord?.value;
      if (claim && (claim.requestId !== requestId || claim.analysisDigest !== digest)) {
        throw new ServerContractError('ANALYSIS_IMMUTABLE');
      }
      if (!claim) {
        claim = {
          schemaVersion: '1.0.0', requestId, analysisDigest: digest,
          token: this.ids(), status: 'claimed', claimedAt: this.clock(),
          createAttemptedAt: null, artifactId: null
        };
        this.records.put('export-claim', requestId, claim);
      }
      return { analysis: analysis.value, exportModel, claim };
    });
    if (prepared.receipt) return prepared.receipt;

    let { claim } = prepared;
    let artifactId = claim.artifactId;
    if (!artifactId) {
      const matches = this.artifactPort.findByClaimToken(claim.token);
      if (matches.length > 1) throw new ServerContractError('EXPORT_COMPLETION_AMBIGUOUS', { retryable: true });
      if (matches.length === 1) {
        artifactId = matches[0];
      } else if (claim.createAttemptedAt) {
        throw new ServerContractError('EXPORT_COMPLETION_AMBIGUOUS', { retryable: true });
      } else {
        const attempt = this.lock.run(() => {
          const fresh = this.records.get('export-claim', requestId)?.value;
          if (!fresh || fresh.token !== claim.token) throw new ServerContractError('EXPORT_COMPLETION_AMBIGUOUS', { retryable: true });
          if (fresh.createAttemptedAt) return { claim: fresh, mayCreate: false };
          const attempted = { ...fresh, createAttemptedAt: this.clock() };
          this.records.put('export-claim', requestId, attempted);
          return { claim: attempted, mayCreate: true };
        });
        claim = attempt.claim;
        if (claim.artifactId) artifactId = claim.artifactId;
        else if (attempt.mayCreate) {
          artifactId = this.artifactPort.create({
            requestId,
            claimToken: claim.token,
            exportModel: prepared.exportModel
          });
        } else {
          throw new ServerContractError('EXPORT_COMPLETION_AMBIGUOUS', { retryable: true });
        }
      }
    }

    this.lock.run(() => {
      const fresh = this.records.get('export-claim', requestId)?.value;
      if (!fresh || fresh.token !== claim.token) throw new ServerContractError('EXPORT_COMPLETION_AMBIGUOUS', { retryable: true });
      if (fresh.artifactId && fresh.artifactId !== artifactId) throw new ServerContractError('EXPORT_COMPLETION_AMBIGUOUS', { retryable: true });
      this.records.put('export-claim', requestId, { ...fresh, artifactId, status: 'created' });
    });

    this.artifactPort.write(artifactId, prepared.exportModel);
    const receipt = {
      schemaVersion: '1.0.0',
      requestId,
      spreadsheetId: artifactId,
      spreadsheetUrl: this.artifactPort.urlFor(artifactId),
      completedAt: this.clock(),
      templateVersion: prepared.exportModel.provenance?.templateVersion || '1.0.0'
    };
    return this.lock.run(() => {
      const existing = this.records.get('receipt', requestId);
      if (existing) return existing.value;
      this.records.put('receipt', requestId, receipt);
      this.records.put('export-claim', requestId, { ...claim, artifactId, status: 'final' });
      return receipt;
    });
  }
}
