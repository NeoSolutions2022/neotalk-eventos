import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizePrefetchValidation } from '../scripts/summarize-prefetch-validation.mjs';

test('prefetch evidence never copies unapproved report fields or free-form HTTP keys', () => {
  const evidence = summarizePrefetchValidation({ secret: 'private-secret' }, {
    observations: [{ text: 'private-secret' }], failure: 'private-secret', browserVersion: 'private-secret',
    runtimeImages: { platform: 'private-secret' }, harnessSha256: 'private-secret',
    http: { 'translate:200': 5, 'private-secret': 1, 'pose_submit:202': -1 },
  });
  assert.ok(!JSON.stringify(evidence).includes('private-secret'));
  assert.deepEqual(evidence.http, { 'translate:200': 5 });
  assert.equal(evidence.browserVersion, null);
  assert.equal(evidence.analysis.consistentSampleGate, false);
});
