import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "playwright-core";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function parseArgs(argv) {
  const options = {
    local: false,
    url: process.env.STAGE0_HARNESS_URL ?? "",
    headed: false,
    profile: "",
    timeoutMs: 10 * 60 * 1000,
    output: "output/stage0-live/proof-summary.json",
    buildManifest: "build/stage0/build-manifest.json",
  };
  let outputWasSet = false;
  let urlWasSet = false;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--local") options.local = true;
    else if (value === "--headed") options.headed = true;
    else if (value === "--url") {
      options.url = argv[++index] ?? "";
      urlWasSet = true;
    }
    else if (value === "--profile") options.profile = argv[++index] ?? "";
    else if (value === "--timeout-ms") options.timeoutMs = Number(argv[++index]);
    else if (value === "--output") {
      options.output = argv[++index] ?? "";
      outputWasSet = true;
    } else if (value === "--build-manifest") options.buildManifest = argv[++index] ?? "";
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (options.local) {
    if (urlWasSet) throw new Error("--local cannot be combined with --url.");
    options.url = pathToFileURL(resolve(ROOT, "build/stage0/local-proof.html")).href;
    if (!outputWasSet) options.output = "output/stage0-local/proof-summary.json";
  } else if (!/^https:\/\//.test(options.url)) {
    throw new Error("A deployed HTTPS harness URL is required via --url or STAGE0_HARNESS_URL.");
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 30_000) {
    throw new Error("--timeout-ms must be an integer of at least 30000.");
  }
  if (!options.output || !options.buildManifest) throw new Error("Output and build-manifest paths must not be empty.");
  return options;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function same(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function safeErrorName(error) {
  const name = error instanceof Error ? error.name : "Error";
  return /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name) ? name : "Error";
}

function namedCounts(values) {
  const safeValues = values.map(value => {
    const name = String(value ?? "unknown");
    return /^[a-z0-9_.:-]{1,100}$/i.test(name) ? name : "unknown";
  });
  return [...new Set(safeValues)]
    .sort((left, right) => left.localeCompare(right, "en-US"))
    .map(name => ({ name, count: safeValues.filter(value => value === name).length }));
}

function classifyRequest(rawUrl, { initialUrl, mode, phase, resourceType }) {
  if (["worker", "serviceworker"].includes(resourceType)) return "worker-request";
  try {
    const url = new URL(rawUrl);
    const initial = new URL(initialUrl);
    if (mode === "local") {
      return url.protocol === "file:" && url.href === initial.href
        ? "local-document"
        : "unexpected-origin";
    }
    if (url.href === initial.href) return "initial-deployment-navigation";
    const isScriptHost =
      url.hostname === "script.google.com" ||
      url.hostname === "script.googleusercontent.com" ||
      url.hostname.endsWith(".script.googleusercontent.com") ||
      url.hostname.endsWith("-script.googleusercontent.com");
    if (isScriptHost && /(?:^|\/)(?:macros|userCodeAppPanel|static\/macros)(?:\/|$)/.test(url.pathname)) {
      return phase === "proof" ? "google-htmlservice-rpc" : "google-htmlservice-bootstrap";
    }
    if (
      phase === "bootstrap" &&
      ["www.gstatic.com", "ssl.gstatic.com"].includes(url.hostname) &&
      /^(?:\/docs\/script\/|\/_\/scs\/)/.test(url.pathname)
    ) return "google-static-bootstrap";
    if (phase === "bootstrap" && url.hostname === "accounts.google.com" && resourceType === "document") {
      return "google-auth-bootstrap";
    }
    return "unexpected-origin";
  } catch {
    return "invalid-url";
  }
}

function isAllowedClassification(classification) {
  return !["unexpected-origin", "invalid-url", "worker-request"].includes(classification);
}

function directiveNames(value) {
  if (typeof value !== "string") return [];
  return value
    .split(";")
    .map(part => part.trim().split(/\s+/, 1)[0]?.toLocaleLowerCase("en-US"))
    .filter(name => /^[a-z][a-z0-9-]{0,63}$/.test(name));
}

async function findFrameWithButton(page, buttonName, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      try {
        if (await frame.getByRole("button", { name: buttonName }).count() === 1) return frame;
      } catch {
        // Frames can detach while HtmlService redirects and creates its sandbox.
      }
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  throw new Error("The Stage 0 proof frame did not expose its authorized run control.");
}

function countLeaves(value) {
  if (Array.isArray(value)) return value.reduce((total, item) => total + countLeaves(item), 0);
  if (value && typeof value === "object") {
    return Object.values(value).reduce((total, item) => total + countLeaves(item), 0);
  }
  return 1;
}

function privacyFlags(value) {
  const text = stableStringify(value);
  return {
    containsDeploymentBinding:
      /script\.google(?:usercontent)?\.com|\/macros\/s\/|"(?:deploymentId|deploymentUrl|harnessUrl|url)"\s*:/i.test(text),
    containsDriveIds:
      /"(?:fileId|documentId|driveId|propertyKey|profile|base64|bytesBase64)"\s*:|\/d\/[A-Za-z0-9_-]{20,}/i.test(text),
    containsSourceContent:
      /"(?:sourceCriterionLabel|sourceConformance|sourceRemarks|sourceLabel|bodyProse|candidateDocument|base64|bytesBase64)"\s*:|Northstar Collaboration Suite|Synthetic evidence/i.test(text),
  };
}

function fixtureBinding(item) {
  return {
    caseKey: item.caseKey,
    sourceType: item.sourceType,
    expectedStatus: item.expectedStatus,
    expectedCode: item.expectedCode ?? null,
    fixtureSha256: item.expectedSha256 ?? null,
    expectedBytes: item.expectedBytes ?? null,
    expectedChunkCount: item.expectedChunkCount ?? null,
    expectedProjectionSha256: item.expectedProjectionSha256 ?? null,
  };
}

function normalizeCase(rawCase, expected, mode) {
  if (!rawCase || !["complete", "rejected"].includes(rawCase.observedStatus)) return null;
  const observedCode = typeof rawCase.observedCode === "string" ? rawCase.observedCode : null;
  const fixtureSha256 = SHA256_PATTERN.test(rawCase.fixtureSha256) ? rawCase.fixtureSha256 : null;
  const projectionSha256 = SHA256_PATTERN.test(rawCase.projectionSha256) ? rawCase.projectionSha256 : null;
  const byteLength = Number.isInteger(rawCase.byteLength) && rawCase.byteLength >= 0 ? rawCase.byteLength : null;
  const rawChunkCount = Number.isInteger(rawCase.chunkCount) && rawCase.chunkCount >= 0 ? rawCase.chunkCount : null;
  const chunkCount = mode === "live" ? rawChunkCount : null;
  const rawBatchCount = Number.isInteger(rawCase.batchCount) && rawCase.batchCount >= 0 ? rawCase.batchCount : null;
  const batchCount = mode === "live" ? rawBatchCount : null;
  const elapsedMs = Number.isFinite(rawCase.elapsedMs) && rawCase.elapsedMs >= 0 ? rawCase.elapsedMs : 0;
  const withinObservedDeadline =
    rawCase.withinObservedDeadline === true && elapsedMs <= expected.maxObservedDurationMs;
  const expectedFixtureSha256 = expected.expectedSha256 ?? null;
  const expectedBytes = expected.expectedBytes ?? null;
  const isNonBinaryLiveCase = expected.sourceType === "google-doc" || expected.accessProof;
  const expectedChunkCount = mode === "live"
    ? (isNonBinaryLiveCase ? 0 : expected.expectedChunkCount)
    : null;
  const expectedBatchCount = mode === "live"
    ? (isNonBinaryLiveCase ? 0 : Math.ceil(expected.expectedChunkCount / buildManifest.transport.chunkBatchSize))
    : null;
  const expectedProjectionSha256 = expected.expectedProjectionSha256 ?? null;
  const bindingPass =
    rawCase.expectedStatus === expected.expectedStatus &&
    (rawCase.expectedCode ?? null) === (expected.expectedCode ?? null) &&
    rawCase.observedStatus === expected.expectedStatus &&
    observedCode === (expected.expectedCode ?? null) &&
    fixtureSha256 === expectedFixtureSha256 &&
    byteLength === expectedBytes &&
    chunkCount === expectedChunkCount &&
    batchCount === expectedBatchCount &&
    projectionSha256 === expectedProjectionSha256 &&
    Number(rawCase.maxObservedDurationMs) === expected.maxObservedDurationMs &&
    withinObservedDeadline &&
    rawCase.passed === true;
  return {
    caseKey: expected.caseKey,
    expectedStatus: expected.expectedStatus,
    expectedCode: expected.expectedCode ?? null,
    observedStatus: rawCase.observedStatus,
    observedCode,
    fixtureSha256,
    byteLength,
    chunkCount,
    batchCount,
    projectionSha256,
    elapsedMs,
    maxObservedDurationMs: expected.maxObservedDurationMs,
    withinObservedDeadline,
    passed: bindingPass,
  };
}

function normalizeMemory(rawMemory, memoryPolicy) {
  if (!rawMemory || typeof rawMemory !== "object") return null;
  const integerOrNull = value => Number.isInteger(value) && value >= 0 ? value : null;
  const supported = rawMemory.supported === true;
  const sampleCount = Number.isInteger(rawMemory.sampleCount) && rawMemory.sampleCount >= 0
    ? rawMemory.sampleCount
    : 0;
  const beforeBytes = integerOrNull(rawMemory.beforeBytes);
  const sampledPeakBytes = integerOrNull(rawMemory.sampledPeakBytes);
  const afterBytes = integerOrNull(rawMemory.afterBytes);
  const sampledGrowthBytes = integerOrNull(rawMemory.sampledGrowthBytes);
  const withinLimit =
    supported &&
    rawMemory.measurement === memoryPolicy.measurement &&
    sampleCount >= 2 &&
    beforeBytes !== null &&
    sampledPeakBytes !== null &&
    afterBytes !== null &&
    sampledGrowthBytes !== null &&
    sampledPeakBytes <= memoryPolicy.maxSampledPeakBytes &&
    sampledGrowthBytes <= memoryPolicy.maxSampledGrowthBytes &&
    (rawMemory.limitPeakBytes === undefined || rawMemory.limitPeakBytes === memoryPolicy.maxSampledPeakBytes) &&
    (rawMemory.limitGrowthBytes === undefined || rawMemory.limitGrowthBytes === memoryPolicy.maxSampledGrowthBytes) &&
    rawMemory.withinLimit === true;
  return {
    supported,
    measurement: memoryPolicy.measurement,
    sampleCount,
    beforeBytes,
    sampledPeakBytes,
    afterBytes,
    sampledGrowthBytes,
    limitPeakBytes: memoryPolicy.maxSampledPeakBytes,
    limitGrowthBytes: memoryPolicy.maxSampledGrowthBytes,
    withinLimit,
  };
}

function resolvePointer(rootSchema, pointer) {
  return pointer
    .slice(2)
    .split("/")
    .map(part => part.replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce((value, key) => value?.[key], rootSchema);
}

function matchesType(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return Number.isFinite(value);
  return typeof value === type;
}

function validateAgainstSchema(value, schema, rootSchema, path = "$", errors = []) {
  if (schema.$ref) {
    const target = resolvePointer(rootSchema, schema.$ref);
    if (!target) errors.push(`${path}: unresolved schema reference`);
    else validateAgainstSchema(value, target, rootSchema, path, errors);
    return errors;
  }
  if (schema.oneOf) {
    const matches = schema.oneOf.filter(candidate => {
      const candidateErrors = [];
      validateAgainstSchema(value, candidate, rootSchema, path, candidateErrors);
      return candidateErrors.length === 0;
    });
    if (matches.length !== 1) errors.push(`${path}: must match exactly one schema branch`);
    return errors;
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some(type => matchesType(value, type))) {
      errors.push(`${path}: wrong type`);
      return errors;
    }
  }
  if (Object.hasOwn(schema, "const") && !same(value, schema.const)) errors.push(`${path}: const mismatch`);
  if (schema.enum && !schema.enum.some(item => same(item, value))) errors.push(`${path}: enum mismatch`);
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: too few items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: too many items`);
    if (schema.items) value.forEach((item, index) => validateAgainstSchema(item, schema.items, rootSchema, `${path}[${index}]`, errors));
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) errors.push(`${path}.${key}: required`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(schema.properties ?? {}, key)) errors.push(`${path}.${key}: unexpected property`);
      }
    }
    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(value, key)) validateAgainstSchema(value[key], childSchema, rootSchema, `${path}.${key}`, errors);
    }
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: too short`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path}: too long`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: pattern mismatch`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: below minimum`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: above maximum`);
  }
  return errors;
}

