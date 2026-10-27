import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeCaptureValidation } from '../scripts/summarize-capture-validation.mjs';

test('capture summary excludes free-form private diagnosis, transcript, keys, device IDs and check names', () => {
  const report = { result: 'PASS', browserName: 'brave', browser: '156.0.8078.48', renderer: 'omit', pageErrors: 0,
    checks: [{ name: 'PRIVATE_CHECK', passed: true }], privatePageErrors: [{ message: 'PRIVATE_ERROR' }],
    transcript: 'PRIVATE_TEXT', apiKey: 'PRIVATE_KEY', deviceId: 'PRIVATE_ID',
    sourceSha256: { 'PRIVATE_FILE': 'PRIVATE_HASH' }, muteStress: { requested: 24, completed: 24, timerResumed: true },
    asr: [{ status: 200, skipped: 'empty_container' }, { status: 200 }, { status: 422 }] };
  const result = summarizeCaptureValidation(report);
  assert.equal(result.checks.passed, 1); assert.equal(result.asr.emptyContainer, 1); assert.equal(result.asr.normal200, 1);
  assert.deepEqual(result.asr.statuses, { 200: 2, 422: 1 });
  assert.equal(result.browserName, 'brave'); assert.equal(result.muteStress.completed, 24);
  assert.ok(!JSON.stringify(result).includes('PRIVATE_'));
});

test('capture summary preserves unknown counters instead of claiming zero failures or invented browser identity', () => {
  const result = summarizeCaptureValidation({ result: 'PRIVATE_RESULT', browserName: 'PRIVATE_BROWSER', browser: 'PRIVATE_VERSION',
    pageErrors: -1, checks: [{}, { passed: false }], muteStress: { requested: NaN }, sourceSha256: { 'app/LiveRoom.tsx': 'invalid' } });
  assert.equal(result.result, null); assert.equal(result.pageErrors, null); assert.equal(result.browserName, null);
  assert.equal(result.browserVersion, null); assert.equal(result.muteStress.requested, null);
  assert.equal(result.checks.failed, 1); assert.equal(result.checks.unknown, 1);
  assert.equal(result.sourceSha256['app/LiveRoom.tsx'], null);
  assert.ok(!JSON.stringify(result).includes('PRIVATE_'));
});
