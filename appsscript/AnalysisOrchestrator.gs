var VPAT_STAGE_STATES_ = Object.freeze([
  'preparing_source',
  'extracting_wcag_tables',
  'checking_coverage',
  'analyzing_report_quality',
  'preparing_results'
]);
var VPAT_RETRY_LIMITS_ = Object.freeze({
  source: 2,
  ingestion: 2,
  conformance: 3,
  quality: 3,
  export: 3
});
var VPAT_IN_FLIGHT_STALE_MS_ = 10 * 60 * 1000;

function vpatZeroAttempts_() {
  return { source: 0, ingestion: 0, conformance: 0, quality: 0, export: 0 };
}

function vpatCreateRequestForSource_(fileId, requestedId) {
  var requestId = requestedId
    ? vpatRequireRequestId_(requestedId)
    : 'req-' + Utilities.getUuid();
  var now = new Date().toISOString();
  var metadata;
  try {
    metadata = vpatReadSourceMetadata_(fileId);
  } catch (error) {
    var rejectionKind = error && (error.vpatCode === 'SOURCE_UNSUPPORTED' || error.vpatCode === 'SOURCE_TOO_LARGE')
      ? 'unsupported'
      : 'inaccessible';
    var rejected = {
      schemaVersion: '1.0.0', requestId: requestId, sourceRef: String(fileId || ''),
      source: null, status: 'source_rejected', cursor: -1, sequence: 0,
      attempts: vpatZeroAttempts_(), failedCursor: null,
      inFlight: null, lastResponse: null, createdAt: now, updatedAt: now
    };
    vpatWithUserLock_(function () {
      vpatPrepareActiveRequestReplacement_(requestId);
      vpatPutUserRecord_('request', requestId, rejected);
      PropertiesService.getUserProperties().setProperty('vpat:active-request-id', requestId);
    });
    return {
      requestId: requestId,
      status: 'rejected',
      kind: rejectionKind,
      detail: VPAT_SAFE_ERRORS_[error && error.vpatCode] || VPAT_SAFE_ERRORS_.SOURCE_INACCESSIBLE
    };
  }
  var record = {
    schemaVersion: '1.0.0',
    requestId: requestId,
    sourceRef: metadata.id,
    source: metadata,
    status: 'selected',
    cursor: -1,
    sequence: 0,
    attempts: vpatZeroAttempts_(),
    failedCursor: null,
    inFlight: null,
    lastResponse: null,
    createdAt: now,
    updatedAt: now
  };
  vpatWithUserLock_(function () {
    vpatPrepareActiveRequestReplacement_(requestId);
    vpatPutUserRecord_('request', requestId, record);
    PropertiesService.getUserProperties().setProperty('vpat:active-request-id', requestId);
  });
  return {
    requestId: requestId,
    status: 'selected',
    source: vpatClientSourceDescriptor_(metadata)
  };
}

function vpatClientSourceDescriptor_(metadata) {
  return {
    id: metadata.id,
    name: metadata.name,
    type: metadata.sourceType,
    sourceType: metadata.sourceType,
    size: metadata.size,
    sizeLabel: metadata.size === null ? 'Google Doc' : vpatHumanFileSize_(metadata.size),
    vpatVersion: null,
    wcagVersion: null,
    levels: []
  };
}

function vpatHumanFileSize_(size) {
  if (!Number.isFinite(size) || size < 0) return '';
  if (size < 1024) return size + ' B';
  if (size < 1024 * 1024) return (size / 1024).toFixed(size < 10 * 1024 ? 1 : 0) + ' KB';
  return (size / (1024 * 1024)).toFixed(1) + ' MB';
}

function vpatBeginAnalysis_(requestId) {
  requestId = vpatRequireRequestId_(requestId);
  return vpatWithUserLock_(function () {
    vpatRequireActiveRequest_(requestId);
    var requestRecord = vpatGetUserRecord_('request', requestId);
    vpatRequire_(Boolean(requestRecord), 'REQUEST_NOT_FOUND');
    var record = requestRecord.value;
    if (record.status === 'pending' && record.lastResponse) return vpatPendingResponseForRecord_(record);
    if (record.status === 'retryable-error' && Number.isInteger(record.failedCursor)) {
      return vpatRetryAnalysisFromFailureLocked_(record);
    }
    vpatRequire_(record.status === 'selected', 'INVALID_REQUEST');
    var response = Object.assign(vpatStageResponse_(requestId, 0), {
      action: {
        type: 'INGEST_SOURCE',
        source: {
          id: record.source.id,
          sourceType: record.source.sourceType,
          mimeType: record.source.mimeType
        },
        transport: record.source.sourceType === 'google-doc'
          ? { command: 'serializeGoogleDoc' }
          : {
            beginCommand: 'beginSourceBytes',
            readCommand: 'readSourceByteBatch',
            chunkBytes: VPAT_SOURCE_CHUNK_BYTES_,
            maxChunksPerBatch: VPAT_MAX_CHUNK_BATCH_
          }
      }
    });
    var attempts = Object.assign(vpatZeroAttempts_(), record.attempts || {});
    attempts.source += 1;
    vpatPutUserRecord_('request', requestId, Object.assign({}, record, {
      status: 'pending', cursor: 0, sequence: record.sequence + 1,
      attempts: attempts,
      lastResponse: response, updatedAt: new Date().toISOString()
    }));
    return response;
  });
}

function vpatAdvanceAnalysis_(payload) {
  var requestId = vpatRequireRequestId_(payload.requestId);
  var cursor = Number(payload.cursor);
  vpatRequire_(Number.isInteger(cursor) && cursor >= 0 && cursor <= 4, 'INVALID_REQUEST');
  var claim = vpatClaimAdvance_(requestId, cursor);
  if (!claim.execute) return claim.response;
  try {
    var outcome = vpatExecuteAnalysisStep_(claim.record, cursor, payload);
    var completedResponse = vpatCompleteAdvance_(requestId, cursor, claim.token, outcome);
    if (outcome.cleanupTransient) {
      try { vpatDeleteTransientAnalysisRecords_(requestId); } catch (ignored) {
        // A later source selection will retry bounded transient cleanup.
      }
    }
    return completedResponse;
  } catch (error) {
    if (
      (cursor === 2 || cursor === 3) && error &&
      ['PROVIDER_ERROR', 'PROVIDER_RESPONSE_INVALID', 'PROVIDER_NOT_CONFIGURED'].indexOf(error.vpatCode) >= 0
    ) {
      return vpatRecordRetryableFailure_(requestId, cursor, claim.token, error);
    }
    vpatReleaseAdvanceClaim_(requestId, cursor, claim.token);
    throw error;
  }
}

