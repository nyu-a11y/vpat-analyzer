var VPAT_PORTKEY_ENDPOINT_ = 'https://api.portkey.ai/v1/chat/completions';
var VPAT_QUALITY_REQUIREMENT_IDS_ = Object.freeze([
  'qr-e12', 'qr-e13', 'qr-e14', 'qr-e16', 'qr-bp24', 'qr-e11', 'qr-bp09', 'qr-bp10',
  'qr-bp11', 'qr-e09', 'qr-bp07', 'qr-e08', 'qr-bp04', 'qr-e19', 'qr-e04', 'qr-e06'
]);
var VPAT_QUALITY_EVIDENCE_FIELD_IDS_ = Object.freeze([
  'source-display-name',
  'source-type',
  'declared-wcag-versions',
  'declared-levels',
  'criterion-coverage',
  'criterion-answer-coverage',
  'conformance-terms-used',
  'conformance-term-definitions',
  'evaluation-methods',
  'assistive-technology-testing',
  'manual-testing',
  'automated-testing',
  'contact-information',
  'tester-familiarity',
  'product-description',
  'scope-notes',
  'remarks-coverage',
  'remarks-sample',
  'vpat-template-version',
  'report-date'
]);

function vpatProviderConfiguration_() {
  var properties = PropertiesService.getScriptProperties();
  var apiKey = properties.getProperty('VPAT_PORTKEY_API_KEY');
  var virtualKey = properties.getProperty('VPAT_PORTKEY_VIRTUAL_KEY');
  var model = properties.getProperty('VPAT_GEMINI_MODEL');
  vpatRequire_(
    typeof apiKey === 'string' && apiKey.length >= 8 && apiKey.length <= 512 &&
    typeof virtualKey === 'string' && virtualKey.length >= 4 && virtualKey.length <= 512 &&
    typeof model === 'string' && /^(?:@google\/)?gemini-[A-Za-z0-9._:-]{1,100}$/.test(model),
    'PROVIDER_NOT_CONFIGURED'
  );
  return { apiKey: apiKey, virtualKey: virtualKey, model: model };
}

function vpatAnalyzeWithProvider_(kind, input) {
  vpatRequire_(kind === 'conformance' || kind === 'quality', 'INVALID_REQUEST');
  var minimized = vpatMinimizeProviderPayload_(kind, input);
  var config = vpatProviderConfiguration_();
  var requestBody = {
    model: config.model,
    temperature: 0,
    messages: [
      {
        role: 'system',
        content: vpatProviderSystemPrompt_(kind)
      },
      { role: 'user', content: JSON.stringify(minimized) }
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: kind === 'conformance' ? 'vpat_conformance_response_v1' : 'vpat_quality_response_v1',
        strict: true,
        schema: vpatProviderResponseSchema_(kind)
      }
    }
  };
  var response;
  try {
    response = UrlFetchApp.fetch(VPAT_PORTKEY_ENDPOINT_, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'x-portkey-api-key': config.apiKey,
        'x-portkey-virtual-key': config.virtualKey,
        'x-portkey-provider': 'google'
      },
      payload: JSON.stringify(requestBody),
      muteHttpExceptions: true
    });
  } catch (error) {
    vpatThrow_('PROVIDER_ERROR', true);
  }
  var statusCode = response.getResponseCode();
  if (statusCode < 200 || statusCode >= 300) {
    vpatThrow_('PROVIDER_ERROR', statusCode === 429 || statusCode >= 500);
  }
  var responseBody;
  try {
    responseBody = JSON.parse(response.getContentText());
  } catch (error) {
    vpatThrow_('PROVIDER_RESPONSE_INVALID', true);
  }
  var content = responseBody && responseBody.choices && responseBody.choices[0] &&
    responseBody.choices[0].message && responseBody.choices[0].message.content;
  vpatRequire_(
    typeof content === 'string' && vpatUtf8Length_(content) <= VPAT_MAX_PROVIDER_RESPONSE_BYTES_,
    'PROVIDER_RESPONSE_INVALID',
    true
  );
  var parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    vpatThrow_('PROVIDER_RESPONSE_INVALID', true);
  }
  vpatRequire_(
    parsed && typeof parsed === 'object' && !Array.isArray(parsed),
    'PROVIDER_RESPONSE_INVALID',
    true
  );
  try {
    vpatValidateProviderResponseEnvelope_(kind, minimized, parsed);
  } catch (error) {
    if (error && error.vpatCode === 'PROVIDER_RESPONSE_INVALID') error.vpatRetryable = true;
    throw error;
  }
  return parsed;
}

