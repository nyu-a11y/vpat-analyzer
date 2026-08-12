var VPAT_EXPORT_FOLDER_NAME_ = 'VPAT Analyzer Results';
var VPAT_EXPORT_MIME_TYPE_ = 'application/vnd.google-apps.spreadsheet';
var VPAT_EXPORT_TEMPLATE_VERSION_ = '1.0.0';
var VPAT_EXPORT_TAB_NAMES_ = Object.freeze([
  'Overview',
  'Line-item Review',
  'Quality Requirements',
  'Scoring',
  'Methodology & disclaimer'
]);
var VPAT_EXPORT_TAB_IDS_ = Object.freeze([
  'overview',
  'line-item-review',
  'quality-requirements',
  'scoring',
  'methodology-disclaimer'
]);
var VPAT_TRUSTED_FORMULAS_ = Object.freeze({
  'formula-score-earned-v1': '=SUMIF(\'Quality Requirements\'!G:G,"Pass",\'Quality Requirements\'!E:E)',
  'formula-score-percentage-v1': '=IFERROR(ROUND(B2/B3*100),"")'
});

function vpatStoreImmutableAnalysis_(requestId, analysisOutput, exportModel) {
  requestId = vpatRequireRequestId_(requestId);
  var requestRecord = vpatGetUserRecord_('request', requestId);
  var ingestionRecord = vpatGetUserRecord_('ingestion', requestId);
  var conformanceRecord = vpatGetUserRecord_('conformance', requestId);
  var qualityRecord = vpatGetUserRecord_('quality', requestId);
  vpatRequire_(
    Boolean(requestRecord) && Boolean(ingestionRecord) && Boolean(conformanceRecord) && Boolean(qualityRecord),
    'REQUEST_NOT_FOUND'
  );
  var expectedAnalysis = vpatExpectedAnalysisOutput_(
    requestRecord.value,
    ingestionRecord.value,
    conformanceRecord.value,
    qualityRecord.value
  );
  vpatRequire_(
    JSON.stringify(vpatCanonicalJsonValue_(analysisOutput)) ===
      JSON.stringify(vpatCanonicalJsonValue_(expectedAnalysis)),
    'ANALYSIS_OUTPUT_INVALID'
  );
  vpatValidateExportModel_(exportModel, requestId);
  var expectedExportModel = vpatExpectedExportModel_(expectedAnalysis);
  vpatRequire_(
    JSON.stringify(vpatCanonicalJsonValue_(exportModel)) ===
      JSON.stringify(vpatCanonicalJsonValue_(expectedExportModel)),
    'EXPORT_MODEL_INVALID'
  );
  var immutable = {
    schemaVersion: '1.0.0',
    requestId: requestId,
    analysisOutput: analysisOutput
  };
  var digest = vpatSha256Text_(JSON.stringify(vpatCanonicalJsonValue_(immutable)));
  return vpatWithUserLock_(function () {
    var existing = vpatGetUserRecord_('analysis', requestId);
    if (existing) {
      var existingDigest = vpatSha256Text_(JSON.stringify(vpatCanonicalJsonValue_(existing.value)));
      vpatRequire_(existingDigest === digest, 'ANALYSIS_IMMUTABLE');
      return { requestId: requestId, analysisDigest: digest, stored: false };
    }
    vpatPutUserRecord_('analysis', requestId, immutable);
    return { requestId: requestId, analysisDigest: digest, stored: true };
  });
}

