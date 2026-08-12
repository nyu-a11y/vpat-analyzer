import { createVpatAnalyzerApp } from './app.mjs';
import { createGoogleScriptBridge } from './bridge.mjs';

function unavailableBridge(reason) {
  const reject = () => Promise.reject(Object.assign(new Error(reason), { kind: 'nyu-access' }));
  return {
    resumeActive: reject,
    listDriveFiles: reject,
    validateSource: reject,
    startAnalysis: reject,
    retryExport: reject,
  };
}

const root = document.getElementById('app-root');
let bridge;
let initializationError = '';
try {
  bridge = createGoogleScriptBridge();
} catch (error) {
  initializationError = 'The authorized NYU connection is not available in this browser session.';
  bridge = unavailableBridge(initializationError);
}

const app = createVpatAnalyzerApp({ root, bridge });
if (initializationError) app.showAccessError(initializationError);
globalThis.NYU_VPAT_ANALYZER = app;