function vpatClaimAdvance_(requestId, cursor) {
  return vpatWithUserLock_(function () {
    if (!vpatIsActiveRequest_(requestId)) {
      return { execute: false, response: { requestId: requestId, status: 'stale' } };
    }
    var requestRecord = vpatGetUserRecord_('request', requestId);
    vpatRequire_(Boolean(requestRecord), 'REQUEST_NOT_FOUND');
    var record = requestRecord.value;
    if (record.status === 'complete' || record.status === 'export-error' || record.status === 'error') {
      return { execute: false, response: vpatTerminalResponseForRecord_(record) };
    }
    vpatRequire_(record.status === 'pending', 'INVALID_REQUEST');
    if (cursor < record.cursor) return { execute: false, response: vpatPendingResponseForRecord_(record) };
    vpatRequire_(cursor === record.cursor, 'INVALID_REQUEST');
    if (record.inFlight) {
      var claimedAt = new Date(record.inFlight.claimedAt).getTime();
      var staleClaim = Number.isFinite(claimedAt) && Date.now() - claimedAt >= VPAT_IN_FLIGHT_STALE_MS_;
      if (staleClaim) {
        record = Object.assign({}, record, { inFlight: null });
      } else {
        return {
          execute: false,
          response: {
            requestId: requestId,
            status: 'error',
            retryable: true,
            detail: VPAT_SAFE_ERRORS_.REQUEST_IN_PROGRESS
          }
        };
      }
    }
    var operation = vpatOperationForCursor_(cursor);
    var durableOutputKind = vpatDurableOutputKindForCursor_(cursor);
    var durableOutputExists = durableOutputKind
      ? Boolean(vpatGetUserRecord_(durableOutputKind, requestId))
      : false;
    var attempts = Object.assign(vpatZeroAttempts_(), record.attempts || {});
    if (operation && !durableOutputExists) {
      vpatRequire_(attempts[operation] < VPAT_RETRY_LIMITS_[operation],
        operation === 'export' ? 'EXPORT_FAILED' : 'PROVIDER_ERROR');
      attempts[operation] += 1;
    }
    var token = Utilities.getUuid();
    var claimed = Object.assign({}, record, {
      attempts: attempts,
      inFlight: { cursor: cursor, token: token, claimedAt: new Date().toISOString() },
      updatedAt: new Date().toISOString()
    });
    vpatPutUserRecord_('request', requestId, claimed);
    return { execute: true, token: token, record: claimed };
  });
}

function vpatRetryAnalysisFromFailureLocked_(record) {
  var cursor = record.failedCursor;
  var operation = vpatOperationForCursor_(cursor);
  vpatRequire_(operation === 'conformance' || operation === 'quality', 'INVALID_REQUEST');
  var attempts = Object.assign(vpatZeroAttempts_(), record.attempts || {});
  vpatRequire_(attempts[operation] < VPAT_RETRY_LIMITS_[operation], 'PROVIDER_ERROR');
  var response = vpatStageResponse_(record.requestId, cursor);
  var ingestion = vpatGetUserRecord_('ingestion', record.requestId);
  if (ingestion) response.stageData = { ingestionResult: ingestion.value };
  if (cursor === 3) {
    var conformance = vpatGetUserRecord_('conformance', record.requestId);
    vpatRequire_(Boolean(conformance), 'REQUEST_NOT_FOUND');
    response.stageData.conformanceResponse = conformance.value;
  }
  vpatPutUserRecord_('request', record.requestId, Object.assign({}, record, {
    status: 'pending', attempts: attempts, failedCursor: null,
    sequence: record.sequence + 1, lastResponse: response,
    updatedAt: new Date().toISOString()
  }));
  return response;
}

function vpatRecordRetryableFailure_(requestId, cursor, token, error) {
  return vpatWithUserLock_(function () {
    vpatRequireActiveRequest_(requestId);
    var requestRecord = vpatGetUserRecord_('request', requestId);
    vpatRequire_(Boolean(requestRecord), 'REQUEST_NOT_FOUND');
    var record = requestRecord.value;
    vpatRequire_(record.cursor === cursor && record.inFlight && record.inFlight.token === token, 'INVALID_REQUEST');
    var operation = vpatOperationForCursor_(cursor);
    var attempts = Object.assign(vpatZeroAttempts_(), record.attempts || {});
    var canRetry = Boolean(error && error.vpatRetryable) && attempts[operation] < VPAT_RETRY_LIMITS_[operation];
    var detail = canRetry
      ? VPAT_SAFE_ERRORS_[error.vpatCode]
      : error && error.vpatRetryable
        ? 'The analysis retry limit was reached.'
        : VPAT_SAFE_ERRORS_[error && error.vpatCode] || VPAT_SAFE_ERRORS_.PROVIDER_ERROR;
    var response = {
      requestId: requestId,
      status: 'error',
      retryable: canRetry,
      detail: detail
    };
    vpatPutUserRecord_('request', requestId, Object.assign({}, record, {
      status: canRetry ? 'retryable-error' : 'error',
      failedCursor: canRetry ? cursor : null,
      inFlight: null,
      lastResponse: response,
      updatedAt: new Date().toISOString()
    }));
    return response;
  });
}

function vpatOperationForCursor_(cursor) {
  if (cursor === 0) return 'ingestion';
  if (cursor === 1) return null;
  if (cursor === 2) return 'conformance';
  if (cursor === 3) return 'quality';
  if (cursor === 4) return 'export';
  vpatThrow_('INVALID_REQUEST');
}

function vpatDurableOutputKindForCursor_(cursor) {
  if (cursor === 0) return 'ingestion';
  if (cursor === 2) return 'conformance';
  if (cursor === 3) return 'quality';
  if (cursor === 4) return 'receipt';
  return null;
}

