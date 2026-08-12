import assert from 'node:assert/strict';
import test from 'node:test';

import { confidencePresentation, qualityPresentation } from '../../../src/app/client/render.mjs';

test('scored report quality uses the matching band copy', () => {
  assert.deepEqual(qualityPresentation({ grade: 'B', score: 82 }), {
    scored: true,
    score: 82,
    label: 'B (82%)',
    context: 'Strong report quality with limited review needs.',
  });
});

test('incomplete analysis never invents a zero score or F grade', () => {
  const presentation = qualityPresentation({ analysisStatus: 'Incomplete', grade: null, score: null });
  assert.equal(presentation.scored, false);
  assert.equal(Number.isNaN(presentation.score), true);
  assert.equal(presentation.label, 'Incomplete');
  assert.doesNotMatch(presentation.context, /\bF\b|0%/u);
});

test('missing finding confidence is incomplete rather than a synthetic low score', () => {
  assert.equal(confidencePresentation(null), 'Incomplete');
  assert.equal(confidencePresentation(68), '68 · Below threshold');
  assert.equal(confidencePresentation(84), '84');
});