const options = parseArgs(process.argv.slice(2));
const mode = options.local ? "local" : "live";
const buildManifest = JSON.parse(readFileSync(resolve(ROOT, options.buildManifest), "utf8"));
const proofSchemaBytes = readFileSync(resolve(ROOT, "schemas/stage0-proof-result.v1.schema.json"));
const proofSchema = JSON.parse(proofSchemaBytes);
const binaryFixtures = buildManifest.fixtures.filter(item => item.accessProof !== true);
const googleDocCase = buildManifest.googleDocCase ?? {
  caseKey: "google-doc-primary",
  sourceType: "google-doc",
  expectedStatus: "complete",
  expectedCode: null,
  expectedBytes: null,
  expectedSha256: null,
  expectedChunkCount: null,
  expectedProjectionSha256: buildManifest.goldenProjectionSha256ByCase?.["google-doc-primary"] ?? null,
  maxObservedDurationMs: 10_000,
  parserLimits: {},
};
const googleDocOverflowCase = buildManifest.googleDocOverflowCase ?? {
  caseKey: "google-doc-overflow",
  sourceType: "google-doc",
  expectedStatus: "rejected",
  expectedCode: "RESOURCE_LIMIT_EXCEEDED",
  expectedBytes: null,
  expectedSha256: null,
  expectedChunkCount: null,
  expectedProjectionSha256: null,
  maxObservedDurationMs: 10_000,
  parserLimits: {},
};
const expectedCases = mode === "live"
  ? [...buildManifest.fixtures, googleDocCase, googleDocOverflowCase]
  : binaryFixtures;