function vpatExecuteAnalysisStep_(record, cursor, payload) {
  var requestId = record.requestId;
  if (cursor === 0) {
    var clientResult = payload.clientResult;
    vpatRequire_(
      clientResult && clientResult.type === 'INGESTION_RESULT' &&
      typeof clientResult.sourceSha256 === 'string' && /^[a-f0-9]{64}$/.test(clientResult.sourceSha256),
      'INVALID_REQUEST'
    );
    var sourceBinding = vpatGetUserRecord_('source', requestId);
    vpatRequire_(
      sourceBinding && sourceBinding.value.metadata &&
      sourceBinding.value.metadata.id === record.source.id &&
      sourceBinding.value.metadata.sourceType === record.source.sourceType &&
      sourceBinding.value.metadata.updatedAt === record.source.updatedAt,
      'SOURCE_CHANGED'
    );
    vpatRequire_(sourceBinding.value.sha256 === clientResult.sourceSha256, 'SOURCE_CHANGED');
    var ingestion = vpatValidateSubmittedIngestion_(clientResult.result, record);
    if (ingestion.status === 'rejected') {
      var kind = ingestion.rejection.code === 'PDF_NON_SEARCHABLE' || ingestion.rejection.code === 'PDF_INSUFFICIENT_TEXT'
        ? 'non-searchable-pdf'
        : 'no-wcag-tables';
      return {
        response: {
          requestId: requestId, status: 'error', retryable: false,
          kind: kind, detail: ingestion.rejection.safeMessage
        },
        status: 'error', nextCursor: cursor
      };
    }
    var existingIngestion = vpatGetUserRecord_('ingestion', requestId);
    if (existingIngestion) {
      vpatRequire_(
        JSON.stringify(vpatCanonicalJsonValue_(existingIngestion.value)) ===
          JSON.stringify(vpatCanonicalJsonValue_(ingestion)),
        'INVALID_REQUEST'
      );
    } else {
      vpatPutUserRecord_('ingestion', requestId, ingestion);
    }
    return { response: vpatStageResponse_(requestId, 1), status: 'pending', nextCursor: 1 };
  }
  if (cursor === 1) {
    var ingestionRecord = vpatGetUserRecord_('ingestion', requestId);
    vpatRequire_(Boolean(ingestionRecord), 'REQUEST_NOT_FOUND');
    var ingestionValue = ingestionRecord.value;
    vpatValidateCoverage_(ingestionValue);
    return { response: vpatStageResponse_(requestId, 2), status: 'pending', nextCursor: 2 };
  }
  if (cursor === 2) {
    var conformanceIngestionRecord = vpatGetUserRecord_('ingestion', requestId);
    vpatRequire_(Boolean(conformanceIngestionRecord), 'REQUEST_NOT_FOUND');
    var conformanceIngestion = conformanceIngestionRecord.value;
    var conformanceInput = {
      requestId: requestId,
      promptVersion: '1.0.0',
      contractVersions: { catalogVersion: '1.0.0', rubricVersion: '1.0.0', schemaVersion: '1.0.0' },
      expectedCriteria: conformanceIngestion.coverage.expectedCriterionIds.map(function (criterionId) {
        var matchingRows = conformanceIngestion.rows.filter(function (row) { return row.criterionId === criterionId; });
        vpatRequire_(matchingRows.length <= 1, 'INVALID_REQUEST');
        var row = matchingRows[0] || null;
        var criterion = vpatCatalogCriterion_(criterionId);
        return {
          criterionId: criterionId,
          sc: criterionId.slice('wcag-sc-'.length),
          title: criterion.title,
          level: criterion.level,
          sourceCriterionLabel: row ? row.sourceCriterionLabel : '',
          sourceConformance: row ? row.sourceConformance : '',
          sourceRemarks: row ? row.sourceRemarks : ''
        };
      })
    };
    var existingConformance = vpatGetUserRecord_('conformance', requestId);
    var conformance;
    if (existingConformance) {
      conformance = existingConformance.value;
      vpatValidateProviderResponseEnvelope_(
        'conformance',
        vpatMinimizeProviderPayload_('conformance', conformanceInput),
        conformance
      );
    } else {
      conformance = vpatAnalyzeWithProvider_('conformance', conformanceInput);
      vpatPutUserRecord_('conformance', requestId, conformance);
    }
    return {
      response: Object.assign(vpatStageResponse_(requestId, 3), { stageData: { conformanceResponse: conformance } }),
      status: 'pending', nextCursor: 3
    };
  }
  if (cursor === 3) {
    var qualityClientResult = payload.clientResult;
    vpatRequire_(qualityClientResult && qualityClientResult.type === 'QUALITY_EVIDENCE', 'INVALID_REQUEST');
    var qualityIngestionRecord = vpatGetUserRecord_('ingestion', requestId);
    vpatRequire_(Boolean(qualityIngestionRecord), 'REQUEST_NOT_FOUND');
    var expectedRequirements = vpatBuildExpectedQualityEvidence_(record, qualityIngestionRecord.value);
    vpatRequire_(
      JSON.stringify(vpatCanonicalJsonValue_(qualityClientResult.expectedRequirements)) ===
        JSON.stringify(vpatCanonicalJsonValue_(expectedRequirements)),
      'INVALID_REQUEST'
    );
    var qualityInput = {
      requestId: requestId,
      promptVersion: '1.0.0',
      contractVersions: { catalogVersion: '1.0.0', rubricVersion: '1.0.0', schemaVersion: '1.0.0' },
      expectedRequirements: expectedRequirements
    };
    var existingQuality = vpatGetUserRecord_('quality', requestId);
    var quality;
    if (existingQuality) {
      quality = existingQuality.value;
      vpatValidateProviderResponseEnvelope_(
        'quality',
        vpatMinimizeProviderPayload_('quality', qualityInput),
        quality
      );
    } else {
      quality = vpatAnalyzeWithProvider_('quality', qualityInput);
      vpatPutUserRecord_('quality', requestId, quality);
    }
    var finalIngestion = vpatGetUserRecord_('ingestion', requestId);
    var finalConformance = vpatGetUserRecord_('conformance', requestId);
    vpatRequire_(Boolean(finalIngestion) && Boolean(finalConformance), 'REQUEST_NOT_FOUND');
    return {
      response: Object.assign(vpatStageResponse_(requestId, 4), {
        stageData: {
          ingestionResult: finalIngestion.value,
          conformanceResponse: finalConformance.value,
          qualityResponse: quality
        }
      }),
      status: 'pending', nextCursor: 4
    };
  }
  vpatRequire_(cursor === 4, 'INVALID_REQUEST');
  var finalClientResult = payload.clientResult;
  vpatRequire_(
    finalClientResult && finalClientResult.type === 'FINAL_ANALYSIS' &&
    finalClientResult.analysisOutput && finalClientResult.exportModel,
    'INVALID_REQUEST'
  );
  vpatStoreImmutableAnalysis_(requestId, finalClientResult.analysisOutput, finalClientResult.exportModel);
  try {
    var receipt = vpatExportStoredAnalysis_(requestId);
    return {
      response: {
        requestId: requestId,
        status: 'complete',
        result: vpatClientCompletedResult_(finalClientResult.analysisOutput, receipt)
      },
      status: 'complete', nextCursor: 5, cleanupTransient: true
    };
  } catch (error) {
    if (error && (error.vpatCode === 'EXPORT_FAILED' || error.vpatCode === 'EXPORT_COMPLETION_AMBIGUOUS')) {
      return {
        response: {
          requestId: requestId,
          status: 'export-error',
          result: vpatClientCompletedResult_(finalClientResult.analysisOutput, null),
          detail: VPAT_SAFE_ERRORS_[error.vpatCode]
        },
        status: 'export-error', nextCursor: 4, cleanupTransient: true
      };
    }
    throw error;
  }
}

