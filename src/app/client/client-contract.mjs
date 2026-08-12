const REQUIRED_METHODS = Object.freeze([
  'listDriveFiles',
  'validateSource',
  'startAnalysis',
  'retryExport',
  'resumeActive',
]);

export function assertClientBridge(bridge) {
  if (!bridge || typeof bridge !== 'object') {
    throw new TypeError('A VPAT Analyzer client bridge is required.');
  }
  for (const method of REQUIRED_METHODS) {
    if (typeof bridge[method] !== 'function') {
      throw new TypeError(`The client bridge must implement ${method}().`);
    }
  }
  return bridge;
}