function vpatExpectedAnalysisOutput_(request, ingestion, conformance, quality) {
  vpatRequire_(
    ingestion.requestId === request.requestId && conformance.requestId === request.requestId &&
    quality.requestId === request.requestId && ingestion.status === 'complete',
    'ANALYSIS_OUTPUT_INVALID'
  );
  var rowByCriterion = {};
  ingestion.rows.forEach(function (row) { rowByCriterion[row.criterionId] = row; });
  var conformanceByCriterion = {};
  conformance.findings.forEach(function (finding) { conformanceByCriterion[finding.criterionId] = finding; });
  var wcagFindings = ingestion.coverage.expectedCriterionIds.map(function (criterionId) {
    var criterion = vpatCatalogCriterion_(criterionId);
    var row = rowByCriterion[criterionId] || null;
    var finding = conformanceByCriterion[criterionId];
    vpatRequire_(Boolean(finding), 'ANALYSIS_OUTPUT_INVALID');
    var result = {
      criterionId: criterionId,
      sc: criterion.sc,
      title: criterion.title,
      level: criterion.level,
      rowId: row ? row.rowId : null,
      sourceCriterionLabel: row ? row.sourceCriterionLabel : null,
      sourceConformance: row ? row.sourceConformance : null,
      sourceRemarks: row ? row.sourceRemarks : null,
      status: finding.status,
      normalizedConformance: finding.normalizedConformance,
      evidence: finding.evidence,
      confidence: finding.confidence,
      reviewRequired: Boolean(
        finding.reviewRequired ||
        (Number.isInteger(finding.confidence) && finding.confidence < VPAT_SCORING_RULES_.confidenceThreshold)
      )
    };
    if (finding.incompleteReason) result.incompleteReason = finding.incompleteReason;
    return result;
  });
  var qualityByRequirement = {};
  quality.findings.forEach(function (finding) { qualityByRequirement[finding.requirementId] = finding; });
  var qualityFindings = VPAT_QUALITY_RUBRIC_.requirements.map(function (requirement, index) {
    vpatRequire_(requirement.id === VPAT_QUALITY_REQUIREMENT_IDS_[index], 'ANALYSIS_OUTPUT_INVALID');
    var finding = qualityByRequirement[requirement.id];
    vpatRequire_(Boolean(finding), 'ANALYSIS_OUTPUT_INVALID');
    var result = {
      requirementId: requirement.id,
      aliases: requirement.aliases.slice(),
      title: requirement.title,
      type: requirement.type,
      impact: { weight: requirement.impact.weight, label: requirement.impact.label },
      status: finding.status,
      result: finding.result,
      evidence: finding.evidence,
      guidance: finding.guidance,
      confidence: finding.confidence,
      reviewRequired: Boolean(
        finding.reviewRequired ||
        (Number.isInteger(finding.confidence) && finding.confidence < VPAT_SCORING_RULES_.confidenceThreshold)
      )
    };
    if (finding.incompleteReason) result.incompleteReason = finding.incompleteReason;
    return result;
  });
  var allFindingsComplete = ingestion.coverage.missingCriterionIds.length === 0 &&
    wcagFindings.every(function (finding) { return finding.status === 'Complete'; }) &&
    qualityFindings.every(function (finding) { return finding.status === 'Complete'; });
  var scoreSummary = allFindingsComplete
    ? vpatExpectedScoreSummary_(qualityFindings)
    : {
      status: 'Incomplete', earnedWeight: null, possibleWeight: null,
      percentage: null, grade: null, incompleteReasons: ['MISSING_FINDING']
    };
  return {
    schemaVersion: '1.0.0',
    requestId: request.requestId,
    analysisStatus: allFindingsComplete && scoreSummary.status === 'Complete' ? 'Complete' : 'Incomplete',
    source: {
      displayName: request.source.name,
      sourceType: request.source.sourceType,
      vpatVersion: '2.5',
      declaredWcagVersions: ingestion.coverage.declaredWcagVersions.slice(),
      declaredLevels: ingestion.coverage.declaredLevels.slice()
    },
    provenance: {
      catalogVersion: '1.0.0', rubricVersion: '1.0.0', scoringVersion: '1.0.0',
      conformancePromptVersion: '1.0.0', qualityPromptVersion: '1.0.0',
      conformanceSchemaVersion: '1.0.0', qualitySchemaVersion: '1.0.0',
      ingestionSchemaVersion: '1.0.0', exportSchemaVersion: '1.0.0', templateVersion: '1.0.0'
    },
    ingestion: {
      parserVersion: ingestion.parserVersion,
      expectedCriterionIds: ingestion.coverage.expectedCriterionIds.slice(),
      missingCriterionIds: ingestion.coverage.missingCriterionIds.slice()
    },
    wcagFindings: wcagFindings,
    qualityFindings: qualityFindings,
    scoreSummary: scoreSummary,
    counts: {
      criteria: wcagFindings.length,
      qualityRequirements: qualityFindings.length,
      reviewRequired: wcagFindings.filter(function (finding) { return finding.reviewRequired; }).length +
        qualityFindings.filter(function (finding) { return finding.reviewRequired; }).length
    }
  };
}