function vpatCatalogCriterion_(criterionId) {
  vpatRequire_(
    typeof VPAT_WCAG_CATALOG_ === 'object' && VPAT_WCAG_CATALOG_ &&
    Array.isArray(VPAT_WCAG_CATALOG_.criteria) && VPAT_WCAG_CATALOG_.version === '1.0.0',
    'INTERNAL_ERROR'
  );
  var matches = VPAT_WCAG_CATALOG_.criteria.filter(function (criterion) {
    return criterion && criterion.id === criterionId;
  });
  vpatRequire_(
    matches.length === 1 && typeof matches[0].title === 'string' &&
    ['A', 'AA', 'AAA'].indexOf(matches[0].level) >= 0,
    'INVALID_REQUEST'
  );
  return matches[0];
}

function vpatBuildExpectedQualityEvidence_(record, ingestion) {
  vpatRequire_(
    typeof VPAT_QUALITY_RUBRIC_ === 'object' && VPAT_QUALITY_RUBRIC_ &&
    VPAT_QUALITY_RUBRIC_.version === '1.0.0' &&
    Array.isArray(VPAT_QUALITY_RUBRIC_.requirements) && VPAT_QUALITY_RUBRIC_.requirements.length === 16,
    'INTERNAL_ERROR'
  );
  var rows = ingestion.rows;
  var coverage = ingestion.coverage;
  var report = ingestion.reportEvidence || {};
  var missingCriteria = coverage.missingCriterionIds || [];
  var expectedCriteria = coverage.expectedCriterionIds || [];
  var unansweredCriteria = rows.filter(function (row) {
    return !vpatNormalizeEvidenceText_(row.sourceConformance);
  }).map(function (row) { return row.criterionId; });
  var missingRemarks = rows.filter(function (row) {
    return !vpatNormalizeEvidenceText_(row.sourceRemarks);
  }).map(function (row) { return row.criterionId; });
  var conformanceTerms = [];
  rows.forEach(function (row) {
    var term = vpatNormalizeEvidenceText_(row.sourceConformance);
    if (term && conformanceTerms.indexOf(term) < 0) conformanceTerms.push(term);
  });
  var values = {
    'source-display-name': record.source.name,
    'source-type': record.source.sourceType,
    'declared-wcag-versions': vpatJoinEvidenceValues_(coverage.declaredWcagVersions),
    'declared-levels': vpatJoinEvidenceValues_(coverage.declaredLevels),
    'criterion-coverage': rows.length + ' extracted of ' + (expectedCriteria.length || rows.length) +
      ' expected criteria; ' + missingCriteria.length + ' missing',
    'criterion-answer-coverage': (rows.length - unansweredCriteria.length) + ' of ' + rows.length +
      ' extracted criteria contain a conformance answer' +
      (unansweredCriteria.length ? '; unanswered: ' + unansweredCriteria.join(', ') : '; unanswered: none'),
    'conformance-terms-used': conformanceTerms.join(' | '),
    'conformance-term-definitions': report.conformanceDefinitions || '',
    'evaluation-methods': report.evaluationMethods || '',
    'assistive-technology-testing': report.assistiveTechnologyTesting || '',
    'manual-testing': report.manualTesting || '',
    'automated-testing': report.automatedTesting || '',
    'contact-information': report.contactInformation || '',
    'tester-familiarity': report.testerFamiliarity || '',
    'product-description': report.productDescription || '',
    'scope-notes': report.scopeNotes || '',
    'remarks-coverage': (rows.length - missingRemarks.length) + ' of ' + rows.length +
      ' extracted criteria contain remarks' +
      (missingRemarks.length ? '; missing remarks: ' + missingRemarks.join(', ') : '; missing remarks: none'),
    'remarks-sample': vpatJoinEvidenceValues_(rows.slice(0, 3).map(function (row) {
      return row.criterionId + ': ' + row.sourceRemarks;
    })),
    'vpat-template-version': report.templateVersion || '',
    'report-date': report.reportDate || ''
  };
  var evidenceFields = {
    'qr-e12': ['declared-wcag-versions', 'declared-levels'],
    'qr-e13': ['declared-wcag-versions', 'declared-levels', 'criterion-coverage'],
    'qr-e14': ['criterion-coverage'],
    'qr-e16': ['conformance-terms-used', 'conformance-term-definitions'],
    'qr-bp24': ['criterion-coverage', 'criterion-answer-coverage'],
    'qr-e11': ['evaluation-methods'],
    'qr-bp09': ['assistive-technology-testing'],
    'qr-bp10': ['manual-testing'],
    'qr-bp11': ['automated-testing'],
    'qr-e09': ['contact-information'],
    'qr-bp07': ['tester-familiarity'],
    'qr-e08': ['product-description', 'source-display-name', 'source-type'],
    'qr-bp04': ['declared-wcag-versions', 'declared-levels', 'scope-notes'],
    'qr-e19': ['remarks-coverage', 'remarks-sample'],
    'qr-e04': ['vpat-template-version'],
    'qr-e06': ['report-date']
  };
  var budget = { remaining: 20000 };
  return VPAT_QUALITY_RUBRIC_.requirements.map(function (requirement, index) {
    vpatRequire_(requirement.id === VPAT_QUALITY_REQUIREMENT_IDS_[index], 'INTERNAL_ERROR');
    var evidence = evidenceFields[requirement.id].map(function (fieldId) {
      var normalized = vpatNormalizeEvidenceText_(values[fieldId]);
      if (!normalized || budget.remaining <= 0) return null;
      var value = normalized.slice(0, Math.min(4000, budget.remaining));
      budget.remaining -= value.length;
      return { fieldId: fieldId, value: value };
    }).filter(function (item) { return Boolean(item); });
    return {
      requirementId: requirement.id,
      aliases: requirement.aliases.slice(),
      title: requirement.title,
      type: requirement.type,
      impact: { weight: requirement.impact.weight, label: requirement.impact.label },
      description: requirement.description,
      guidance: requirement.guidance,
      evidence: evidence
    };
  });
}

function vpatNormalizeEvidenceText_(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/\b(?:https?|ftp):\/\/\S+|\bwww\.\S+|\bdata:[^\s]+/giu, '[link omitted]')
    .replace(/\s+/g, ' ')
    .trim();
}

function vpatJoinEvidenceValues_(items) {
  return (Array.isArray(items) ? items : [])
    .map(vpatNormalizeEvidenceText_)
    .filter(function (value) { return Boolean(value); })
    .join(' | ');
}

