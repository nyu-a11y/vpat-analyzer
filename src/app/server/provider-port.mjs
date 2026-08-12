import { SERVER_LIMITS, ServerContractError, requireRequestId, utf8ByteLength } from './server-contracts.mjs';

const PORTKEY_ENDPOINT = 'https://api.portkey.ai/v1/chat/completions';
const ANALYSIS_KINDS = new Set(['conformance', 'quality']);
const QUALITY_REQUIREMENT_IDS = Object.freeze([
  'qr-e12', 'qr-e13', 'qr-e14', 'qr-e16', 'qr-bp24', 'qr-e11', 'qr-bp09', 'qr-bp10',
  'qr-bp11', 'qr-e09', 'qr-bp07', 'qr-e08', 'qr-bp04', 'qr-e19', 'qr-e04', 'qr-e06'
]);
const QUALITY_EVIDENCE_FIELD_IDS = new Set([
  'source-display-name', 'source-type', 'declared-wcag-versions', 'declared-levels',
  'criterion-coverage', 'criterion-answer-coverage', 'conformance-terms-used',
  'conformance-term-definitions', 'evaluation-methods', 'assistive-technology-testing',
  'manual-testing', 'automated-testing', 'contact-information', 'tester-familiarity',
  'product-description', 'scope-notes', 'remarks-coverage', 'remarks-sample',
  'vpat-template-version', 'report-date'
]);

function boundedText(value, max = SERVER_LIMITS.maxProviderTextChars) {
  return String(value ?? '').replace(/\u0000/g, '').slice(0, max);
}

function requireString(value, max = 160) {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) {
    throw new ServerContractError('INVALID_REQUEST');
  }
  return value;
}

export function readProviderConfiguration(properties) {
  const apiKey = properties.get('VPAT_PORTKEY_API_KEY');
  const virtualKey = properties.get('VPAT_PORTKEY_VIRTUAL_KEY');
  const model = properties.get('VPAT_GEMINI_MODEL');
  if (
    typeof apiKey !== 'string' || apiKey.length < 8 || apiKey.length > 512 ||
    typeof virtualKey !== 'string' || virtualKey.length < 4 || virtualKey.length > 512 ||
    typeof model !== 'string'
  ) throw new ServerContractError('PROVIDER_NOT_CONFIGURED');
  if (!/^(?:@google\/)?gemini-[a-z0-9._:-]{1,100}$/i.test(model)) throw new ServerContractError('PROVIDER_NOT_CONFIGURED');
  return Object.freeze({ endpoint: PORTKEY_ENDPOINT, apiKey, virtualKey, model });
}

export function minimizeProviderPayload(kind, input) {
  if (!ANALYSIS_KINDS.has(kind) || !input || typeof input !== 'object') {
    throw new ServerContractError('INVALID_REQUEST');
  }
  const requestId = requireRequestId(input.requestId);
  const promptVersion = requireString(input.promptVersion, 40);
  const contractVersions = Object.fromEntries(
    ['catalogVersion', 'rubricVersion', 'schemaVersion'].map((key) => [key, requireString(input.contractVersions?.[key], 40)])
  );
  if (kind === 'conformance') {
    const expectedCriteria = input.expectedCriteria || input.rows;
    if (!Array.isArray(expectedCriteria) || expectedCriteria.length < 1 || expectedCriteria.length > SERVER_LIMITS.maxProviderRows) {
      throw new ServerContractError('INVALID_REQUEST');
    }
    return {
      requestId,
      promptVersion,
      contractVersions,
      catalogVersion: '1.0.0',
      confidenceThreshold: 70,
      expectedCriteria: expectedCriteria.map((row) => ({
        criterionId: requireString(row?.criterionId, 80),
        sc: boundedText(row?.sc, 20),
        title: boundedText(row?.title, 200),
        level: requireString(row?.level, 3),
        sourceCriterionLabel: boundedText(row?.sourceCriterionLabel, 1000),
        sourceConformance: boundedText(row?.sourceConformance),
        sourceRemarks: boundedText(row?.sourceRemarks)
      }))
    };
  }
  const expectedRequirements = input.expectedRequirements;
  if (!Array.isArray(expectedRequirements) || expectedRequirements.length !== 16) {
    throw new ServerContractError('INVALID_REQUEST');
  }
  let remaining = SERVER_LIMITS.maxProviderContextChars;
  return {
    requestId,
    promptVersion,
    contractVersions,
    rubricVersion: '1.0.0',
    confidenceThreshold: 70,
    expectedRequirements: expectedRequirements.map((requirement, index) => {
      const requirementId = requireString(requirement.requirementId, 80);
      if (requirementId !== QUALITY_REQUIREMENT_IDS[index]) throw new ServerContractError('INVALID_REQUEST');
      return {
        requirementId,
        aliases: Array.isArray(requirement.aliases) ? requirement.aliases.slice(0, 3).map((value) => requireString(value, 32)) : [],
        title: boundedText(requirement.title, 200),
        type: requireString(requirement.type, 32),
        impact: { weight: Number(requirement.impact?.weight), label: boundedText(requirement.impact?.label, 40) },
        description: boundedText(requirement.description, 1000),
        guidance: boundedText(requirement.guidance, 1000),
        evidence: (Array.isArray(requirement.evidence) ? requirement.evidence.slice(0, 16) : []).map((item) => {
        const value = boundedText(item?.value, Math.min(SERVER_LIMITS.maxProviderTextChars, remaining));
        remaining -= value.length;
        const fieldId = requireString(item?.fieldId, 64);
        if (remaining < 0) throw new ServerContractError('RESOURCE_LIMIT_EXCEEDED');
        if (!QUALITY_EVIDENCE_FIELD_IDS.has(fieldId) || value.length === 0) {
          throw new ServerContractError('INVALID_REQUEST');
        }
        return { fieldId, value };
        })
      };
    })
  };
}