function vpatExpectedScoreSummary_(qualityFindings) {
  vpatRequire_(
    typeof VPAT_SCORING_RULES_ === 'object' && VPAT_SCORING_RULES_ &&
    VPAT_SCORING_RULES_.version === '1.0.0' && VPAT_SCORING_RULES_.totalPossibleWeight === 60 &&
    Array.isArray(VPAT_SCORING_RULES_.bands) && VPAT_SCORING_RULES_.bands.length === 6,
    'INTERNAL_ERROR'
  );
  if (qualityFindings.some(function (finding) { return finding.status !== 'Complete'; })) {
    return {
      status: 'Incomplete', earnedWeight: null, possibleWeight: null,
      percentage: null, grade: null, incompleteReasons: ['MISSING_FINDING']
    };
  }
  var earnedWeight = qualityFindings.reduce(function (total, finding) {
    vpatRequire_(finding.result === 'Pass' || finding.result === 'Fail', 'ANALYSIS_OUTPUT_INVALID');
    return total + (finding.result === 'Pass' ? finding.impact.weight : 0);
  }, 0);
  var percentage = Math.floor((earnedWeight / 60) * 100 + 0.5);
  var bands = VPAT_SCORING_RULES_.bands.filter(function (band) {
    return percentage >= band.min && percentage <= band.max;
  });
  vpatRequire_(bands.length === 1, 'INTERNAL_ERROR');
  return {
    status: 'Complete', earnedWeight: earnedWeight, possibleWeight: 60,
    percentage: percentage, grade: bands[0].grade
  };
}

