function safeUrl(value, baseUrl) {
  try {
    return new URL(String(value), baseUrl).href;
  } catch {
    return "invalid-url";
  }
}

export function installEarlyNetworkGuard({
  allowedUrl = () => false,
  baseUrl = globalThis.location?.href ?? "https://local.invalid/",
} = {}) {
  const capabilityNames = [
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "EventSource",
    "Worker",
    "SharedWorker",
    "sendBeacon",
    "serviceWorker.register",
  ];
  const ledger = [];
  const originals = new Map();
  const installed = new Set();
  const available = new Map([
    ["fetch", typeof globalThis.fetch === "function"],
    ["XMLHttpRequest", typeof globalThis.XMLHttpRequest === "function"],
    ["WebSocket", typeof globalThis.WebSocket === "function"],
    ["EventSource", typeof globalThis.EventSource === "function"],
    ["Worker", typeof globalThis.Worker === "function"],
    ["SharedWorker", typeof globalThis.SharedWorker === "function"],
    ["sendBeacon", typeof globalThis.Navigator?.prototype?.sendBeacon === "function"],
    ["serviceWorker.register", typeof globalThis.navigator?.serviceWorker?.register === "function"],
  ]);
  let active = true;

  const record = (api, rawUrl, allowed) => {
    const url = safeUrl(rawUrl, baseUrl);
    const entry = Object.freeze({
      sequence: ledger.length + 1,
      api,
      url,
      allowed: Boolean(allowed),
    });
    ledger.push(entry);
    return entry;
  };

  if (typeof globalThis.fetch === "function") {
    originals.set("fetch", globalThis.fetch);
    globalThis.fetch = function stage0Fetch(input, init) {
      const rawUrl = typeof input === "object" && input?.url ? input.url : input;
      const url = safeUrl(rawUrl, baseUrl);
      const allowed = allowedUrl(url, "fetch");
      record("fetch", url, allowed);
      if (active && !allowed) return Promise.reject(new Error("Unexpected network request blocked."));
      return originals.get("fetch").call(this, input, init);
    };
    if (globalThis.fetch !== originals.get("fetch")) installed.add("fetch");
  }

  if (typeof globalThis.XMLHttpRequest === "function") {
    originals.set("XMLHttpRequest", globalThis.XMLHttpRequest);
    const NativeXhr = globalThis.XMLHttpRequest;
    globalThis.XMLHttpRequest = class Stage0XmlHttpRequest extends NativeXhr {
      open(method, rawUrl, ...rest) {
        const url = safeUrl(rawUrl, baseUrl);
        const allowed = allowedUrl(url, "XMLHttpRequest");
        record("XMLHttpRequest", url, allowed);
        if (active && !allowed) throw new Error("Unexpected network request blocked.");
        return super.open(method, rawUrl, ...rest);
      }
    };
    if (globalThis.XMLHttpRequest !== NativeXhr) installed.add("XMLHttpRequest");
  }

  for (const api of ["WebSocket", "EventSource", "Worker", "SharedWorker"]) {
    if (typeof globalThis[api] !== "function") continue;
    originals.set(api, globalThis[api]);
    const NativeConstructor = globalThis[api];
    globalThis[api] = class Stage0NetworkConstructor extends NativeConstructor {
      constructor(rawUrl, ...rest) {
        const url = safeUrl(rawUrl, baseUrl);
        const allowed = api === "Worker" || api === "SharedWorker"
          ? false
          : allowedUrl(url, api);
        record(api, url, allowed);
        if (active && !allowed) throw new Error(`Unexpected ${api} construction blocked.`);
        super(rawUrl, ...rest);
      }
    };
    if (globalThis[api] !== NativeConstructor) installed.add(api);
  }

  const navigatorPrototype = globalThis.Navigator?.prototype;
  if (navigatorPrototype && typeof navigatorPrototype.sendBeacon === "function") {
    originals.set("sendBeacon", navigatorPrototype.sendBeacon);
    navigatorPrototype.sendBeacon = function stage0SendBeacon(rawUrl, data) {
      const url = safeUrl(rawUrl, baseUrl);
      const allowed = allowedUrl(url, "sendBeacon");
      record("sendBeacon", url, allowed);
      if (active && !allowed) return false;
      return originals.get("sendBeacon").call(this, rawUrl, data);
    };
    if (navigatorPrototype.sendBeacon !== originals.get("sendBeacon")) installed.add("sendBeacon");
  }

  const serviceWorker = globalThis.navigator?.serviceWorker;
  if (serviceWorker && typeof serviceWorker.register === "function") {
    originals.set("serviceWorker.register", serviceWorker.register);
    const stage0Register = function stage0Register(rawUrl, options) {
      const url = safeUrl(rawUrl, baseUrl);
      record("serviceWorker.register", url, false);
      if (active) return Promise.reject(new Error("Service Worker registration blocked."));
      return originals.get("serviceWorker.register").call(this, rawUrl, options);
    };
    try {
      Object.defineProperty(serviceWorker, "register", {
        configurable: true,
        value: stage0Register,
        writable: true,
      });
    } catch {
      try { serviceWorker.register = stage0Register; } catch { /* capability remains uninstalled and proof fails closed */ }
    }
    if (serviceWorker.register !== originals.get("serviceWorker.register")) installed.add("serviceWorker.register");
  }

  return Object.freeze({
    capabilities: () => capabilityNames.map(api => ({
      api,
      available: available.get(api) === true,
      installed: installed.has(api),
    })),
    entries: () => ledger.map(entry => ({ ...entry })),
    unexpectedEntries: () => ledger.filter(entry => !entry.allowed).map(entry => ({ ...entry })),
    sanitizedEntries: () => ledger.map(({ sequence, api, allowed }) => ({ sequence, api, allowed })),
    stop() {
      if (!active) return;
      active = false;
      for (const [api, implementation] of originals) {
        if (api === "sendBeacon") navigatorPrototype.sendBeacon = implementation;
        else if (api === "serviceWorker.register") {
          try {
            Object.defineProperty(serviceWorker, "register", {
              configurable: true,
              value: implementation,
              writable: true,
            });
          } catch {
            try { serviceWorker.register = implementation; } catch { /* page teardown will release the realm */ }
          }
        }
        else globalThis[api] = implementation;
      }
    },
  });
}
