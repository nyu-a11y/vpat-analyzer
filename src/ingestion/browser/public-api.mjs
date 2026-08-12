import catalog from "../../../config/vpat-2.5-wcag-criteria.v1.json" with { type: "json" };

import { PARSER_VERSION } from "../core/index.mjs";
import { ingestSourceBytes, ingestStructuredSource } from "./ingest-bytes.mjs";
import { installNetworkGuard } from "../../proof/stage0/client/network-guard.mjs";

export async function ingestBinarySource(options) {
  return ingestSourceBytes({
    ...options,
    catalog,
  });
}

export function ingestSerializedGoogleDoc({
  requestId,
  candidateDocument,
  declaredWcagVersions,
  declaredLevels,
}) {
  return ingestStructuredSource({
    requestId,
    sourceType: "google-doc",
    candidateDocument,
    catalog,
    declaredWcagVersions,
    declaredLevels,
  });
}

export const runtime = Object.freeze({
  parserVersion: PARSER_VERSION,
  catalogVersion: catalog.version,
  criterionCount: catalog.criterionCount,
  pdfStrategy: "pdfjs-inline-in-process-worker",
  docxStrategy: "fflate-ooxml-allowlist",
});

export { installNetworkGuard };