function vpatExpectedExportModel_(analysis) {
  var overviewColumns = ['metric', 'value'];
  var overviewRows = [
    ['source-name', 'Source', analysis.source.displayName],
    ['source-type', 'Source type', analysis.source.sourceType],
    ['vpat-version', 'VPAT version', analysis.source.vpatVersion],
    ['wcag-versions', 'Declared WCAG versions', analysis.source.declaredWcagVersions.join(', ')],
    ['wcag-levels', 'Declared levels', analysis.source.declaredLevels.join(', ')],
    ['analysis-status', 'Analysis status', analysis.analysisStatus],
    ['criteria-count', 'Criteria reviewed', analysis.counts.criteria],
    ['review-count', 'Items needing review', analysis.counts.reviewRequired],
    ['grade', 'Report-quality grade', analysis.scoreSummary.grade]
  ].map(function (item) { return vpatExpectedExportRow_(item[0], overviewColumns, [item[1], item[2]]); });

  var lineItemColumns = [
    'criterion-id', 'sc', 'title', 'level', 'source-criterion', 'source-conformance',
    'source-remarks', 'normalized-conformance', 'analyzer-evidence', 'confidence', 'status', 'review-required'
  ];
  var lineItemRows = analysis.wcagFindings.map(function (finding) {
    return vpatExpectedExportRow_(finding.criterionId, lineItemColumns, [
      finding.criterionId, finding.sc, finding.title, finding.level, finding.sourceCriterionLabel,
      finding.sourceConformance, finding.sourceRemarks, finding.normalizedConformance, finding.evidence,
      finding.confidence, finding.status, finding.reviewRequired
    ]);
  });

  var qualityColumns = [
    'requirement-id', 'aliases', 'title', 'type', 'impact-weight', 'impact-label',
    'result', 'evidence', 'guidance', 'confidence', 'status', 'review-required'
  ];
  var qualityRows = analysis.qualityFindings.map(function (finding) {
    return vpatExpectedExportRow_(finding.requirementId, qualityColumns, [
      finding.requirementId, finding.aliases.join(', '), finding.title, finding.type,
      finding.impact.weight, finding.impact.label, finding.result, finding.evidence,
      finding.guidance, finding.confidence, finding.status, finding.reviewRequired
    ]);
  });

  var scoreColumns = ['metric', 'value'];
  var scoreRows = [
    ['status', 'Status', analysis.scoreSummary.status],
    ['earned-weight', 'Earned weight', analysis.scoreSummary.earnedWeight],
    ['possible-weight', 'Possible weight', analysis.scoreSummary.possibleWeight],
    ['percentage', 'Percentage', analysis.scoreSummary.percentage],
    ['grade', 'Grade', analysis.scoreSummary.grade]
  ].map(function (item) { return vpatExpectedExportRow_(item[0], scoreColumns, [item[1], item[2]]); });
  var bandColumns = ['grade', 'minimum', 'maximum'];
  var bandRows = VPAT_SCORING_RULES_.bands.map(function (band) {
    return vpatExpectedExportRow_(
      'grade-' + band.grade.toLowerCase().replace('-', '-minus'),
      bandColumns,
      [band.grade, band.min, band.max]
    );
  });

  var methodologyColumns = ['topic', 'detail'];
  var provenanceKeys = [
    'catalogVersion', 'rubricVersion', 'scoringVersion', 'conformancePromptVersion',
    'qualityPromptVersion', 'conformanceSchemaVersion', 'qualitySchemaVersion',
    'ingestionSchemaVersion', 'exportSchemaVersion', 'templateVersion'
  ];
  var provenanceRows = provenanceKeys.map(function (key) {
    return vpatExpectedExportRow_(
      key.replace(/[A-Z]/g, function (letter) { return '-' + letter.toLowerCase(); }),
      methodologyColumns,
      [key, analysis.provenance[key]]
    );
  });
  var methodologyRows = [
    [
      'supported-boundary', 'Supported boundary',
      'VPAT 2.5 Google Docs, DOCX, and searchable PDF files selected from Google Drive; WCAG tables only; no OCR.'
    ],
    [
      'deterministic-ingestion', 'Deterministic ingestion',
      'The analyzer identifies eligible WCAG tables and criterion IDs before provider analysis.'
    ],
    [
      'ai-limitations', 'AI limitations',
      'Analyzer findings support human review and may be incomplete or require verification.'
    ],
    [
      'confidence-threshold', 'Confidence review threshold',
      'Findings below 70 confidence require review and do not silently change result values.'
    ],
    [
      'privacy-output', 'Privacy and output',
      'The final spreadsheet is created privately in My Drive/VPAT Analyzer Results.'
    ]
  ].map(function (item) { return vpatExpectedExportRow_(item[0], methodologyColumns, [item[1], item[2]]); });
  var disclaimerRows = [vpatExpectedExportRow_('required-disclaimer', methodologyColumns, [
    'Disclaimer',
    'This analysis is decision support, not a certification of accessibility or legal compliance. Verify findings against the source report and applicable requirements.'
  ])];

  return {
    schemaVersion: '1.0.0',
    requestId: analysis.requestId,
    outputFolder: 'My Drive/VPAT Analyzer Results',
    analysisStatus: analysis.analysisStatus,
    source: Object.assign({}, analysis.source),
    provenance: Object.assign({}, analysis.provenance),
    scoreSummary: Object.assign({}, analysis.scoreSummary),
    tabs: [
      vpatExpectedExportTab_(0, [vpatExpectedExportSection_(
        'analysis-summary', 'Analysis summary', 'summary', overviewColumns, overviewRows
      )]),
      vpatExpectedExportTab_(1, [vpatExpectedExportSection_(
        'wcag-findings', 'WCAG criterion findings', 'table', lineItemColumns, lineItemRows
      )]),
      vpatExpectedExportTab_(2, [vpatExpectedExportSection_(
        'quality-findings', 'Report-quality requirements', 'table', qualityColumns, qualityRows
      )]),
      vpatExpectedExportTab_(3, [
        vpatExpectedExportSection_('score-summary', 'Score summary', 'scoring', scoreColumns, scoreRows),
        vpatExpectedExportSection_('score-bands', 'Scoring bands', 'table', bandColumns, bandRows)
      ]),
      vpatExpectedExportTab_(4, [
        vpatExpectedExportSection_('version-provenance', 'Version provenance', 'methodology', methodologyColumns, provenanceRows),
        vpatExpectedExportSection_('methodology', 'Methodology', 'methodology', methodologyColumns, methodologyRows),
        vpatExpectedExportSection_('disclaimer', 'Disclaimer', 'disclaimer', methodologyColumns, disclaimerRows)
      ])
    ]
  };
}