function vpatCompleteAdvance_(requestId, cursor, token, outcome) {
  return vpatWithUserLock_(function () {
    vpatRequireActiveRequest_(requestId);
    var requestRecord = vpatGetUserRecord_('request', requestId);
    vpatRequire_(Boolean(requestRecord), 'REQUEST_NOT_FOUND');
    var record = requestRecord.value;
    vpatRequire_(record.cursor === cursor && record.inFlight && record.inFlight.token === token, 'INVALID_REQUEST');
    var durableLastResponse = outcome.status === 'complete' || outcome.status === 'export-error'
      ? {
        requestId: requestId,
        status: outcome.status,
        detail: outcome.response.detail || null
      }
      : outcome.response;
    vpatPutUserRecord_('request', requestId, Object.assign({}, record, {
      status: outcome.status,
      cursor: outcome.nextCursor,
      sequence: record.sequence + 1,
      inFlight: null,
      lastResponse: durableLastResponse,
      updatedAt: new Date().toISOString()
    }));
    return outcome.response;
  });
}

function vpatTerminalResponseForRecord_(record) {
  if (record.status === 'complete') {
    var receipt = vpatGetUserRecord_('receipt', record.requestId);
    var analysis = vpatGetUserRecord_('analysis', record.requestId);
    vpatRequire_(Boolean(receipt) && Boolean(analysis), 'REQUEST_NOT_FOUND');
    return {
      requestId: record.requestId,
      status: 'complete',
      result: vpatClientCompletedResult_(analysis.value.analysisOutput, receipt.value)
    };
  }
  if (record.status === 'export-error') {
    var exportAnalysis = vpatGetUserRecord_('analysis', record.requestId);
    vpatRequire_(Boolean(exportAnalysis), 'REQUEST_NOT_FOUND');
    return {
      requestId: record.requestId,
      status: 'export-error',
      result: vpatClientCompletedResult_(exportAnalysis.value.analysisOutput, null),
      detail: record.lastResponse && record.lastResponse.detail
    };
  }
  return record.lastResponse;
}

function vpatPendingResponseForRecord_(record) {
  vpatRequire_(record && record.status === 'pending' && record.lastResponse, 'INVALID_REQUEST');
  var response = Object.assign({}, record.lastResponse);
  var stageData = Object.assign({}, response.stageData || {});
  if (record.cursor >= 1) {
    var ingestion = vpatGetUserRecord_('ingestion', record.requestId);
    if (ingestion) stageData.ingestionResult = ingestion.value;
  }
  if (record.cursor >= 3) {
    var conformance = vpatGetUserRecord_('conformance', record.requestId);
    if (conformance) stageData.conformanceResponse = conformance.value;
  }
  if (record.cursor >= 4) {
    var quality = vpatGetUserRecord_('quality', record.requestId);
    if (quality) stageData.qualityResponse = quality.value;
  }
  if (Object.keys(stageData).length > 0) response.stageData = stageData;
  return response;
}

function vpatReleaseAdvanceClaim_(requestId, cursor, token) {
  try {
    vpatWithUserLock_(function () {
      var requestRecord = vpatGetUserRecord_('request', requestId);
      if (!requestRecord) return;
      var record = requestRecord.value;
      if (record.cursor === cursor && record.inFlight && record.inFlight.token === token) {
        vpatPutUserRecord_('request', requestId, Object.assign({}, record, {
          inFlight: null, updatedAt: new Date().toISOString()
        }));
      }
    });
  } catch (ignored) {
    // Preserve the original safe operation error.
  }
}

function vpatRetryExport_(requestId) {
  requestId = vpatRequireRequestId_(requestId);
  var claim = vpatWithUserLock_(function () {
    vpatRequireActiveRequest_(requestId);
    var requestRecord = vpatGetUserRecord_('request', requestId);
    vpatRequire_(Boolean(requestRecord), 'REQUEST_NOT_FOUND');
    var current = requestRecord.value;
    if (current.status === 'complete') {
      return { execute: false, response: vpatTerminalResponseForRecord_(current) };
    }
    vpatRequire_(current.status === 'export-error', 'INVALID_REQUEST');
    if (current.inFlight) {
      var claimedAt = new Date(current.inFlight.claimedAt).getTime();
      var staleClaim = Number.isFinite(claimedAt) && Date.now() - claimedAt >= VPAT_IN_FLIGHT_STALE_MS_;
      if (!staleClaim) {
        return {
          execute: false,
          response: {
            requestId: requestId,
            status: 'error',
            retryable: true,
            detail: VPAT_SAFE_ERRORS_.REQUEST_IN_PROGRESS
          }
        };
      }
    }
    var attempts = Object.assign(vpatZeroAttempts_(), current.attempts || {});
    vpatRequire_(attempts.export < VPAT_RETRY_LIMITS_.export, 'EXPORT_FAILED');
    attempts.export += 1;
    var token = Utilities.getUuid();
    current = Object.assign({}, current, {
      attempts: attempts,
      inFlight: { cursor: 4, token: token, claimedAt: new Date().toISOString() },
      updatedAt: new Date().toISOString()
    });
    vpatPutUserRecord_('request', requestId, current);
    return { execute: true, token: token, record: current };
  });
  if (!claim.execute) return claim.response;
  try {
    var receipt = vpatExportStoredAnalysis_(requestId);
    var analysis = vpatGetUserRecord_('analysis', requestId);
    var response = {
      requestId: requestId,
      status: 'complete',
      result: vpatClientCompletedResult_(analysis.value.analysisOutput, receipt)
    };
    return vpatWithUserLock_(function () {
      var current = vpatGetUserRecord_('request', requestId).value;
      if (current.status === 'complete') return vpatTerminalResponseForRecord_(current);
      vpatRequire_(
        current.status === 'export-error' && current.inFlight && current.inFlight.token === claim.token,
        'INVALID_REQUEST'
      );
      vpatPutUserRecord_('request', requestId, Object.assign({}, current, {
        status: 'complete', cursor: 5, sequence: current.sequence + 1,
        inFlight: null,
        lastResponse: { requestId: requestId, status: 'complete', detail: null },
        updatedAt: new Date().toISOString()
      }));
      return response;
    });
  } catch (error) {
    if (error && (error.vpatCode === 'EXPORT_FAILED' || error.vpatCode === 'EXPORT_COMPLETION_AMBIGUOUS')) {
      return vpatWithUserLock_(function () {
        var currentRecord = vpatGetUserRecord_('request', requestId);
        vpatRequire_(Boolean(currentRecord), 'REQUEST_NOT_FOUND');
        var current = currentRecord.value;
        if (current.status === 'complete') return vpatTerminalResponseForRecord_(current);
        vpatRequire_(
          current.status === 'export-error' && current.inFlight && current.inFlight.token === claim.token,
          'INVALID_REQUEST'
        );
        var response = {
          requestId: requestId,
          status: 'export-error',
          result: vpatClientCompletedResult_(vpatGetUserRecord_('analysis', requestId).value.analysisOutput, null),
          detail: VPAT_SAFE_ERRORS_[error.vpatCode]
        };
        vpatPutUserRecord_('request', requestId, Object.assign({}, current, {
          inFlight: null,
          lastResponse: {
            requestId: requestId,
            status: 'export-error',
            detail: response.detail
          },
          updatedAt: new Date().toISOString()
        }));
        return response;
      });
    }
    vpatReleaseAdvanceClaim_(requestId, 4, claim.token);
    throw error;
  }
}

