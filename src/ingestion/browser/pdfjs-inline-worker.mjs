import "./runtime-polyfills.mjs";
import { WorkerMessageHandler } from "pdfjs-dist/build/pdf.worker.mjs";

const existingWorker = globalThis.pdfjsWorker;

if (
  existingWorker?.WorkerMessageHandler &&
  existingWorker.WorkerMessageHandler !== WorkerMessageHandler
) {
  throw new Error("A different PDF.js worker handler is already installed.");
}

globalThis.pdfjsWorker = Object.freeze({ WorkerMessageHandler });

export { WorkerMessageHandler };