function vpatExpectedExportRow_(rowId, columns, values) {
  return {
    rowId: rowId,
    cells: columns.map(function (columnId, index) {
      return { columnId: columnId, kind: 'literal', value: values[index] };
    })
  };
}

function vpatExpectedExportSection_(sectionId, heading, kind, columns, rows) {
  return { sectionId: sectionId, heading: heading, kind: kind, columns: columns.slice(), rows: rows };
}

function vpatExpectedExportTab_(index, sections) {
  return {
    tabId: VPAT_EXPORT_TAB_IDS_[index],
    name: VPAT_EXPORT_TAB_NAMES_[index],
    order: index + 1,
    sections: sections
  };
}

function vpatValidateExportModel_(model, requestId) {
  vpatRequire_(
    model && typeof model === 'object' && !Array.isArray(model) && model.schemaVersion === '1.0.0' &&
    model.requestId === requestId && model.outputFolder === 'My Drive/VPAT Analyzer Results' &&
    model.provenance && typeof model.provenance.templateVersion === 'string' &&
    Array.isArray(model.tabs) && model.tabs.length === VPAT_EXPORT_TAB_NAMES_.length,
    'EXPORT_MODEL_INVALID'
  );
  model.tabs.forEach(function (tab, tabIndex) {
    vpatRequire_(
      tab && tab.tabId === VPAT_EXPORT_TAB_IDS_[tabIndex] &&
      tab.name === VPAT_EXPORT_TAB_NAMES_[tabIndex] && tab.order === tabIndex + 1 &&
      Array.isArray(tab.sections) && tab.sections.length > 0,
      'EXPORT_MODEL_INVALID'
    );
    tab.sections.forEach(function (section) {
      vpatRequire_(
        section && typeof section.heading === 'string' && section.heading.length > 0 && section.heading.length <= 200 &&
        Array.isArray(section.columns) && section.columns.length > 0 && Array.isArray(section.rows),
        'EXPORT_MODEL_INVALID'
      );
      var columns = {};
      section.columns.forEach(function (column) {
        vpatRequire_(typeof column === 'string' && /^[a-z][a-z0-9-]*$/.test(column) && !columns[column], 'EXPORT_MODEL_INVALID');
        columns[column] = true;
      });
      section.rows.forEach(function (row) {
        vpatRequire_(
          row && typeof row.rowId === 'string' && row.rowId.length > 0 && row.rowId.length <= 160 &&
          Array.isArray(row.cells) && row.cells.length === section.columns.length,
          'EXPORT_MODEL_INVALID'
        );
        var rowColumns = {};
        row.cells.forEach(function (cell, cellIndex) {
          vpatRequire_(
            cell && cell.columnId === section.columns[cellIndex] && columns[cell.columnId] && !rowColumns[cell.columnId],
            'EXPORT_MODEL_INVALID'
          );
          rowColumns[cell.columnId] = true;
          if (cell.kind === 'literal') {
            vpatRequire_(cell.value === null || ['string', 'number', 'boolean'].indexOf(typeof cell.value) >= 0, 'EXPORT_MODEL_INVALID');
          } else if (cell.kind === 'trusted-template-formula-reference') {
            vpatRequire_(Object.prototype.hasOwnProperty.call(VPAT_TRUSTED_FORMULAS_, cell.templateFormulaId), 'EXPORT_MODEL_INVALID');
          } else {
            vpatThrow_('EXPORT_MODEL_INVALID');
          }
        });
      });
    });
  });
  return model;
}