const fixtureBindings = expectedCases.map(fixtureBinding);
const expectedTotal = expectedCases.length + (mode === "live" ? 6 : 3);
const browserLedger = [];
const consoleCounts = { error: 0, warning: 0 };
let phase = "bootstrap";
let workerCount = 0;
let serviceWorkerCount = 0;
let raw = {
  schemaVersion: "1.0.0",
  status: "failed",
  passed: 0,
  total: 0,
  build: buildManifest.build,
  executionIdentity: null,
  cases: [],
  runtime: null,
  transport: null,
  deadline: null,
  memory: null,
  networkCapabilities: [],
  networkLedger: [],
  cspViolationCount: 0,
};
let runnerFailed = false;
let runnerFailureReported = false;
let responseCsp = "";
let metaCsp = "";
let contextCspViolationCount = 0;
let proofFrameUrl = "";
let accessibility = {
  documentLanguage: false,
  mainLandmark: false,
  singleH1: false,
  labeledResultsTable: false,
  statusLiveRegion: false,
  keyboardFocus: false,
  visibleFocusIndicator: false,
  minimumTargetSize: false,
  keyboardActivation: false,
  passed: false,
};
let context;
let browser;

try {
  if (options.profile) {
    context = await chromium.launchPersistentContext(resolve(options.profile), {
      channel: "chrome",
      headless: !options.headed,
      args: ["--enable-precise-memory-info"],
    });
  } else {
    browser = await chromium.launch({
      channel: "chrome",
      headless: !options.headed,
      args: ["--enable-precise-memory-info"],
    });
    context = await browser.newContext();
  }
  await context.addInitScript(() => {
    globalThis.__STAGE0_CONTEXT_CSP_VIOLATIONS__ = [];
    document.addEventListener("securitypolicyviolation", event => {
      globalThis.__STAGE0_CONTEXT_CSP_VIOLATIONS__.push({
        effectiveDirective: event.effectiveDirective,
        disposition: event.disposition,
      });
    });
  });
  context.on("serviceworker", () => { serviceWorkerCount += 1; });
  serviceWorkerCount += context.serviceWorkers().length;
  await context.route("**/*", async route => {
    const request = route.request();
    const resourceType = request.resourceType();
    const classification = classifyRequest(request.url(), {
      initialUrl: options.url,
      mode,
      phase,
      resourceType,
    });
    const allowed = isAllowedClassification(classification);
    browserLedger.push({ phase, classification, resourceType, action: allowed ? "continued" : "blocked" });
    if (allowed) await route.continue();
    else await route.abort("blockedbyclient");
  });
  const page = context.pages()[0] ?? await context.newPage();
  const responseCspPromises = [];
  page.on("response", response => {
    if (response.request().resourceType() !== "document") return;
    responseCspPromises.push(
      response.allHeaders()
        .then(headers => ({ url: response.url(), csp: headers["content-security-policy"] ?? "" }))
        .catch(() => ({ url: response.url(), csp: "" })),
    );
  });
  page.on("worker", () => { workerCount += 1; });
  workerCount += page.workers().length;
  page.on("console", message => {
    if (message.type() === "error") consoleCounts.error += 1;
    if (message.type() === "warning") consoleCounts.warning += 1;
  });
  page.on("pageerror", () => { consoleCounts.error += 1; });

  try {
    await page.goto(options.url, { waitUntil: "domcontentloaded", timeout: options.timeoutMs });
    const buttonName = mode === "live"
      ? "Run authorized synthetic proof"
      : "Run local parser proof";
    const globalName = mode === "live" ? "__STAGE0_LIVE_PROOF__" : "__STAGE0_LOCAL_PROOF__";
    const proofFrame = await findFrameWithButton(page, buttonName, options.timeoutMs);
    proofFrameUrl = proofFrame.url();
    const runButton = proofFrame.getByRole("button", { name: buttonName });
    await runButton.waitFor({ state: "visible", timeout: options.timeoutMs });
    metaCsp = await proofFrame.locator('meta[http-equiv="Content-Security-Policy" i]').getAttribute("content") ?? "";
    await runButton.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    accessibility = await runButton.evaluate(button => {
      const style = getComputedStyle(button);
      const table = document.querySelector("table");
      const status = document.querySelector('[role="status"]');
      const result = {
        documentLanguage: document.documentElement.lang === "en",
        mainLandmark: document.querySelectorAll("main").length === 1,
        singleH1: document.querySelectorAll("h1").length === 1,
        labeledResultsTable: Boolean(table?.getAttribute("aria-label")),
        statusLiveRegion: status?.getAttribute("aria-live") === "polite",
        keyboardFocus: document.activeElement === button && button.tabIndex >= 0 && !button.disabled,
        visibleFocusIndicator:
          style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) >= 2,
        minimumTargetSize:
          button.getBoundingClientRect().height >= 44 && button.getBoundingClientRect().width >= 44,
        keyboardActivation: false,
        passed: false,
      };
      result.passed = Object.entries(result)
        .filter(([key]) => !["keyboardActivation", "passed"].includes(key))
        .every(([, value]) => value === true);
      return result;
    });
    if (!accessibility.keyboardFocus) throw new Error("The proof control was not keyboard reachable.");
    phase = "proof";
    await page.keyboard.press("Enter");
    await proofFrame.waitForFunction(
      name => ["passed", "failed"].includes(globalThis[name]?.status),
      globalName,
      { timeout: options.timeoutMs },
    );
    raw = await proofFrame.evaluate(name => globalThis[name], globalName);
    accessibility.keyboardActivation = true;
    accessibility.passed = Object.entries(accessibility)
      .filter(([key]) => key !== "passed")
      .every(([, value]) => value === true);
  } catch (error) {
    runnerFailed = true;
    runnerFailureReported = true;
    console.error(`Stage 0 browser proof failed safely during ${phase} (${safeErrorName(error)}).`);
  }
  const observedResponseCsp = await Promise.all(responseCspPromises);
  responseCsp = observedResponseCsp
    .filter(item => item.url === proofFrameUrl)
    .map(item => item.csp)
    .filter(Boolean)
    .join("; ");
  const frameViolationCounts = await Promise.all(
    page.frames().map(frame => frame.evaluate(
      () => Array.isArray(globalThis.__STAGE0_CONTEXT_CSP_VIOLATIONS__)
        ? globalThis.__STAGE0_CONTEXT_CSP_VIOLATIONS__.length
        : 0,
    ).catch(() => 0)),
  );
  contextCspViolationCount = frameViolationCounts.reduce((sum, count) => sum + count, 0);
} catch (error) {
  runnerFailed = true;
  if (!runnerFailureReported) {
    console.error(`Stage 0 browser launch failed safely (${safeErrorName(error)}).`);
  }
}

