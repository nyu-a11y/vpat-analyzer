import { createVpatAnalyzerApp } from './app.mjs';
import { createSyntheticClientBridge } from './synthetic-adapter.mjs';

const root = document.getElementById('app-root');
const parameters = new URL(globalThis.location.href).searchParams;
globalThis.NYU_VPAT_ANALYZER = createVpatAnalyzerApp({
  root,
  bridge: createSyntheticClientBridge({
    scenario: parameters.get('scenario') || '',
    stageDelay: parameters.has('proof') ? 0 : undefined,
  }),
});