function vpatMinimizeProviderPayload_(kind, input) {
  vpatRequire_(input && typeof input === 'object' && !Array.isArray(input), 'INVALID_REQUEST');
  var requestId = vpatRequireRequestId_(input.requestId);
  vpatRequire_(input.promptVersion === '1.0.0', 'INVALID_REQUEST');
  var versions = input.contractVersions || {};
  vpatRequire_(
    versions.catalogVersion === '1.0.0' && versions.rubricVersion === '1.0.0' && versions.schemaVersion === '1.0.0',
    'INVALID_REQUEST'
  );
  var result = {
    requestId: requestId,
    promptVersion: '1.0.0',
    contractVersions: {
      catalogVersion: '1.0.0', rubricVersion: '1.0.0', schemaVersion: '1.0.0'
    }
  };
  if (kind === 'conformance') {
    vpatRequire_(Array.isArray(input.expectedCriteria) && input.expectedCriteria.length > 0 && input.expectedCriteria.length <= 87, 'INVALID_REQUEST');
    result.catalogVersion = '1.0.0';
    result.confidenceThreshold = 70;
    result.expectedCriteria = input.expectedCriteria.map(function (row) {
      vpatRequire_(row && /^wcag-sc-[1-4]\.[1-9][0-9]*\.[1-9][0-9]*$/.test(row.criterionId), 'INVALID_REQUEST');
      return {
        criterionId: row.criterionId,
        sc: vpatProviderText_(row.sc, 20),
        title: vpatProviderText_(row.title, 200),
        level: vpatProviderAllowed_(row.level, ['A', 'AA', 'AAA']),
        sourceCriterionLabel: vpatProviderText_(row.sourceCriterionLabel, 1000),
        sourceConformance: vpatProviderText_(row.sourceConformance, 4000),
        sourceRemarks: vpatProviderText_(row.sourceRemarks, 4000)
      };
    });
    return result;
  }
  vpatRequire_(Array.isArray(input.expectedRequirements) && input.expectedRequirements.length === 16, 'INVALID_REQUEST');
  var remaining = 20000;
  result.rubricVersion = '1.0.0';
  result.confidenceThreshold = 70;
  result.expectedRequirements = input.expectedRequirements.map(function (requirement, index) {
    vpatRequire_(requirement && requirement.requirementId === VPAT_QUALITY_REQUIREMENT_IDS_[index], 'INVALID_REQUEST');
    var rubricRequirement = vpatProviderRubricRequirement_(index);
    vpatRequire_(
      JSON.stringify(vpatCanonicalJsonValue_({
        requirementId: requirement.requirementId,
        aliases: requirement.aliases,
        title: requirement.title,
        type: requirement.type,
        impact: requirement.impact,
        description: requirement.description,
        guidance: requirement.guidance
      })) === JSON.stringify(vpatCanonicalJsonValue_({
        requirementId: rubricRequirement.id,
        aliases: rubricRequirement.aliases,
        title: rubricRequirement.title,
        type: rubricRequirement.type,
        impact: rubricRequirement.impact,
        description: rubricRequirement.description,
        guidance: rubricRequirement.guidance
      })),
      'INVALID_REQUEST'
    );
    vpatRequire_(Array.isArray(requirement.evidence) && requirement.evidence.length <= 16, 'INVALID_REQUEST');
    var evidence = requirement.evidence.map(function (item) {
      vpatRequire_(item && VPAT_QUALITY_EVIDENCE_FIELD_IDS_.indexOf(item.fieldId) >= 0, 'INVALID_REQUEST');
      var value = vpatProviderText_(item.value, Math.min(4000, remaining));
      vpatRequire_(value.length > 0, 'INVALID_REQUEST');
      remaining -= value.length;
      vpatRequire_(remaining >= 0, 'RESOURCE_LIMIT_EXCEEDED');
      return { fieldId: item.fieldId, value: value };
    });
    return {
      requirementId: requirement.requirementId,
      aliases: Array.isArray(requirement.aliases) ? requirement.aliases.slice(0, 3).map(function (value) { return vpatProviderText_(value, 32); }) : [],
      title: vpatProviderText_(requirement.title, 200),
      type: vpatProviderAllowed_(requirement.type, ['Essential', 'Best Practice']),
      impact: {
        weight: Number(requirement.impact && requirement.impact.weight),
        label: vpatProviderText_(requirement.impact && requirement.impact.label, 40)
      },
      description: vpatProviderText_(requirement.description, 1000),
      guidance: vpatProviderText_(requirement.guidance, 1000),
      evidence: evidence
    };
  });
  return result;
}

