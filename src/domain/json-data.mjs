const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export class DomainValidationError extends Error {
  constructor(code, path, reason, safeMessage = "The result failed deterministic validation.") {
    super(`${code} at ${path}: ${reason}`);
    this.name = "DomainValidationError";
    this.code = code;
    this.path = path;
    this.safeMessage = safeMessage;
  }
}

export function invalid(code, path, reason, safeMessage) {
  throw new DomainValidationError(code, path, reason, safeMessage);
}

export function codePointLength(value) {
  let length = 0;
  for (const unused of value) {
    void unused;
    length += 1;
  }
  return length;
}

export function requireClosedObject(value, path, properties, code = "MALFORMED_RESPONSE") {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalid(code, path, "must be an object");
  }

  const allowed = new Set(properties);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) {
      invalid(code, path, "contains an unexpected property");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      invalid(code, `${path}.${String(key)}`, "must be a JSON data property");
    }
  }
  for (const property of properties) {
    if (!Object.hasOwn(value, property)) {
      invalid(code, path, `is missing required property ${property}`);
    }
  }
  return value;
}

export function requireString(value, path, options = {}) {
  const code = options.code ?? "MALFORMED_RESPONSE";
  if (typeof value !== "string") invalid(code, path, "must be a string");
  const length = codePointLength(value);
  if (options.minLength !== undefined && length < options.minLength) {
    invalid(code, path, `must contain at least ${options.minLength} character(s)`);
  }
  if (options.maxLength !== undefined && length > options.maxLength) {
    invalid(code, path, `must contain no more than ${options.maxLength} character(s)`);
  }
  if (options.constant !== undefined && value !== options.constant) {
    invalid(code, path, "must equal the required constant");
  }
  if (options.allowed && !options.allowed.has(value)) {
    invalid(code, path, "must be an allowed value");
  }
  if (options.pattern && !options.pattern.test(value)) {
    invalid(code, path, "must match the required pattern");
  }
  return value;
}

export function requireIdentifier(value, path, options = {}) {
  return requireString(value, path, {
    minLength: 1,
    maxLength: options.maxLength ?? 128,
    pattern: options.pattern ?? IDENTIFIER_PATTERN,
    code: options.code,
  });
}

export function requireBoolean(value, path, code = "MALFORMED_RESPONSE") {
  if (typeof value !== "boolean") invalid(code, path, "must be a boolean");
  return value;
}

export function requireInteger(value, path, options = {}) {
  const code = options.code ?? "MALFORMED_RESPONSE";
  if (!Number.isInteger(value)) invalid(code, path, "must be an integer");
  if (options.minimum !== undefined && value < options.minimum) {
    invalid(code, path, `must be at least ${options.minimum}`);
  }
  if (options.maximum !== undefined && value > options.maximum) {
    invalid(code, path, `must be at most ${options.maximum}`);
  }
  return value;
}

export function requireArray(value, path, options = {}) {
  const code = options.code ?? "MALFORMED_RESPONSE";
  if (!Array.isArray(value)) invalid(code, path, "must be an array");
  const minimum = options.minItems ?? 0;
  const maximum = options.maxItems ?? Infinity;
  if (value.length < minimum) invalid(code, path, `must contain at least ${minimum} item(s)`);
  if (value.length > maximum) invalid(code, path, `must contain no more than ${maximum} item(s)`);

  const allowedKeys = new Set(["length"]);
  for (let index = 0; index < value.length; index += 1) {
    const key = String(index);
    allowedKeys.add(key);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      invalid(code, `${path}[${index}]`, "must be a JSON array item");
    }
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowedKeys.has(key)) {
      invalid(code, path, "contains an unexpected array property");
    }
  }
  return value;
}

export function requireNullablePrimitive(value, path, code = "INVALID_EXPORT_MODEL") {
  if (
    value !== null &&
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  ) {
    invalid(code, path, "must be a JSON literal value");
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    invalid(code, path, "must be a finite number");
  }
  return value;
}

export function assertJsonDepth(value, options = {}) {
  const maxDepth = options.maxDepth ?? 24;
  const maxNodes = options.maxNodes ?? 10000;
  const code = options.code ?? "MALFORMED_RESPONSE";
  const stack = [{ value, depth: 0, path: "$" }];
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    nodes += 1;
    if (nodes > maxNodes) invalid(code, current.path, "exceeds the JSON node limit");
    if (current.depth > maxDepth) invalid(code, current.path, "exceeds the JSON depth limit");
    if (current.value && typeof current.value === "object") {
      const keys = Reflect.ownKeys(current.value);
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(current.value, key);
        const isArrayLength = Array.isArray(current.value) && key === "length";
        if (
          typeof key !== "string" ||
          (!isArrayLength && (!descriptor?.enumerable || !("value" in descriptor)))
        ) {
          invalid(code, current.path, "must contain only JSON data properties");
        }
        if (isArrayLength) continue;
        stack.push({
          value: descriptor.value,
          depth: current.depth + 1,
          path: `${current.path}.${key}`,
        });
      }
    }
  }
}

export function parseBoundedJson(input, options = {}) {
  if (typeof input !== "string") {
    assertJsonDepth(input, options);
    return input;
  }
  const maxCharacters = options.maxCharacters ?? 1_000_000;
  if (codePointLength(input) > maxCharacters) {
    invalid(options.code ?? "MALFORMED_RESPONSE", "$", "exceeds the JSON character limit");
  }
  let parsed;
  try {
    parsed = JSON.parse(input);
  } catch {
    invalid(options.code ?? "MALFORMED_RESPONSE", "$", "must be valid JSON without a prose wrapper");
  }
  assertJsonDepth(parsed, options);
  return parsed;
}

export function cloneJson(value) {
  assertJsonDepth(value, {
    maxDepth: 32,
    maxNodes: 25000,
    code: "MALFORMED_RESPONSE",
  });
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    invalid("MALFORMED_RESPONSE", "$", "must be JSON serializable");
  }
  if (serialized === undefined) {
    invalid("MALFORMED_RESPONSE", "$", "must be JSON serializable");
  }
  return JSON.parse(serialized);
}

export function deepFreeze(value, seen = []) {
  if (value === null || typeof value !== "object") return value;
  if (seen.indexOf(value) !== -1) return value;
  seen.push(value);
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      invalid("MALFORMED_RESPONSE", `$.${key}`, "must be a JSON data property");
    }
    deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

export function immutableJson(value) {
  return deepFreeze(cloneJson(value));
}