function vpatClientCompletedResult_(analysisOutput, receipt) {
  return {
    analysisId: analysisOutput.requestId,
    summary: {
      analysisStatus: analysisOutput.analysisStatus,
      scoreSummary: analysisOutput.scoreSummary,
      counts: analysisOutput.counts,
      grade: analysisOutput.scoreSummary.grade,
      score: analysisOutput.scoreSummary.percentage,
      criteriaReviewed: analysisOutput.counts.criteria,
      qualityRequirements: analysisOutput.counts.qualityRequirements
    },
    source: analysisOutput.source,
    wcagItems: analysisOutput.wcagFindings.map(vpatClientWcagItem_),
    qualityItems: analysisOutput.qualityFindings.map(vpatClientQualityItem_),
    sheet: {
      location: 'My Drive/VPAT Analyzer Results',
      url: receipt ? receipt.spreadsheetUrl : null,
      tabs: VPAT_EXPORT_TAB_NAMES_.slice()
    },
    methodology: {
      versions: analysisOutput.provenance,
      parserVersion: analysisOutput.ingestion && analysisOutput.ingestion.parserVersion,
      confidenceThreshold: 70,
      disclaimer: 'This analysis is decision support, not a certification of accessibility or legal compliance.'
    }
  };
}

function vpatClientWcagItem_(finding) {
  return {
    id: finding.criterionId,
    criterion: finding.sc,
    title: finding.title,
    authorConformance: finding.sourceConformance,
    authorRemarks: finding.sourceRemarks,
    assessmentSummary: finding.status === 'Complete'
      ? String(finding.normalizedConformance || '')
      : 'The analyzer could not complete this finding.',
    assessment: finding.evidence,
    reviewerAction: finding.reviewRequired
      ? 'Review the source statement and analyzer evidence before relying on this finding.'
      : 'No additional review is indicated by the analyzer.',
    confidence: finding.confidence,
    needsReview: Boolean(finding.reviewRequired || finding.status !== 'Complete')
  };
}

function vpatClientQualityItem_(finding) {
  return {
    id: finding.requirementId,
    displayId: Array.isArray(finding.aliases) && finding.aliases.length ? finding.aliases[0] : finding.requirementId,
    title: finding.title,
    result: finding.result,
    evidenceLocation: 'VPAT report',
    exactEvidence: finding.evidence,
    evidenceSummary: finding.evidence,
    assessment: finding.evidence,
    reviewerAction: finding.guidance,
    confidence: finding.confidence,
    needsReview: Boolean(finding.reviewRequired || finding.status !== 'Complete')
  };
}

function vpatDeleteTransientAnalysisRecords_(requestId) {
  var properties = PropertiesService.getUserProperties();
  ['source', 'ingestion', 'conformance', 'quality'].forEach(function (kind) {
    var headKey = vpatRecordPrefix_(kind, requestId, null) + ':head';
    var generation = properties.getProperty(headKey);
    if (generation) vpatDeleteRecordGeneration_(properties, kind, requestId, generation);
    properties.deleteProperty(headKey);
  });
}

function vpatPrepareActiveRequestReplacement_(nextRequestId) {
  var properties = PropertiesService.getUserProperties();
  var activeRequestId = properties.getProperty('vpat:active-request-id');
  if (!activeRequestId) return;
  var activeRecord = vpatGetUserRecord_('request', activeRequestId);
  vpatRequire_(!activeRecord || !activeRecord.value.inFlight, 'REQUEST_IN_PROGRESS', true);
  vpatDeleteAllRequestRecords_(activeRequestId);
  if (activeRequestId !== nextRequestId) properties.deleteProperty('vpat:active-request-id');
}

function vpatDeleteAllRequestRecords_(requestId) {
  var properties = PropertiesService.getUserProperties();
  [
    'request', 'source', 'ingestion', 'conformance', 'quality',
    'analysis', 'export-claim', 'receipt'
  ].forEach(function (kind) {
    var headKey = vpatRecordPrefix_(kind, requestId, null) + ':head';
    var generation = properties.getProperty(headKey);
    if (generation) vpatDeleteRecordGeneration_(properties, kind, requestId, generation);
    properties.deleteProperty(headKey);
  });
}

