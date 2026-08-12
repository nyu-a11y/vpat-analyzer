import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8');
const json = (path) => JSON.parse(read(path));

const REQUIRED_FILES = [
  'docs/plans/V1_STAGE_0_1_CONTRACT.md',
  'docs/product/V1_SCOPE.md',
  'docs/product/SOURCE_REGISTRY.md',
  'docs/product/WORKBOOK_CONTRACT.md',
  'docs/product/V1_EXPERIENCE_BRIEF.md',
  'docs/product/V1_FLOW_STATE_MATRIX.md',
  'docs/product/V1_CONTENT_SPEC.md',
  'docs/architecture/DOMAIN_MODEL.md',
  'docs/architecture/STATE_MACHINE.md',
  'docs/contracts/AI_CONTRACT.md',
  'docs/contracts/EXPORT_CONTRACT.md',
  'docs/contracts/INGESTION_CONTRACT.md',
  'docs/testing/ACCEPTANCE_CASES.md',
  'docs/testing/STAGE_0_INGESTION_GATE.md',
  'config/vpat-2.5-wcag-criteria.v1.json',
  'config/quality-rubric.v1.json',
  'config/scoring-rules.v1.json',
  'prompts/conformance-analysis.v1.md',
  'prompts/quality-analysis.v1.md',
  'schemas/ai-conformance-response.v1.schema.json',
  'schemas/ai-quality-response.v1.schema.json',
  'schemas/export-model.v1.schema.json',
  'schemas/ingestion-result.v1.schema.json',
  'tests/fixtures/synthetic/google-docs-candidate-tables.v1.json',
  'tests/fixtures/synthetic/expected-wcag-rows.v1.json',
  'tests/fixtures/synthetic/README.md',
  'tests/contracts/stage0-contracts.test.mjs',
  'scripts/stage0-ingestion-blocked.mjs',
  'scripts/stage1-command-placeholder.mjs',
  'package.json'
];

const JSON_FILES = REQUIRED_FILES.filter((path) => path.endsWith('.json'));

const EXPECTED_SC_NUMBERS = `
1.1.1
1.2.1 1.2.2 1.2.3 1.2.4 1.2.5 1.2.6 1.2.7 1.2.8 1.2.9
1.3.1 1.3.2 1.3.3 1.3.4 1.3.5 1.3.6
1.4.1 1.4.2 1.4.3 1.4.4 1.4.5 1.4.6 1.4.7 1.4.8 1.4.9 1.4.10 1.4.11 1.4.12 1.4.13
2.1.1 2.1.2 2.1.3 2.1.4
2.2.1 2.2.2 2.2.3 2.2.4 2.2.5 2.2.6
2.3.1 2.3.2 2.3.3
2.4.1 2.4.2 2.4.3 2.4.4 2.4.5 2.4.6 2.4.7 2.4.8 2.4.9 2.4.10 2.4.11 2.4.12 2.4.13
2.5.1 2.5.2 2.5.3 2.5.4 2.5.5 2.5.6 2.5.7 2.5.8
3.1.1 3.1.2 3.1.3 3.1.4 3.1.5 3.1.6
3.2.1 3.2.2 3.2.3 3.2.4 3.2.5 3.2.6
3.3.1 3.3.2 3.3.3 3.3.4 3.3.5 3.3.6 3.3.7 3.3.8 3.3.9
4.1.1 4.1.2 4.1.3
`.trim().split(/\s+/);