try {
  const rawCases = Array.isArray(raw?.cases) ? raw.cases : [];
  const rawCasesByKey = new Map(
    rawCases
      .filter(item => item && typeof item.caseKey === "string")
      .map(item => [item.caseKey, item]),
  );
  const cases = expectedCases
    .map(expected => normalizeCase(rawCasesByKey.get(expected.caseKey), expected, mode))
    .filter(Boolean);
  const exactCaseKeys =
    rawCases.length === expectedCases.length &&
    rawCasesByKey.size === expectedCases.length &&
    expectedCases.every(item => rawCasesByKey.has(item.caseKey));
  const rejectionMatrix = expectedCases
    .filter(item => item.expectedStatus === "rejected")
    .map(item => {
      const observed = cases.find(value => value.caseKey === item.caseKey);
      return {
        caseKey: item.caseKey,
        expectedCode: item.expectedCode,
        observedCode: observed?.observedCode ?? null,
        passed: observed?.passed === true && observed.observedCode === item.expectedCode,
      };
    });
  const multiChunkCases = mode === "live"
    ? cases.filter(item => (item.chunkCount ?? 0) > 1).map(item => item.caseKey)
    : [];
  const multiBatchCases = mode === "live"
    ? cases.filter(item => (item.batchCount ?? 0) > 1).map(item => item.caseKey)
    : [];
  const batchCount = mode === "live"
    ? cases.reduce((sum, item) => sum + (item.batchCount ?? 0), 0)
    : 0;
  const transport = {
    ...buildManifest.transport,
    driveBoundaryExercised: mode === "live",
    batchCount,
    multiChunkCaseCount: multiChunkCases.length,
    multiChunkCases,
    multiBatchCaseCount: multiBatchCases.length,
    multiBatchCases,
  };
  const expectedAccessibleCount = buildManifest.fixtures.filter(item => item.accessProof !== true).length + 2;
  const executionIdentity = mode === "live" &&
    raw?.executionIdentity?.mode === "two-account-access-differential" &&
    Number.isInteger(raw.executionIdentity.expectedAccessibleCount) &&
    Number.isInteger(raw.executionIdentity.accessibleCount) &&
    Number.isInteger(raw.executionIdentity.inaccessibleCount)
    ? {
        mode: raw.executionIdentity.mode,
        expectedAccessibleCount: raw.executionIdentity.expectedAccessibleCount,
        accessibleCount: raw.executionIdentity.accessibleCount,
        inaccessibleCount: raw.executionIdentity.inaccessibleCount,
        boundarySatisfied: raw.executionIdentity.boundarySatisfied === true,
      }
    : null;
  const executionIdentityPass = mode === "local" || (
    executionIdentity?.mode === "two-account-access-differential" &&
    executionIdentity.expectedAccessibleCount === expectedAccessibleCount &&
    executionIdentity.accessibleCount === expectedAccessibleCount &&
    executionIdentity.inaccessibleCount === 1 &&
    executionIdentity.boundarySatisfied === true
  );
  const rawTransportPass = mode === "local" || (
    raw?.transport &&
    same(
      {
        chunkBytes: raw.transport.chunkBytes,
        chunkBatchSize: raw.transport.chunkBatchSize,
        maxSourceBytes: raw.transport.maxSourceBytes,
        maxChunks: raw.transport.maxChunks,
        maxJsonBytes: raw.transport.maxJsonBytes,
      },
      buildManifest.transport,
    ) &&
    raw.transport.batchCount === batchCount &&
    raw.transport.multiChunkCaseCount === multiChunkCases.length &&
    raw.transport.multiBatchCaseCount === multiBatchCases.length &&
    multiChunkCases.includes("primary-docx") &&
    multiChunkCases.length >= 2 &&
    multiBatchCases.includes("resource-limit-docx")
  );
  const deadline = raw?.deadline && raw.deadline.mode === "observed-non-preemptive"
    ? {
        mode: "observed-non-preemptive",
        preemptiveDeadlineSupported: false,
        allWithinObservedLimit:
          raw.deadline.allWithinObservedLimit === true &&
          cases.length === expectedCases.length &&
          cases.every(item => item.withinObservedDeadline),
      }
    : null;
  const memory = normalizeMemory(raw?.memory, buildManifest.memory);
  const guardLedgerPresent = Array.isArray(raw?.networkLedger);
  const guardEntries = guardLedgerPresent
    ? raw.networkLedger.filter(entry => entry && typeof entry.api === "string")
    : [];
  const unexpectedGuardEntries = guardEntries.filter(entry => entry.allowed !== true);
  const expectedCapabilityNames = [
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "EventSource",
    "Worker",
    "SharedWorker",
    "sendBeacon",
    "serviceWorker.register",
  ];
  const guardCapabilities = Array.isArray(raw?.networkCapabilities)
    ? raw.networkCapabilities
        .filter(item => item && expectedCapabilityNames.includes(item.api))
        .map(item => ({
          api: item.api,
          available: item.available === true,
          installed: item.installed === true,
        }))
    : [];
  const capabilityNames = new Set(guardCapabilities.map(item => item.api));
  const capabilityPass =
    guardCapabilities.length === expectedCapabilityNames.length &&
    capabilityNames.size === expectedCapabilityNames.length &&
    expectedCapabilityNames.every(name => capabilityNames.has(name)) &&
    guardCapabilities.every(item => !item.available || item.installed) &&
    ["fetch", "XMLHttpRequest"].every(name =>
      guardCapabilities.some(item => item.api === name && item.available && item.installed));
  const guardedNetwork = {
    entryCount: guardEntries.length,
    capabilities: guardCapabilities,
    apiCounts: namedCounts(guardEntries.map(entry => entry.api)),
    allowedCount: guardEntries.filter(entry => entry.allowed === true).length,
    unexpectedCount: unexpectedGuardEntries.length,
  };
  const unexpectedRequests = browserLedger.filter(entry => !isAllowedClassification(entry.classification));
  const blockedRequests = browserLedger.filter(entry => entry.action === "blocked");
  const browserNetwork = {
    requestCount: browserLedger.length,
    phaseCounts: namedCounts(browserLedger.map(entry => entry.phase)),
    requestClassifications: namedCounts(browserLedger.map(entry => entry.classification)),
    resourceTypes: namedCounts(browserLedger.map(entry => entry.resourceType)),
    actionCounts: namedCounts(browserLedger.map(entry => entry.action)),
    unexpectedRequestCount: unexpectedRequests.length,
    blockedRequestCount: blockedRequests.length,
  };
  const headerDirectiveNames = directiveNames(responseCsp);
  const metaDirectiveNames = directiveNames(metaCsp);
  const cspNames = [...new Set([...headerDirectiveNames, ...metaDirectiveNames])]
    .sort((left, right) => left.localeCompare(right, "en-US"));
  const rawCspViolationCount = Number.isInteger(raw?.cspViolationCount) && raw.cspViolationCount >= 0
    ? raw.cspViolationCount
    : 1;
  const csp = {
    violationCount: Math.max(rawCspViolationCount, contextCspViolationCount),
    headerObserved: Boolean(responseCsp),
    metaObserved: Boolean(metaCsp),
    directiveNames: cspNames,
    workerDirectivePresent:
      headerDirectiveNames.includes("worker-src") || metaDirectiveNames.includes("worker-src"),
    workerRequestCount:
      workerCount + browserLedger.filter(entry => ["worker", "serviceworker"].includes(entry.resourceType)).length,
    serviceWorkerCount,
  };
  const assertions = {
    passed: Number.isInteger(raw?.passed) && raw.passed >= 0 ? raw.passed : 0,
    total: Number.isInteger(raw?.total) && raw.total >= 0 ? raw.total : 0,
    expectedTotal,
  };
  const buildPass = same(raw?.build, buildManifest.build);
  const localBuildToolingPass =
    buildManifest.build.buildScriptSha256 === sha256(readFileSync(resolve(ROOT, "scripts/build-stage0-harness.mjs"))) &&
    buildManifest.build.proofRunnerSha256 === sha256(readFileSync(fileURLToPath(import.meta.url))) &&
    buildManifest.build.proofSchemaSha256 === sha256(proofSchemaBytes) &&
    buildManifest.build.appsscriptManifestSha256 === sha256(readFileSync(resolve(ROOT, "proof/stage0/appsscript/appsscript.example.json")));
  const runtimePass = same(raw?.runtime, {
    parserVersion: "1.0.0",
    catalogVersion: "1.0.0",
    criterionCount: 87,
    pdfStrategy: "pdfjs-inline-in-process-worker",
    docxStrategy: "fflate-ooxml-allowlist",
  });
  const casePass =
    exactCaseKeys &&
    cases.length === expectedCases.length &&
    cases.every(item => item.passed) &&
    rejectionMatrix.every(item => item.passed);
  const cspPass =
    csp.violationCount === 0 &&
    (mode === "live" ? csp.headerObserved : (csp.metaObserved || csp.headerObserved)) &&
    csp.workerDirectivePresent &&
    csp.workerRequestCount === 0 &&
    csp.serviceWorkerCount === 0;
  const corePass =
    !runnerFailed &&
    raw?.status === "passed" &&
    assertions.passed === expectedTotal &&
    assertions.total === expectedTotal &&
    buildPass &&
    localBuildToolingPass &&
    executionIdentityPass &&
    runtimePass &&
    casePass &&
    rawTransportPass &&
    deadline?.allWithinObservedLimit === true &&
    memory?.supported === true &&
    memory?.withinLimit === true &&
    browserNetwork.unexpectedRequestCount === 0 &&
    browserNetwork.blockedRequestCount === 0 &&
    guardLedgerPresent &&
    capabilityPass &&
    guardedNetwork.unexpectedCount === 0 &&
    cspPass &&
    accessibility.passed &&
    consoleCounts.error === 0 &&
    consoleCounts.warning === 0;
  const summaryCore = {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    proofMode: mode,
    status: corePass ? "passed" : "failed",
    assertions,
    build: buildManifest.build,
    executionIdentity,
    fixtureBindings,
    cases,
    rejectionMatrix,
    runtime: raw?.runtime ?? null,
    transport,
    deadline,
    memory,
    csp,
    browserNetwork,
    guardedNetwork,
    accessibility,
    console: consoleCounts,
  };
  const flags = privacyFlags(summaryCore);
  if (Object.values(flags).some(Boolean)) summaryCore.status = "failed";
  const canonicalEvidence = stableStringify(summaryCore);
  const summary = {
    ...summaryCore,
    privacyScan: {
      method: "derived-regex-over-canonical-summary",
      patternVersion: "1.0.0",
      fieldsScanned: countLeaves(summaryCore),
      evidenceSha256: sha256(canonicalEvidence),
    },
    ...flags,
  };
  const schemaErrors = validateAgainstSchema(summary, proofSchema, proofSchema);
  if (schemaErrors.length) {
    throw new Error(`Stage 0 proof summary failed schema validation at ${schemaErrors.slice(0, 5).join(", ")}`);
  }
  const outputPath = resolve(ROOT, options.output);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  if (summary.status !== "passed") process.exitCode = 1;
} finally {
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
}