export function buildPortkeyRequest(kind, input, configuration, contractData) {
  const minimized = minimizeProviderPayload(kind, input);
  const schemaName = kind === 'conformance' ? 'vpat_conformance_response_v1' : 'vpat_quality_response_v1';
  const systemPrompt = kind === 'conformance'
    ? contractData?.systemPrompts?.conformance
    : contractData?.systemPrompts?.quality;
  if (typeof systemPrompt !== 'string' || systemPrompt.length < 1 || systemPrompt.length > 30_000) {
    throw new ServerContractError('PROVIDER_NOT_CONFIGURED');
  }
  return {
    url: configuration.endpoint,
    method: 'post',
    headers: {
      'x-portkey-api-key': configuration.apiKey,
      'x-portkey-virtual-key': configuration.virtualKey,
      'x-portkey-provider': 'google',
      'content-type': 'application/json'
    },
    body: {
      model: configuration.model,
      temperature: 0,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify(minimized) }
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: schemaName, strict: true, schema: providerResponseSchema(kind) }
      }
    }
  };
}

function providerResponseSchema(kind) {
  const identity = kind === 'conformance'
    ? { task: { const: 'conformance-analysis' }, version: { catalogVersion: { const: '1.0.0' } }, id: 'criterionId' }
    : { task: { const: 'quality-analysis' }, version: { rubricVersion: { const: '1.0.0' } }, id: 'requirementId' };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['schemaVersion', 'task', 'requestId', ...Object.keys(identity.version), 'promptVersion', 'findings'],
    properties: {
      schemaVersion: { const: '1.0.0' },
      task: identity.task,
      requestId: { type: 'string', minLength: 1, maxLength: 128 },
      ...identity.version,
      promptVersion: { const: '1.0.0' },
      findings: {
        type: 'array',
        minItems: kind === 'quality' ? 16 : 1,
        maxItems: kind === 'quality' ? 16 : 87,
        items: {
          type: 'object',
          required: [identity.id, 'status', 'evidence', 'confidence', 'reviewRequired'],
          properties: {
            [identity.id]: { type: 'string' },
            status: { enum: ['Complete', 'Incomplete'] },
            evidence: { type: 'string', minLength: 1, maxLength: 4000 },
            confidence: { type: ['integer', 'null'], minimum: 0, maximum: 100 },
            reviewRequired: { type: 'boolean' }
          }
        }
      }
    }
  };
}

export function parsePortkeyResponse(statusCode, bodyText) {
  if (!Number.isInteger(statusCode) || statusCode < 200 || statusCode >= 300) {
    throw new ServerContractError('PROVIDER_ERROR', { retryable: statusCode === 429 || statusCode >= 500 });
  }
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    throw new ServerContractError('PROVIDER_RESPONSE_INVALID', { retryable: true });
  }
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || utf8ByteLength(content) > SERVER_LIMITS.maxProviderResponseBytes) {
    throw new ServerContractError('PROVIDER_RESPONSE_INVALID', { retryable: true });
  }
  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not-object');
    return parsed;
  } catch {
    throw new ServerContractError('PROVIDER_RESPONSE_INVALID', { retryable: true });
  }
}