function vpatExportStoredAnalysis_(requestId) {
  requestId = vpatRequireRequestId_(requestId);
  var prepared = vpatWithUserLock_(function () {
    var receipt = vpatGetUserRecord_('receipt', requestId);
    if (receipt) return { receipt: receipt.value };
    var analysis = vpatGetUserRecord_('analysis', requestId);
    vpatRequire_(Boolean(analysis), 'REQUEST_NOT_FOUND');
    var analysisDigest = vpatSha256Text_(JSON.stringify(vpatCanonicalJsonValue_(analysis.value)));
    var exportModel = vpatExpectedExportModel_(analysis.value.analysisOutput);
    var claimRecord = vpatGetUserRecord_('export-claim', requestId);
    var claim = claimRecord && claimRecord.value;
    if (claim) {
      vpatRequire_(claim.requestId === requestId && claim.analysisDigest === analysisDigest, 'ANALYSIS_IMMUTABLE');
    } else {
      claim = {
        schemaVersion: '1.0.0',
        requestId: requestId,
        analysisDigest: analysisDigest,
        token: Utilities.getUuid(),
        status: 'claimed',
        claimedAt: new Date().toISOString(),
        createAttemptedAt: null,
        artifactId: null
      };
      vpatPutUserRecord_('export-claim', requestId, claim);
    }
    return { analysis: analysis.value, exportModel: exportModel, claim: claim };
  });
  if (prepared.receipt) return prepared.receipt;

  var claim = prepared.claim;
  var artifactId = claim.artifactId;
  if (!artifactId) {
    var matches = vpatFindArtifactsByClaim_(claim.token);
    vpatRequire_(matches.length <= 1, 'EXPORT_COMPLETION_AMBIGUOUS', true);
    if (matches.length === 1) {
      artifactId = matches[0];
    } else if (claim.createAttemptedAt) {
      vpatThrow_('EXPORT_COMPLETION_AMBIGUOUS', true);
    } else {
      var attempt = vpatWithUserLock_(function () {
        var currentRecord = vpatGetUserRecord_('export-claim', requestId);
        var current = currentRecord && currentRecord.value;
        vpatRequire_(current && current.token === claim.token, 'EXPORT_COMPLETION_AMBIGUOUS', true);
        if (current.createAttemptedAt) return { claim: current, mayCreate: false };
        var attempted = Object.assign({}, current, {
          createAttemptedAt: new Date().toISOString(),
          status: 'create-attempted'
        });
        vpatPutUserRecord_('export-claim', requestId, attempted);
        return { claim: attempted, mayCreate: true };
      });
      claim = attempt.claim;
      if (!attempt.mayCreate) vpatThrow_('EXPORT_COMPLETION_AMBIGUOUS', true);
      artifactId = vpatCreateClaimedSpreadsheet_(requestId, claim.token, prepared.exportModel);
    }
  }

  vpatWithUserLock_(function () {
    var currentRecord = vpatGetUserRecord_('export-claim', requestId);
    var current = currentRecord && currentRecord.value;
    vpatRequire_(current && current.token === claim.token, 'EXPORT_COMPLETION_AMBIGUOUS', true);
    vpatRequire_(!current.artifactId || current.artifactId === artifactId, 'EXPORT_COMPLETION_AMBIGUOUS', true);
    vpatPutUserRecord_('export-claim', requestId, Object.assign({}, current, {
      status: 'created', artifactId: artifactId
    }));
  });

  vpatWriteWorkbook_(artifactId, prepared.exportModel);
  var receipt = {
    schemaVersion: '1.0.0',
    requestId: requestId,
    spreadsheetId: artifactId,
    spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/' + encodeURIComponent(artifactId) + '/edit',
    completedAt: new Date().toISOString(),
    templateVersion: prepared.exportModel.provenance.templateVersion
  };
  return vpatWithUserLock_(function () {
    var existing = vpatGetUserRecord_('receipt', requestId);
    if (existing) return existing.value;
    var currentRecord = vpatGetUserRecord_('export-claim', requestId);
    var current = currentRecord && currentRecord.value;
    vpatRequire_(current && current.token === claim.token && current.artifactId === artifactId, 'EXPORT_COMPLETION_AMBIGUOUS', true);
    vpatPutUserRecord_('receipt', requestId, receipt);
    vpatPutUserRecord_('export-claim', requestId, Object.assign({}, current, { status: 'final' }));
    return receipt;
  });
}