function vpatProviderRubricRequirement_(index) {
  vpatRequire_(
    typeof VPAT_QUALITY_RUBRIC_ === 'object' && VPAT_QUALITY_RUBRIC_ &&
    VPAT_QUALITY_RUBRIC_.version === '1.0.0' &&
    Array.isArray(VPAT_QUALITY_RUBRIC_.requirements) && VPAT_QUALITY_RUBRIC_.requirements.length === 16,
    'INTERNAL_ERROR'
  );
  var requirement = VPAT_QUALITY_RUBRIC_.requirements[index];
  vpatRequire_(requirement && requirement.id === VPAT_QUALITY_REQUIREMENT_IDS_[index], 'INTERNAL_ERROR');
  return requirement;
}

function vpatProviderAllowed_(value, allowed) {
  vpatRequire_(allowed.indexOf(value) >= 0, 'INVALID_REQUEST');
  return value;
}

function vpatProviderSystemPrompt_(kind) {
  var prompt = kind === 'conformance'
    ? (typeof VPAT_CONFORMANCE_SYSTEM_PROMPT_ === 'string' ? VPAT_CONFORMANCE_SYSTEM_PROMPT_ : '')
    : (typeof VPAT_QUALITY_SYSTEM_PROMPT_ === 'string' ? VPAT_QUALITY_SYSTEM_PROMPT_ : '');
  vpatRequire_(prompt.length > 0 && prompt.length <= 30000, 'PROVIDER_NOT_CONFIGURED');
  return prompt;
}

function vpatProviderText_(value, limit) {
  return String(value === undefined || value === null ? '' : value).replace(/\u0000/g, '').slice(0, limit);
}

function vpatProviderEnumList_(value, allowed) {
  vpatRequire_(Array.isArray(value) && value.length > 0 && value.length <= allowed.length, 'INVALID_REQUEST');
  var seen = {};
  return value.map(function (item) {
    vpatRequire_(allowed.indexOf(item) >= 0 && !seen[item], 'INVALID_REQUEST');
    seen[item] = true;
    return item;
  });
}