const EXPECTED_RUBRIC = [
  ['qr-e12', 1, ['1', 'E-12'], 'Standards/guidelines declared', 'Essential', 4, 'Serious'],
  ['qr-e13', 2, ['2', 'E-13'], 'Only tested standards listed', 'Essential', 4, 'Serious'],
  ['qr-e14', 3, ['3', 'E-14'], 'At least one standard covered', 'Essential', 5, 'Critical'],
  ['qr-e16', 4, ['4', 'E-16'], 'Conformance Level terms defined', 'Essential', 3, 'Moderate'],
  ['qr-bp24', 5, ['5', 'BP-24'], 'All criteria answered for level', 'Best Practice', 5, 'Critical'],
  ['qr-e11', 6, ['6', 'E-11'], 'Evaluation methods described', 'Essential', 4, 'Serious'],
  ['qr-bp09', 7, ['7', 'BP-09'], 'AT testing described', 'Best Practice', 4, 'Serious'],
  ['qr-bp10', 8, ['8', 'BP-10'], 'Manual testing described', 'Best Practice', 3, 'Moderate'],
  ['qr-bp11', 9, ['9', 'BP-11'], 'Automated tools described', 'Best Practice', 3, 'Moderate'],
  ['qr-e09', 10, ['10', 'E-09'], 'Contact info provided', 'Essential', 3, 'Moderate'],
  ['qr-bp07', 11, ['11', 'BP-07'], 'Tester product familiarity statement', 'Best Practice', 2, 'Minor'],
  ['qr-e08', 12, ['12', 'E-08'], 'Product description provided', 'Essential', 4, 'Serious'],
  ['qr-bp04', 13, ['13', 'BP-04'], 'Notes state scope/coverage', 'Best Practice', 4, 'Serious'],
  ['qr-e19', 14, ['14', 'E-19'], 'Remarks filled for all criteria', 'Essential', 5, 'Critical'],
  ['qr-e04', 15, ['15', 'E-04'], 'Template version listed', 'Essential', 3, 'Moderate'],
  ['qr-e06', 16, ['16', 'E-06'], 'Report date present', 'Essential', 4, 'Serious']
];

test('all required Stage 0 artifacts exist and JSON parses', () => {
  for (const path of REQUIRED_FILES) assert.equal(existsSync(resolve(ROOT, path)), true, `missing ${path}`);
  for (const path of JSON_FILES) assert.doesNotThrow(() => json(path), `invalid JSON: ${path}`);
});