function vpatFindArtifactsByClaim_(claimToken) {
  vpatRequire_(typeof claimToken === 'string' && /^[A-Za-z0-9-]{20,80}$/.test(claimToken), 'EXPORT_COMPLETION_AMBIGUOUS', true);
  var query = "trashed = false and mimeType = '" + VPAT_EXPORT_MIME_TYPE_ +
    "' and appProperties has { key='vpatClaimToken' and value='" + vpatEscapeDriveQuery_(claimToken) + "' }";
  var response;
  try {
    response = Drive.Files.list({ q: query, pageSize: 3, fields: 'files(id)' });
  } catch (error) {
    vpatThrow_('EXPORT_COMPLETION_AMBIGUOUS', true);
  }
  return (response.files || []).map(function (file) { return file.id; });
}

function vpatGetPrivateOutputFolder_() {
  var root = DriveApp.getRootFolder();
  var folders = root.getFoldersByName(VPAT_EXPORT_FOLDER_NAME_);
  var found = [];
  while (folders.hasNext() && found.length < 2) found.push(folders.next());
  vpatRequire_(found.length <= 1, 'EXPORT_FAILED');
  var folder = found.length === 1
    ? found[0]
    : vpatWithUserLock_(function () {
      var recheck = root.getFoldersByName(VPAT_EXPORT_FOLDER_NAME_);
      var current = [];
      while (recheck.hasNext() && current.length < 2) current.push(recheck.next());
      vpatRequire_(current.length <= 1, 'EXPORT_FAILED');
      return current.length === 1 ? current[0] : root.createFolder(VPAT_EXPORT_FOLDER_NAME_);
    });
  vpatRequire_(
    folder.getSharingAccess() === DriveApp.Access.PRIVATE &&
    folder.getEditors().length === 0 && folder.getViewers().length === 0,
    'EXPORT_FAILED'
  );
  return folder;
}

function vpatCreateClaimedSpreadsheet_(requestId, claimToken, exportModel) {
  var folder = vpatGetPrivateOutputFolder_();
  var displayName = vpatExportFileName_(exportModel.source && exportModel.source.displayName);
  var resource = {
    name: displayName,
    mimeType: VPAT_EXPORT_MIME_TYPE_,
    parents: [folder.getId()],
    appProperties: {
      vpatRequestKey: vpatRecordKey_(requestId),
      vpatClaimToken: claimToken,
      vpatTemplateVersion: VPAT_EXPORT_TEMPLATE_VERSION_
    }
  };
  try {
    var created = Drive.Files.create(resource, null, { fields: 'id' });
    vpatRequire_(created && typeof created.id === 'string', 'EXPORT_COMPLETION_AMBIGUOUS', true);
    return created.id;
  } catch (error) {
    if (error && error.vpatCode) throw error;
    vpatThrow_('EXPORT_COMPLETION_AMBIGUOUS', true);
  }
}

function vpatExportFileName_(sourceName) {
  var normalized = String(sourceName || 'VPAT').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) normalized = 'VPAT';
  return ('VPAT Analysis · ' + normalized).slice(0, 180);
}

