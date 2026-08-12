import { performBrowserIngestion } from './browser-ingestion.mjs';
import { assertClientBridge } from './client-contract.mjs';
import { finalizeProductionAnalysis, mapProductionCompletedResult } from './finalize-analysis.mjs';
import { buildQualityEvidence } from './quality-evidence.mjs';

export { assertClientBridge } from './client-contract.mjs';

function readableSize(size) {
  if (size == null || size === '') return '';
  if (!Number.isFinite(Number(size)) || Number(size) < 0) return '';
  const bytes = Number(size);
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

function normalizeSource(source) {
  if (!source || typeof source !== 'object') return source;
  const displayTypes = { 'google-doc': 'GOOGLE DOC', docx: 'DOCX', pdf: 'PDF' };
  const normalizedType = source.sourceType || source.type;
  const sizeLabel = source.sizeLabel || readableSize(source.size);
  return {
    ...source,
    type: displayTypes[normalizedType] || source.type || 'FILE',
    sizeLabel: normalizedType === 'google-doc' && sizeLabel === 'Google Doc' ? '' : sizeLabel,
  };
}

function invokeRunner(runner, method, payload) {
  return new Promise((resolve, reject) => {
    let chain;
    try {
      chain = runner
        .withSuccessHandler(resolve)
        .withFailureHandler(error => reject(error instanceof Error ? error : new Error(String(error))));
      if (typeof chain[method] !== 'function') {
        reject(new Error(`Apps Script endpoint ${method} is not available.`));
        return;
      }
      chain[method](payload);
    } catch (error) {
      reject(error);
    }
  });
}

function unwrapRpcResponse(response) {
  if (typeof response === 'string') {
    try {
      response = JSON.parse(response);
    } catch {
      throw new Error('The server returned an invalid response.');
    }
  }
  if (response?.ok === false) {
    const detail = response.error || {};
    const error = new Error(detail.safeMessage || detail.message || 'The request could not be completed.');
    error.code = detail.code;
    error.kind = detail.kind;
    error.retryable = detail.retryable;
    error.safeMessage = detail.safeMessage;
    throw error;
  }
  if (response && Object.hasOwn(response, 'data')) return response.data;
  if (response && Object.hasOwn(response, 'result')) return response.result;
  return response;
}

/**
 * Adapts google.script.run's callback API to the small Promise-based client
 * contract. The server owns request/event persistence. Returned stage events
 * are accepted only when they carry the active stable request ID.
 */
export function createGoogleScriptBridge(options = {}) {
  const runner = options.runner || globalThis.google?.script?.run;
  if (!runner) throw new Error('google.script.run is not available.');

  const rpcMethod = options.rpcMethod || 'rpcCommand';
  const commands = {
    resumeActive: 'resumeActive',
    listDriveFiles: 'listSources',
    validateSource: 'inspectSource',
    beginAnalysis: 'beginAnalysis',
    advanceAnalysis: 'advanceAnalysis',
    retryExport: 'retryExport',
    ...(options.commands || {}),
  };
  const finalizeAnalysis = typeof options.finalizeAnalysis === 'function'
    ? options.finalizeAnalysis
    : finalizeProductionAnalysis;
  const ingestSource = typeof options.performIngestion === 'function'
    ? options.performIngestion
    : performBrowserIngestion;
  const pipelineByRequestId = new Map();

  async function rpc(command, payload) {
    const envelope = {
      schemaVersion: '1.0.0',
      command,
      payload,
    };
    return unwrapRpcResponse(await invokeRunner(runner, rpcMethod, JSON.stringify(envelope)));
  }

  async function completeClientAction(action, context) {
    if (!action || action.type !== 'INGEST_SOURCE') {
      throw new Error('The server requested an unsupported client action.');
    }
    const source = action.source || context.source;
    const ingested = await ingestSource({
      requestId: context.requestId,
      source,
      rpc,
    });
    return {
      type: 'INGESTION_RESULT',
      result: ingested.result,
      sourceSha256: ingested.sourceSha256,
    };
  }

  return assertClientBridge({
    resumeActive() {
      return rpc(commands.resumeActive, {}).then(response => {
        if (!response || response.status === 'ready') return { status: 'ready' };
        const normalized = {
          ...response,
          source: response.source ? normalizeSource(response.source) : response.source,
        };
        if (response.result) normalized.result = mapProductionCompletedResult(response.result, normalized.source || {});
        return normalized;
      });
    },

    listDriveFiles({ query = '' } = {}) {
      return rpc(commands.listDriveFiles, { query: String(query) }).then(response => {
        const files = response?.files || response?.sources || response || [];
        return Array.isArray(files) ? files.map(normalizeSource) : [];
      });
    },

    async validateSource({ requestId, source }) {
      const response = await rpc(commands.validateSource, {
        requestId,
        fileId: source.id,
      });
      if (response?.status) {
        return { ...response, source: response.source ? normalizeSource(response.source) : response.source };
      }
      return { requestId, status: 'selected', source: normalizeSource(response) };
    },

    async startAnalysis({ requestId, source, onEvent }) {
      const pipeline = pipelineByRequestId.get(requestId) || {
        ingestion: null,
        conformanceResponse: null,
        qualityResponse: null,
      };
      pipelineByRequestId.set(requestId, pipeline);
      const emit = typeof onEvent === 'function' ? onEvent : () => {};
      try {
        let response = await rpc(commands.beginAnalysis, {
          requestId,
          fileId: source.id,
        });
        while (response?.status === 'pending') {
          if (response.event) emit(response.event);
          if (response.stageData?.ingestionResult) pipeline.ingestion = response.stageData.ingestionResult;
          if (response.stageData?.conformanceResponse) pipeline.conformanceResponse = response.stageData.conformanceResponse;
          if (response.stageData?.qualityResponse) pipeline.qualityResponse = response.stageData.qualityResponse;
          let clientResult;
          if (response.action) {
            clientResult = await completeClientAction(response.action, { requestId, source });
            pipeline.ingestion = clientResult.result;
          } else if (response.cursor === 3) {
            clientResult = {
              type: 'QUALITY_EVIDENCE',
              expectedRequirements: buildQualityEvidence({
                source,
                ingestion: pipeline.ingestion,
              }),
            };
          } else if (response.cursor === 4 && finalizeAnalysis) {
            const finalized = await finalizeAnalysis({
              requestId,
              source,
              ingestion: pipeline.ingestion,
              conformanceResponse: pipeline.conformanceResponse,
              qualityResponse: pipeline.qualityResponse,
            });
            clientResult = {
              type: 'FINAL_ANALYSIS',
              ...finalized,
            };
          }
          response = await rpc(commands.advanceAnalysis, {
            requestId,
            cursor: response.cursor,
            ...(clientResult ? { clientResult } : {}),
          });
        }
        if (response?.event) emit(response.event);
        const outcome = response?.outcome || response;
        if (outcome?.status !== 'pending' && !(outcome?.status === 'error' && outcome?.retryable)) {
          pipelineByRequestId.delete(requestId);
        }
        if (outcome?.result) return { ...outcome, result: mapProductionCompletedResult(outcome.result, source) };
        return outcome;
      } catch (error) {
        if (error?.retryable === false) pipelineByRequestId.delete(requestId);
        throw error;
      }
    },

    retryExport({ requestId, analysisId, source }) {
      return rpc(commands.retryExport, { requestId, analysisId }).then(response => (
        response?.result ? { ...response, result: mapProductionCompletedResult(response.result, source) } : response
      ));
    },
  });
}