function vpatValidateSubmittedIngestion_(ingestion, record) {
  vpatRequire_(vpatUtf8Length_(JSON.stringify(ingestion)) <= 160 * 1024, 'RESOURCE_LIMIT_EXCEEDED');
  vpatRequire_(
    ingestion && typeof ingestion === 'object' && !Array.isArray(ingestion) &&
    ingestion.schemaVersion === '1.0.0' && ingestion.requestId === record.requestId &&
    ingestion.parserVersion === '1.0.0' && ingestion.catalogVersion === '1.0.0' &&
    (ingestion.status === 'complete' || ingestion.status === 'rejected'),
    'INVALID_REQUEST'
  );
  if (ingestion.status === 'rejected') {
    vpatRequireClosedObject_(
      ingestion,
      ['schemaVersion', 'requestId', 'parserVersion', 'catalogVersion', 'sourceType', 'status', 'rejection'],
      'INVALID_REQUEST'
    );
    vpatRequire_(
      ingestion.sourceType === record.source.sourceType || ingestion.sourceType === 'unknown',
      'INVALID_REQUEST'
    );
    vpatRequireClosedObject_(ingestion.rejection, ['code', 'stage', 'safeMessage'], 'INVALID_REQUEST');
    var rejectionMessages = {
      SOURCE_INACCESSIBLE: 'The selected source could not be read.',
      SOURCE_TYPE_UNSUPPORTED: 'The authoritative source format is unsupported or inconsistent.',
      VPAT_VERSION_UNSUPPORTED: 'The source does not declare one supported VPAT 2.5 template version.',
      PDF_NON_SEARCHABLE: 'The PDF does not contain enough searchable text.',
      PDF_INSUFFICIENT_TEXT: 'The PDF does not contain enough searchable text.',
      PDF_ENCRYPTED: 'The encrypted PDF could not be analyzed.',
      SOURCE_MALFORMED: 'The source structure is malformed and could not be analyzed.',
      WCAG_TABLE_NOT_FOUND: 'No eligible WCAG conformance table was found.',
      WCAG_ROWS_AMBIGUOUS: 'One or more apparent WCAG rows could not be matched without guessing.',
      RESOURCE_LIMIT_EXCEEDED: 'The source exceeds a deterministic ingestion resource limit.'
    };
    var rejectionStages = [
      'access', 'classification', 'transport', 'container-parse',
      'table-detection', 'row-matching', 'resource-limit'
    ];
    vpatRequire_(
      Object.prototype.hasOwnProperty.call(rejectionMessages, ingestion.rejection.code) &&
      rejectionStages.indexOf(ingestion.rejection.stage) >= 0 &&
      typeof ingestion.rejection.safeMessage === 'string' && ingestion.rejection.safeMessage.length > 0 &&
      ingestion.rejection.safeMessage.length <= 500,
      'INVALID_REQUEST'
    );
    return Object.assign({}, ingestion, {
      rejection: {
        code: ingestion.rejection.code,
        stage: ingestion.rejection.stage,
        safeMessage: rejectionMessages[ingestion.rejection.code]
      }
    });
  }
  var completeProperties = [
    'schemaVersion', 'requestId', 'parserVersion', 'catalogVersion', 'sourceType', 'status',
    'candidateTables', 'rows', 'excludedRows', 'duplicates', 'coverage'
  ];
  if (Object.prototype.hasOwnProperty.call(ingestion, 'reportEvidence')) completeProperties.push('reportEvidence');
  vpatRequireClosedObject_(
    ingestion,
    completeProperties,
    'INVALID_REQUEST'
  );
  if (Object.prototype.hasOwnProperty.call(ingestion, 'reportEvidence')) {
    vpatValidateReportEvidence_(ingestion.reportEvidence);
  }
  vpatRequire_(
    ingestion.sourceType === record.source.sourceType &&
    Array.isArray(ingestion.candidateTables) && ingestion.candidateTables.length > 0 && ingestion.candidateTables.length <= 128 &&
    Array.isArray(ingestion.rows) && ingestion.rows.length > 0 && ingestion.rows.length <= 87 &&
    Array.isArray(ingestion.excludedRows) && ingestion.excludedRows.length <= 5000 &&
    Array.isArray(ingestion.duplicates) && ingestion.duplicates.length <= 87,
    'INVALID_REQUEST'
  );
  var tablesByOrder = {};
  var tableIds = {};
  var previousTableOrder = -1;
  var classificationReasons = {
    wcag: ['ELIGIBLE_WCAG_HEADERS'],
    'non-wcag': ['BODY_OR_LAYOUT_TABLE', 'SECTION_508_TABLE', 'EN_301_549_TABLE', 'NON_WCAG_TABLE'],
    ambiguous: ['AMBIGUOUS_HEADERS']
  };
  ingestion.candidateTables.forEach(function (table) {
    vpatRequireClosedObject_(
      table,
      ['tableId', 'sourceOrder', 'classification', 'reasonCode', 'headers'],
      'INVALID_REQUEST'
    );
    vpatRequire_(
      typeof table.tableId === 'string' && table.tableId.length > 0 && table.tableId.length <= 128 && !tableIds[table.tableId] &&
      Number.isInteger(table.sourceOrder) && table.sourceOrder >= 0 && table.sourceOrder > previousTableOrder &&
      classificationReasons[table.classification] && classificationReasons[table.classification].indexOf(table.reasonCode) >= 0 &&
      Array.isArray(table.headers) && table.headers.length <= 32,
      'INVALID_REQUEST'
    );
    table.headers.forEach(function (header) {
      vpatRequire_(typeof header === 'string' && header.length <= 500, 'INVALID_REQUEST');
    });
    tableIds[table.tableId] = true;
    tablesByOrder[table.sourceOrder] = table;
    previousTableOrder = table.sourceOrder;
  });
  var rowIds = {};
  var rowsByCriterion = {};
  var rowLocations = {};
  var previousRow = null;
  ingestion.rows.forEach(function (row) {
    vpatValidateIngestionRow_(row, tablesByOrder, rowIds, rowsByCriterion, rowLocations, previousRow);
    rowIds[row.rowId] = true;
    rowsByCriterion[row.criterionId] = row;
    rowLocations[vpatIngestionLocation_(row)] = true;
    previousRow = row;
  });
  var duplicateExclusions = {};
  var excludedReasons = [
    'BODY_PROSE', 'NON_WCAG_ROW', 'SECTION_508_ROW', 'EN_301_549_ROW',
    'UNRECOGNIZED_CRITERION', 'AMBIGUOUS_CRITERION', 'DUPLICATE_CRITERION'
  ];
  ingestion.excludedRows.forEach(function (row) {
    vpatRequireClosedObject_(row, ['sourceTableIndex', 'sourceRowIndex', 'sourceLabel', 'reasonCode'], 'INVALID_REQUEST');
    vpatRequire_(
      Number.isInteger(row.sourceTableIndex) && row.sourceTableIndex >= 0 &&
      Number.isInteger(row.sourceRowIndex) && row.sourceRowIndex >= 0 &&
      typeof row.sourceLabel === 'string' && row.sourceLabel.length <= 1000 &&
      excludedReasons.indexOf(row.reasonCode) >= 0,
      'INVALID_REQUEST'
    );
    if (row.reasonCode === 'DUPLICATE_CRITERION') {
      var location = vpatIngestionLocation_(row);
      vpatRequire_(!duplicateExclusions[location], 'INVALID_REQUEST');
      duplicateExclusions[location] = row;
    }
  });
  var duplicateCriteria = {};
  var duplicateLocationCount = 0;
  ingestion.duplicates.forEach(function (group) {
    vpatRequireClosedObject_(group, ['criterionId', 'keptRowId', 'duplicateRows'], 'INVALID_REQUEST');
    var kept = rowsByCriterion[group.criterionId];
    vpatRequire_(
      kept && kept.rowId === group.keptRowId && !duplicateCriteria[group.criterionId] &&
      Array.isArray(group.duplicateRows) && group.duplicateRows.length > 0 && group.duplicateRows.length <= 511,
      'INVALID_REQUEST'
    );
    duplicateCriteria[group.criterionId] = true;
    group.duplicateRows.forEach(function (row) {
      vpatValidateIngestionRow_(row, tablesByOrder, rowIds, {}, rowLocations, null);
      vpatRequire_(row.criterionId === group.criterionId, 'INVALID_REQUEST');
      var location = vpatIngestionLocation_(row);
      var exclusion = duplicateExclusions[location];
      vpatRequire_(exclusion && exclusion.sourceLabel === row.sourceCriterionLabel, 'INVALID_REQUEST');
      rowIds[row.rowId] = true;
      rowLocations[location] = true;
      duplicateLocationCount += 1;
    });
  });
  vpatRequire_(duplicateLocationCount === Object.keys(duplicateExclusions).length, 'INVALID_REQUEST');
  vpatValidateCoverage_(ingestion);
  return ingestion;
}