function vpatWriteWorkbook_(spreadsheetId, exportModel) {
  vpatValidateExportModel_(exportModel, exportModel.requestId);
  var spreadsheet;
  try {
    spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    vpatNormalizeWorkbookTabs_(spreadsheet);
    var batchData = [];
    exportModel.tabs.forEach(function (tab, index) {
      var sheet = spreadsheet.getSheets()[index];
      sheet.clear();
      var values = vpatRenderTabRawValues_(tab);
      if (values.length > 0) {
        batchData.push({
          range: "'" + tab.name.replace(/'/g, "''") + "'!A1",
          majorDimension: 'ROWS',
          values: values
        });
      }
    });
    if (batchData.length > 0) {
      Sheets.Spreadsheets.Values.batchUpdate({
        valueInputOption: 'RAW',
        data: batchData
      }, spreadsheetId);
      SpreadsheetApp.flush();
    }
    exportModel.tabs.forEach(function (tab, index) {
      vpatFormatExportSheet_(spreadsheet.getSheets()[index], tab);
    });
    SpreadsheetApp.flush();
    var file = DriveApp.getFileById(spreadsheetId);
    vpatRequire_(
      file.getSharingAccess() === DriveApp.Access.PRIVATE &&
      file.getEditors().length === 0 && file.getViewers().length === 0,
      'EXPORT_FAILED'
    );
  } catch (error) {
    if (error && error.vpatCode) throw error;
    vpatThrow_('EXPORT_FAILED', true);
  }
}

function vpatNormalizeWorkbookTabs_(spreadsheet) {
  var sheets = spreadsheet.getSheets();
  while (sheets.length > 1) {
    spreadsheet.deleteSheet(sheets.pop());
  }
  sheets[0].setName(VPAT_EXPORT_TAB_NAMES_[0]);
  for (var index = 1; index < VPAT_EXPORT_TAB_NAMES_.length; index += 1) {
    spreadsheet.insertSheet(VPAT_EXPORT_TAB_NAMES_[index], index);
  }
}

function vpatRenderTabRawValues_(tab) {
  var values = [];
  tab.sections.forEach(function (section) {
    values.push([section.heading]);
    values.push(section.columns.slice());
    section.rows.forEach(function (row) {
      var cells = {};
      row.cells.forEach(function (cell) { cells[cell.columnId] = cell; });
      values.push(section.columns.map(function (columnId) {
        var cell = cells[columnId];
        if (!cell) return '';
        if (cell.kind === 'literal') return cell.value === null ? '' : cell.value;
        return VPAT_TRUSTED_FORMULAS_[cell.templateFormulaId];
      }));
    });
    values.push([]);
  });
  return values;
}

function vpatFormatExportSheet_(sheet, tab) {
  var rowCount = Math.max(1, sheet.getLastRow());
  var columnCount = Math.max(1, sheet.getLastColumn());
  sheet.setFrozenRows(Math.min(2, rowCount));
  sheet.getRange(1, 1, rowCount, columnCount)
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP)
    .setVerticalAlignment('top')
    .setFontFamily('Arial')
    .setFontSize(10);
  var sectionRow = 1;
  tab.sections.forEach(function (section) {
    sheet.getRange(sectionRow, 1, 1, columnCount)
      .setFontWeight('bold')
      .setFontSize(14)
      .setBackground('#57068C')
      .setFontColor('#FFFFFF');
    if (sectionRow + 1 <= rowCount) {
      sheet.getRange(sectionRow + 1, 1, 1, columnCount)
      .setFontWeight('bold')
      .setBackground('#EDE3F4')
      .setFontColor('#1F1F1F');
    }
    sheet.setRowHeight(sectionRow, 30);
    sectionRow += section.rows.length + 3;
  });
  for (var column = 1; column <= columnCount; column += 1) {
    sheet.setColumnWidth(column, column <= 3 ? 160 : 260);
  }
}
