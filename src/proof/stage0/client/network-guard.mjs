const GUARDED_APIS = Object.freeze([
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "Worker",
]);

function safeUrl(value, baseUrl) {
  try {
    return new URL(String(value), baseUrl).href;
  } catch {
    return "invalid-url";
  }
}

/**
 * Installs a reversible parser-phase guard. Unexpected network and every real
 * Worker construction are blocked and recorded. HtmlService RPC may be allowed
 * with an exact URL predicate supplied by the live harness.
 */
export function installNetworkGuard({
  allowedUrl = () => false,
  baseUrl = globalThis.location?.href ?? "https://local.invalid/",
} = {}) {
  const ledger = [];
  const originals = new Map();
  let active = true;

  const record = (api, rawUrl, allowed, detail = "") => {
    const entry = Object.freeze({
      sequence: ledger.length + 1,
      api,
      url: safeUrl(rawUrl, baseUrl),
      allowed: Boolean(allowed),
      detail,
    });
    ledger.push(entry);
    return entry;
  };

  if (typeof globalThis.fetch === "function") {
    originals.set("fetch", globalThis.fetch);
    globalThis.fetch = function guardedFetch(input, init) {
      const rawUrl = typeof input === "object" && input?.url ? input.url : input;
      const url = safeUrl(rawUrl, baseUrl);
      const allowed = allowedUrl(url, "fetch");
      record("fetch", url, allowed);
      if (!active || allowed) return originals.get("fetch").call(this, input, init);
      return Promise.reject(new Error("Unexpected parser-phase fetch blocked."));
    };
  }

  if (typeof globalThis.XMLHttpRequest === "function") {
    originals.set("XMLHttpRequest", globalThis.XMLHttpRequest);
    const NativeXhr = globalThis.XMLHttpRequest;
    globalThis.XMLHttpRequest = class GuardedXmlHttpRequest extends NativeXhr {
      open(method, rawUrl, ...rest) {
        const url = safeUrl(rawUrl, baseUrl);
        const allowed = allowedUrl(url, "XMLHttpRequest");
        record("XMLHttpRequest", url, allowed, String(method));
        if (active && !allowed) throw new Error("Unexpected parser-phase XMLHttpRequest blocked.");
        return super.open(method, rawUrl, ...rest);
      }
    };
  }

  for (const api of ["WebSocket", "EventSource"]) {
    if (typeof globalThis[api] !== "function") continue;
    originals.set(api, globalThis[api]);
    const NativeConstructor = globalThis[api];
    globalThis[api] = class GuardedNetworkConstructor extends NativeConstructor {
      constructor(rawUrl, ...rest) {
        const url = safeUrl(rawUrl, baseUrl);
        const allowed = allowedUrl(url, api);
        record(api, url, allowed);
        if (active && !allowed) throw new Error(`Unexpected parser-phase ${api} blocked.`);
        super(rawUrl, ...rest);
      }
    };
  }

  if (typeof globalThis.Worker === "function") {
    originals.set("Worker", globalThis.Worker);
    globalThis.Worker = class BlockedParserWorker {
      constructor(rawUrl) {
        record("Worker", rawUrl, false, "PDF.js must use the bundled in-process handler");
        throw new Error("Real Worker construction is forbidden in the inline parser bundle.");
      }
    };
  }

  const navigatorPrototype = globalThis.Navigator?.prototype;
  if (navigatorPrototype && typeof navigatorPrototype.sendBeacon === "function") {
    originals.set("sendBeacon", navigatorPrototype.sendBeacon);
    navigatorPrototype.sendBeacon = function guardedSendBeacon(rawUrl, data) {
      const url = safeUrl(rawUrl, baseUrl);
      const allowed = allowedUrl(url, "sendBeacon");
      record("sendBeacon", url, allowed);
      if (active && !allowed) return false;
      return originals.get("sendBeacon").call(this, rawUrl, data);
    };
  }

  return Object.freeze({
    guardedApis: GUARDED_APIS,
    entries: () => ledger.map((entry) => ({ ...entry })),
    unexpectedEntries: () => ledger.filter((entry) => !entry.allowed).map((entry) => ({ ...entry })),
    stop() {
      if (!active) return;
      active = false;
      for (const [api, implementation] of originals) {
        if (api === "sendBeacon") navigatorPrototype.sendBeacon = implementation;
        else globalThis[api] = implementation;
      }
    },
  });
}