function vpatProviderResponseSchema_(kind) {
  vpatRequire_(kind === 'conformance' || kind === 'quality', 'INVALID_REQUEST');
  var evidence = { type: 'string', minLength: 1, maxLength: 4000 };
  if (kind === 'conformance') {
    return {
      type: 'object', additionalProperties: false,
      required: ['schemaVersion', 'task', 'requestId', 'catalogVersion', 'promptVersion', 'findings'],
      properties: {
        schemaVersion: { const: '1.0.0' }, task: { const: 'conformance-analysis' },
        requestId: { type: 'string', minLength: 1, maxLength: 128 },
        catalogVersion: { const: '1.0.0' }, promptVersion: { const: '1.0.0' },
        findings: {
          type: 'array', minItems: 1, maxItems: 87,
          items: { oneOf: [{ '$ref': '#/$defs/completeFinding' }, { '$ref': '#/$defs/incompleteFinding' }] }
        }
      },
      '$defs': {
        completeFinding: {
          type: 'object', additionalProperties: false,
          required: ['criterionId', 'status', 'normalizedConformance', 'evidence', 'confidence', 'reviewRequired'],
          properties: {
            criterionId: { type: 'string', pattern: '^wcag-sc-[1-4]\\.[1-9][0-9]*\\.[1-9][0-9]*$' },
            status: { const: 'Complete' },
            normalizedConformance: {
              enum: ['Supports', 'Partially Supports', 'Does Not Support', 'Not Applicable', 'Not Evaluated']
            },
            evidence: evidence,
            confidence: { type: 'integer', minimum: 0, maximum: 100 },
            reviewRequired: { type: 'boolean' }
          }
        },
        incompleteFinding: {
          type: 'object', additionalProperties: false,
          required: [
            'criterionId', 'status', 'normalizedConformance', 'evidence',
            'confidence', 'reviewRequired', 'incompleteReason'
          ],
          properties: {
            criterionId: { type: 'string', pattern: '^wcag-sc-[1-4]\\.[1-9][0-9]*\\.[1-9][0-9]*$' },
            status: { const: 'Incomplete' },
            normalizedConformance: { type: 'null' },
            evidence: evidence,
            confidence: { type: 'null' },
            reviewRequired: { const: true },
            incompleteReason: {
              enum: ['INSUFFICIENT_EVIDENCE', 'CONTRADICTORY_EVIDENCE', 'UNRECOGNIZED_CONFORMANCE_TERM']
            }
          }
        }
      }
    };
  }
  return {
    type: 'object', additionalProperties: false,
    required: ['schemaVersion', 'task', 'requestId', 'rubricVersion', 'promptVersion', 'findings'],
    properties: {
      schemaVersion: { const: '1.0.0' }, task: { const: 'quality-analysis' },
      requestId: { type: 'string', minLength: 1, maxLength: 128 },
      rubricVersion: { const: '1.0.0' }, promptVersion: { const: '1.0.0' },
      findings: {
        type: 'array', minItems: 16, maxItems: 16,
        items: { oneOf: [{ '$ref': '#/$defs/completeFinding' }, { '$ref': '#/$defs/incompleteFinding' }] }
      }
    },
    '$defs': {
      completeFinding: {
        type: 'object', additionalProperties: false,
        required: ['requirementId', 'status', 'result', 'evidence', 'guidance', 'confidence', 'reviewRequired'],
        properties: {
          requirementId: { enum: VPAT_QUALITY_REQUIREMENT_IDS_.slice() },
          status: { const: 'Complete' },
          result: { enum: ['Pass', 'Fail'] },
          evidence: evidence,
          guidance: { type: 'string', minLength: 1, maxLength: 4000 },
          confidence: { type: 'integer', minimum: 0, maximum: 100 },
          reviewRequired: { type: 'boolean' }
        }
      },
      incompleteFinding: {
          type: 'object', additionalProperties: false,
        required: [
          'requirementId', 'status', 'result', 'evidence', 'guidance',
          'confidence', 'reviewRequired', 'incompleteReason'
        ],
        properties: {
          requirementId: { enum: VPAT_QUALITY_REQUIREMENT_IDS_.slice() },
          status: { const: 'Incomplete' },
          result: { const: 'Incomplete' },
          evidence: evidence,
          guidance: { type: 'string', minLength: 1, maxLength: 4000 },
          confidence: { type: 'null' },
          reviewRequired: { const: true },
          incompleteReason: {
            enum: ['MISSING_INPUT_EVIDENCE', 'CONTRADICTORY_INPUT_EVIDENCE', 'TRUNCATED_INPUT_EVIDENCE']
          }
        }
      }
    }
  };
}

function vpatValidateProviderResponseEnvelope_(kind, input, response) {
  vpatRequireClosedObject_(
    response,
    kind === 'conformance'
      ? ['schemaVersion', 'task', 'requestId', 'catalogVersion', 'promptVersion', 'findings']
      : ['schemaVersion', 'task', 'requestId', 'rubricVersion', 'promptVersion', 'findings'],
    'PROVIDER_RESPONSE_INVALID'
  );
  vpatRequire_(
    response.schemaVersion === '1.0.0' && response.requestId === input.requestId && response.promptVersion === '1.0.0' &&
    response.task === (kind === 'conformance' ? 'conformance-analysis' : 'quality-analysis') && Array.isArray(response.findings),
    'PROVIDER_RESPONSE_INVALID'
  );
  if (kind === 'conformance') {
    vpatRequire_(response.catalogVersion === '1.0.0' && response.findings.length === input.expectedCriteria.length, 'PROVIDER_RESPONSE_INVALID');
    var expected = {};
    input.expectedCriteria.forEach(function (row) { expected[row.criterionId] = true; });
    response.findings.forEach(function (finding, index) {
      vpatRequire_(
        finding && input.expectedCriteria[index].criterionId === finding.criterionId && expected[finding.criterionId],
        'PROVIDER_RESPONSE_INVALID'
      );
      delete expected[finding.criterionId];
      vpatValidateConformanceFinding_(finding);
    });
    vpatRequire_(Object.keys(expected).length === 0, 'PROVIDER_RESPONSE_INVALID');
    return;
  }
  vpatRequire_(response.rubricVersion === '1.0.0' && response.findings.length === 16, 'PROVIDER_RESPONSE_INVALID');
  response.findings.forEach(function (finding, index) {
    vpatRequire_(finding && finding.requirementId === VPAT_QUALITY_REQUIREMENT_IDS_[index], 'PROVIDER_RESPONSE_INVALID');
    vpatValidateQualityFinding_(finding);
  });
}