test('task contract has exactly the six permitted top-level fields', () => {
  const headings = [...read('docs/plans/V1_STAGE_0_1_CONTRACT.md').matchAll(/^# ([^#\n].*)$/gm)].map((match) => match[1]);
  assert.deepEqual(headings, ['Endpoint', 'Allowed scope', 'Protected state', 'Authority', 'Required proof', 'Stop conditions']);
});

test('canonical sources and corrected cross-file scope decisions are explicit', () => {
  const registry = read('docs/product/SOURCE_REGISTRY.md');
  for (const canonicalReference of [
    'https://docs.google.com/spreadsheets/d/1ggV8Vk9ILleDKji20WH5bCT6jJI2734w3IPFKJt0LqU/edit',
    'https://docs.google.com/spreadsheets/d/1aBOmkBnK_fyNdcn_TKApQ-SwqIG94_WFt_WkFMLQSqk/edit',
    'https://docs.google.com/document/d/1QnzKG6oj9LCS9m4P9Sy2oSwhe2oWbTO3QZ1MEw2mIR4/edit',
    '/Users/ms9513/Documents/Repositories/directory'
  ]) assert.match(registry, new RegExp(canonicalReference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(read('AGENTS.md'), /Canonical reference URLs explicitly supplied for repository traceability are allowed/);
  assert.match(read('docs/product/V1_SCOPE.md'), /levels A, AA, and AAA/);
  assert.match(read('docs/product/V1_EXPERIENCE_BRIEF.md'), /`selectedDirection` is `Document Workbench` and `selectionStatus` is `approved`/);
  assert.match(read('docs/product/V1_EXPERIENCE_BRIEF.md'), /approved the optimized Document Workbench direction on 2026-08-12/);
  for (const path of REQUIRED_FILES.filter((file) => file.endsWith('.md'))) {
    assert.doesNotMatch(read(path), /`Methodology`/, `bare export tab name in ${path}`);
  }
});

test('WCAG catalog is the exact 87-item 2.0/2.1/2.2 union with immutable IDs', () => {
  const catalog = json('config/vpat-2.5-wcag-criteria.v1.json');
  assert.equal(catalog.version, '1.0.0');
  assert.equal(catalog.vpatTemplateVersion, '2.5');
  assert.equal(catalog.criterionCount, 87);
  assert.equal(catalog.criteria.length, 87);
  assert.deepEqual(catalog.wcagVersions, ['2.0', '2.1', '2.2']);
  assert.deepEqual(catalog.levels, ['A', 'AA', 'AAA']);
  assert.deepEqual([...new Set(catalog.criteria.map(({ level }) => level))].sort(), ['A', 'AA', 'AAA']);
  assert.deepEqual(catalog.criteria.map(({ sc }) => sc).sort(), [...EXPECTED_SC_NUMBERS].sort());
  assert.equal(new Set(catalog.criteria.map(({ id }) => id)).size, 87);
  assert.equal(new Set(catalog.criteria.map(({ sc }) => sc)).size, 87);
  for (const criterion of catalog.criteria) {
    assert.equal(criterion.id, `wcag-sc-${criterion.sc}`);
    assert.match(criterion.title, /\S/);
    assert.ok(['A', 'AA', 'AAA'].includes(criterion.level));
    assert.ok(['2.0', '2.1', '2.2'].includes(criterion.introducedIn));
    assert.ok(criterion.activeIn.includes(criterion.introducedIn));
    assert.equal(/508|EN 301/i.test(`${criterion.id} ${criterion.sc} ${criterion.title}`), false);
  }
  const parsing = catalog.criteria.find(({ sc }) => sc === '4.1.1');
  assert.deepEqual(parsing.activeIn, ['2.0', '2.1']);
  assert.equal(parsing.retiredIn, '2.2');
  const targetSizeEnhanced = catalog.criteria.find(({ sc }) => sc === '2.5.5');
  assert.equal(targetSizeEnhanced.title, 'Target Size (Enhanced)');
  assert.deepEqual(targetSizeEnhanced.titleAliases, ['Target Size']);
  assert.match(catalog.matchPolicy.forbidden.join(' '), /leading-number match/);
});

test('quality rubric has the exact 16 stable IDs, aliases, impacts, and types', () => {
  const rubric = json('config/quality-rubric.v1.json');
  assert.equal(rubric.version, '1.0.0');
  assert.equal(rubric.requirementCount, 16);
  assert.equal(rubric.requirements.length, 16);
  assert.equal(new Set(rubric.requirements.map(({ id }) => id)).size, 16);
  assert.deepEqual(rubric.requirements.map((item) => [item.id, item.ordinal, item.aliases, item.title, item.type, item.impact.weight, item.impact.label]), EXPECTED_RUBRIC);
  assert.equal(rubric.requirements.reduce((sum, item) => sum + item.impact.weight, 0), 60);
  assert.equal(rubric.requirements.some(({ id }) => !id), false);
  assert.equal(rubric.sourceAnomalies[0].observedBlankCount, 1);
  assert.match(rubric.sourceAnomalies[0].note, /never a runtime identifier/);
});

test('scoring bands are gap-free and incomplete outcomes cannot receive a grade', () => {
  const scoring = json('config/scoring-rules.v1.json');
  assert.equal(scoring.version, '1.0.0');
  assert.equal(scoring.confidenceThreshold, 70);
  assert.equal(scoring.requiredRequirementCount, 16);
  assert.equal(scoring.totalPossibleWeight, 60);
  const points = new Map();
  for (const band of scoring.bands) {
    for (let point = band.min; point <= band.max; point += 1) {
      assert.equal(points.has(point), false, `overlap at ${point}`);
      points.set(point, band.grade);
    }
  }
  assert.equal(points.size, 101);
  assert.deepEqual([...points.keys()].sort((a, b) => a - b), Array.from({ length: 101 }, (_, index) => index));
  assert.deepEqual([points.get(60), points.get(61), points.get(69), points.get(70), points.get(79), points.get(80), points.get(89), points.get(90), points.get(94), points.get(95), points.get(100)], ['F', 'D', 'D', 'C', 'C', 'B', 'B', 'A-', 'A-', 'A', 'A']);
  assert.equal(scoring.completionSemantics.incompleteGrade, null);
  assert.deepEqual(scoring.completionSemantics.qualityResultsAllowedOnlyWhenComplete, ['Pass', 'Fail']);
  assert.match(scoring.completionSemantics.rule, /never count as Fail/);
});

test('all schema object boundaries reject unexpected fields', () => {
  let checked = 0;
  for (const path of JSON_FILES.filter((file) => file.startsWith('schemas/'))) {
    const visit = (node, pointer = '#') => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'object') {
        checked += 1;
        assert.equal(node.additionalProperties, false, `${path}:${pointer} must forbid unexpected fields`);
      }
      for (const [key, child] of Object.entries(node)) visit(child, `${pointer}/${key}`);
    };
    visit(json(path));
  }
  assert.ok(checked >= 20);
});

test('AI and export schemas encode incomplete-not-fail semantics and exact tabs', () => {
  const quality = json('schemas/ai-quality-response.v1.schema.json');
  assert.deepEqual(quality.$defs.completeFinding.properties.result.enum, ['Pass', 'Fail']);
  assert.equal(quality.$defs.incompleteFinding.properties.result.const, 'Incomplete');
  assert.equal(quality.$defs.incompleteFinding.properties.confidence.type, 'null');
  const exportSchema = json('schemas/export-model.v1.schema.json');
  assert.equal(exportSchema.$defs.incompleteScore.properties.grade.type, 'null');
  assert.equal(exportSchema.$defs.incompleteScore.properties.percentage.type, 'null');
  assert.deepEqual(exportSchema.properties.tabs.prefixItems.map(({ $ref }) => exportSchema.$defs[$ref.split('/').at(-1)].properties.name.const), ['Overview', 'Line-item Review', 'Quality Requirements', 'Scoring', 'Methodology & disclaimer']);
  assert.equal(exportSchema.properties.tabs.items, false);
  assert.equal(exportSchema.$defs.formulaReferenceCell.properties.kind.const, 'trusted-template-formula-reference');
  assert.equal('value' in exportSchema.$defs.formulaReferenceCell.properties, false);
});

test('approved Document Workbench revision separates web review views from Sheet tabs', () => {
  const experience = read('docs/product/V1_EXPERIENCE_BRIEF.md');
  const content = read('docs/product/V1_CONTENT_SPEC.md');
  const flow = read('docs/product/V1_FLOW_STATE_MATRIX.md');
  const workbook = read('docs/product/WORKBOOK_CONTRACT.md');
  const exportContract = read('docs/contracts/EXPORT_CONTRACT.md');
  assert.match(experience, /`approvedRevision: 9`/);
  assert.match(experience, /`approvedArtifactSha256: 300be6052711fd76e436de8c950a67cb66c4c7555f03453703bd76c360944c95`/);
  assert.match(content, /exactly three accessible review views, in order: `Summary`, `WCAG criteria`, and `Report quality`/);
  assert.match(workbook, /exact five-tab set applies to the exported Google Sheet/);
  assert.match(flow, /web app review navigator contains exactly `Summary`, `WCAG criteria`, and `Report quality`/);
  assert.match(content, /client-side and receipt-free/);
  assert.match(exportContract, /outside this Sheet export protocol/);
});

test('synthetic fixture has golden 55-row WCAG 2.2 A/AA parity and explicit exclusions', () => {
  const source = json('tests/fixtures/synthetic/google-docs-candidate-tables.v1.json');
  const expected = json('tests/fixtures/synthetic/expected-wcag-rows.v1.json');
  const catalog = json('config/vpat-2.5-wcag-criteria.v1.json');
  assert.equal(source.isDocumentAppProof, false);
  assert.match(source.proofLimitation, /not been serialized/);
  assert.equal(source.document.expectedCriterionCount, 55);
  assert.equal(source.document.expectedItemsToReview, 4);
  const wcagTable = source.candidateTables.find(({ tableId }) => tableId === 'table-wcag-22-a-aa');
  assert.equal(wcagTable.rows.length, 55);
  assert.equal(expected.rows.length, 55);
  assert.equal(new Set(expected.rows.map(({ criterionId }) => criterionId)).size, 55);
  const catalogById = new Map(catalog.criteria.map((item) => [item.id, item]));
  expected.rows.forEach((row, index) => {
    const sourceRow = wcagTable.rows[index];
    const criterion = catalogById.get(row.criterionId);
    assert.ok(criterion, `unknown ${row.criterionId}`);
    assert.equal(row.sc, criterion.sc);
    assert.equal(row.title, criterion.title);
    assert.equal(row.level, criterion.level);
    assert.ok(['A', 'AA'].includes(row.level));
    assert.ok(criterion.activeIn.includes('2.2'));
    assert.equal(sourceRow.sourceRowIndex, row.sourceRowIndex);
    assert.equal(sourceRow.cells[0], `${row.sc} ${row.title}`);
    assert.equal(sourceRow.cells[1], row.sourceConformance);
  });
  assert.equal(expected.rows.filter(({ sourceConformance }) => sourceConformance === 'Partially Supports').length, 4);
  assert.deepEqual(source.candidateTables.map(({ tableId, expectedClassification: classification, expectedReasonCode: reasonCode }) => ({ tableId, classification, reasonCode })), expected.expectedTableDecisions);
  assert.deepEqual(new Set(expected.excluded.map(({ reasonCode }) => reasonCode)), new Set(['BODY_PROSE', 'SECTION_508_ROW', 'EN_301_549_ROW', 'UNRECOGNIZED_CRITERION', 'NON_WCAG_ROW']));
  assert.equal(expected.excluded.some(({ value }) => value === '=1+1'), true);
});

test('prompts and blocker docs preserve the provider, OCR, and proof boundaries', () => {
  const conformance = read('prompts/conformance-analysis.v1.md');
  const quality = read('prompts/quality-analysis.v1.md');
  for (const prompt of [conformance, quality]) {
    assert.match(prompt, /version: 1\.0\.0/);
    assert.match(prompt, /untrusted evidence/);
    assert.match(prompt, /Return only JSON/);
    assert.match(prompt, /Do not .*OCR/is);
    assert.match(prompt, /exactly once/);
  }
  assert.match(quality, /never a `Fail`/);
  assert.match(read('docs/testing/STAGE_0_INGESTION_GATE.md'), /## Status: BLOCKED/);
  assert.match(read('tests/fixtures/synthetic/README.md'), /absence is an explicit P0 blocker, not passing evidence/);
  assert.match(read('scripts/stage0-ingestion-blocked.mjs'), /process\.exitCode = 2/);
});

test('package commands run only real Stage 0 contracts and honest blocker sentinels', () => {
  const packageJson = json('package.json');
  assert.equal(packageJson.scripts.test, 'npm run test:contracts');
  assert.equal(packageJson.scripts['test:contracts'], 'node --test tests/contracts/*.test.mjs');
  assert.equal(packageJson.scripts['proof:stage0'], 'npm run test:contracts && node scripts/stage0-ingestion-blocked.mjs');
  for (const command of ['test:a11y', 'test:appscript', 'test:browser', 'proof:stage1']) {
    assert.match(packageJson.scripts[command], /^node scripts\/stage1-command-placeholder\.mjs /);
  }
  assert.match(read('scripts/stage1-command-placeholder.mjs'), /intentionally unavailable in Stage 0/);
  assert.match(read('scripts/stage1-command-placeholder.mjs'), /process\.exitCode = 2/);
});