function vpatValidateReportEvidence_(evidence) {
  var fields = [
    'templateVersion', 'productDescription', 'reportDate', 'contactInformation',
    'evaluationMethods', 'assistiveTechnologyTesting', 'manualTesting',
    'automatedTesting', 'testerFamiliarity', 'conformanceDefinitions', 'scopeNotes'
  ];
  vpatRequireClosedObject_(evidence, fields, 'INVALID_REQUEST');
  var totalCharacters = 0;
  fields.forEach(function (field) {
    vpatRequire_(typeof evidence[field] === 'string' && evidence[field].length <= 1000, 'INVALID_REQUEST');
    totalCharacters += evidence[field].length;
  });
  vpatRequire_(totalCharacters <= 12000, 'INVALID_REQUEST');
}

function vpatIngestionLocation_(row) {
  return row.sourceTableIndex + ':' + row.sourceRowIndex;
}

function vpatValidateIngestionRow_(row, tablesByOrder, rowIds, rowsByCriterion, rowLocations, previousRow) {
  vpatRequireClosedObject_(
    row,
    [
      'rowId', 'criterionId', 'sourceCriterionLabel', 'sourceConformance', 'sourceRemarks',
      'sourceTableIndex', 'sourceRowIndex', 'aliasMatch'
    ],
    'INVALID_REQUEST'
  );
  var location = vpatIngestionLocation_(row);
  var sourceTable = tablesByOrder[row.sourceTableIndex];
  vpatRequire_(
    typeof row.rowId === 'string' && row.rowId.length > 0 && row.rowId.length <= 160 && !rowIds[row.rowId] &&
    /^wcag-sc-[1-4]\.[1-9][0-9]*\.[1-9][0-9]*$/.test(row.criterionId) && !rowsByCriterion[row.criterionId] &&
    typeof row.sourceCriterionLabel === 'string' && row.sourceCriterionLabel.length > 0 && row.sourceCriterionLabel.length <= 1000 &&
    typeof row.sourceConformance === 'string' && row.sourceConformance.length <= 2000 &&
    typeof row.sourceRemarks === 'string' && row.sourceRemarks.length <= 10000 &&
    Number.isInteger(row.sourceTableIndex) && row.sourceTableIndex >= 0 &&
    Number.isInteger(row.sourceRowIndex) && row.sourceRowIndex >= 0 &&
    (row.aliasMatch === 'exact-sc' || row.aliasMatch === 'exact-sc-plus-official-title') &&
    sourceTable && sourceTable.classification === 'wcag' && !rowLocations[location],
    'INVALID_REQUEST'
  );
  vpatCatalogCriterion_(row.criterionId);
  if (previousRow) {
    vpatRequire_(
      row.sourceTableIndex > previousRow.sourceTableIndex ||
      (row.sourceTableIndex === previousRow.sourceTableIndex && row.sourceRowIndex > previousRow.sourceRowIndex),
      'INVALID_REQUEST'
    );
  }
}

function vpatValidateCoverage_(ingestion) {
  var coverage = ingestion.coverage;
  vpatRequireClosedObject_(
    coverage,
    ['declaredWcagVersions', 'declaredLevels', 'expectedCriterionIds', 'extractedCriterionIds', 'missingCriterionIds'],
    'INVALID_REQUEST'
  );
  vpatRequire_(
    Array.isArray(coverage.declaredWcagVersions) && coverage.declaredWcagVersions.length > 0 && coverage.declaredWcagVersions.length <= 3 &&
    Array.isArray(coverage.declaredLevels) && coverage.declaredLevels.length > 0 && coverage.declaredLevels.length <= 3 &&
    Array.isArray(coverage.expectedCriterionIds) && coverage.expectedCriterionIds.length > 0 && coverage.expectedCriterionIds.length <= 87 &&
    Array.isArray(coverage.extractedCriterionIds) && coverage.extractedCriterionIds.length > 0 && coverage.extractedCriterionIds.length <= 87 &&
    Array.isArray(coverage.missingCriterionIds) && coverage.missingCriterionIds.length <= 87,
    'INVALID_REQUEST'
  );
  vpatIngestionRequireStringSet_(coverage.declaredWcagVersions, ['2.0', '2.1', '2.2']);
  vpatIngestionRequireStringSet_(coverage.declaredLevels, ['A', 'AA', 'AAA']);
  var versionSet = {};
  var levelSet = {};
  coverage.declaredWcagVersions.forEach(function (version) { versionSet[version] = true; });
  coverage.declaredLevels.forEach(function (level) { levelSet[level] = true; });
  vpatRequire_(
    VPAT_WCAG_CATALOG_ && VPAT_WCAG_CATALOG_.version === '1.0.0' &&
    Array.isArray(VPAT_WCAG_CATALOG_.criteria) && VPAT_WCAG_CATALOG_.criteria.length > 0 &&
    VPAT_WCAG_CATALOG_.criteria.length <= 87,
    'INTERNAL_ERROR'
  );
  var canonicalExpected = VPAT_WCAG_CATALOG_.criteria.filter(function (criterion) {
    return criterion && levelSet[criterion.level] && Array.isArray(criterion.activeIn) &&
      criterion.activeIn.some(function (version) { return versionSet[version]; });
  }).map(function (criterion) { return criterion.id; });
  var extracted = ingestion.rows.map(function (row) { return row.criterionId; });
  var extractedSet = {};
  extracted.forEach(function (criterionId) { extractedSet[criterionId] = true; });
  var missing = canonicalExpected.filter(function (criterionId) { return !extractedSet[criterionId]; });
  vpatRequire_(
    JSON.stringify(coverage.expectedCriterionIds) === JSON.stringify(canonicalExpected) &&
    JSON.stringify(coverage.extractedCriterionIds) === JSON.stringify(extracted) &&
    JSON.stringify(coverage.missingCriterionIds) === JSON.stringify(missing),
    'INVALID_REQUEST'
  );
}

function vpatIngestionRequireStringSet_(values, allowedValues) {
  var seen = {};
  values.forEach(function (value) {
    vpatRequire_(typeof value === 'string' && allowedValues.indexOf(value) >= 0 && !seen[value], 'INVALID_REQUEST');
    seen[value] = true;
  });
}

function vpatStageResponse_(requestId, stageIndex) {
  return {
    requestId: requestId,
    status: 'pending',
    cursor: stageIndex,
    event: {
      type: 'STAGE_CHANGED',
      requestId: requestId,
      stageIndex: stageIndex,
      stage: VPAT_STAGE_STATES_[stageIndex]
    }
  };
}

function vpatIsActiveRequest_(requestId) {
  return PropertiesService.getUserProperties().getProperty('vpat:active-request-id') === requestId;
}

function vpatRequireActiveRequest_(requestId) {
  vpatRequire_(vpatIsActiveRequest_(requestId), 'REQUEST_NOT_FOUND');
}