function vpatValidateConformanceFinding_(finding) {
  vpatRequire_(finding && (finding.status === 'Complete' || finding.status === 'Incomplete'), 'PROVIDER_RESPONSE_INVALID');
  vpatRequireClosedObject_(
    finding,
    finding.status === 'Complete'
      ? ['criterionId', 'status', 'normalizedConformance', 'evidence', 'confidence', 'reviewRequired']
      : ['criterionId', 'status', 'normalizedConformance', 'evidence', 'confidence', 'reviewRequired', 'incompleteReason'],
    'PROVIDER_RESPONSE_INVALID'
  );
  vpatRequire_(typeof finding.evidence === 'string' && finding.evidence.length > 0 && finding.evidence.length <= 4000, 'PROVIDER_RESPONSE_INVALID');
  if (finding.status === 'Complete') {
    vpatRequire_([
      'Supports', 'Partially Supports', 'Does Not Support', 'Not Applicable', 'Not Evaluated'
    ].indexOf(finding.normalizedConformance) >= 0 && Number.isInteger(finding.confidence) &&
      finding.confidence >= 0 && finding.confidence <= 100 && typeof finding.reviewRequired === 'boolean', 'PROVIDER_RESPONSE_INVALID');
  } else {
    vpatRequire_(finding.status === 'Incomplete' && finding.normalizedConformance === null && finding.confidence === null &&
      finding.reviewRequired === true && ['INSUFFICIENT_EVIDENCE', 'CONTRADICTORY_EVIDENCE', 'UNRECOGNIZED_CONFORMANCE_TERM'].indexOf(finding.incompleteReason) >= 0,
    'PROVIDER_RESPONSE_INVALID');
  }
}

function vpatValidateQualityFinding_(finding) {
  vpatRequire_(finding && (finding.status === 'Complete' || finding.status === 'Incomplete'), 'PROVIDER_RESPONSE_INVALID');
  vpatRequireClosedObject_(
    finding,
    finding.status === 'Complete'
      ? ['requirementId', 'status', 'result', 'evidence', 'guidance', 'confidence', 'reviewRequired']
      : ['requirementId', 'status', 'result', 'evidence', 'guidance', 'confidence', 'reviewRequired', 'incompleteReason'],
    'PROVIDER_RESPONSE_INVALID'
  );
  vpatRequire_(
    typeof finding.evidence === 'string' && finding.evidence.length > 0 && finding.evidence.length <= 4000 &&
    typeof finding.guidance === 'string' && finding.guidance.length > 0 && finding.guidance.length <= 4000,
    'PROVIDER_RESPONSE_INVALID'
  );
  if (finding.status === 'Complete') {
    vpatRequire_((finding.result === 'Pass' || finding.result === 'Fail') && Number.isInteger(finding.confidence) &&
      finding.confidence >= 0 && finding.confidence <= 100 && typeof finding.reviewRequired === 'boolean', 'PROVIDER_RESPONSE_INVALID');
  } else {
    vpatRequire_(finding.status === 'Incomplete' && finding.result === 'Incomplete' && finding.confidence === null &&
      finding.reviewRequired === true && ['MISSING_INPUT_EVIDENCE', 'CONTRADICTORY_INPUT_EVIDENCE', 'TRUNCATED_INPUT_EVIDENCE'].indexOf(finding.incompleteReason) >= 0,
    'PROVIDER_RESPONSE_INVALID');
  }
}
