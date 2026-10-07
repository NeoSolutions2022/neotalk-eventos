import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../app/liveResilience.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { LiveSessionScope, OrderedTranscriptBuffer, retryLiveRequest, isTransientLiveFailure } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('starting/ending rooms invalidates every previous async session', () => {
  const scope = new LiveSessionScope();
  const first = scope.begin();
  assert.ok(scope.isCurrent(first));
  const second = scope.begin();
  assert.ok(first.aborted);
  assert.equal(scope.isCurrent(first), false);
  scope.end();
  assert.ok(second.aborted);
  assert.equal(scope.isCurrent(second), false);
});
for (const status of [408, 429, 500, 502, 503, 504]) {
  test(`recovers HTTP ${status} with bounded retries`, async () => {
    let attempts = 0;
    const result = await retryLiveRequest(async () => {
      if (++attempts < 3) throw Object.assign(new Error('transient'), { status });
      return 'pose';
    }, new AbortController().signal, [0, 0]);
    assert.equal(result, 'pose');
    assert.equal(attempts, 3);
  });
}
for (const status of [400, 401, 403, 404, 409, 422]) {
  test(`does not blindly retry HTTP ${status}`, async () => {
    let attempts = 0;
    await assert.rejects(retryLiveRequest(async () => {
      attempts++;
      throw Object.assign(new Error('permanent'), { status });
    }, new AbortController().signal, [0, 0]));
    assert.equal(attempts, 1);
  });
}
test('permanent network failure exhausts retries instead of hanging', async () => {
  let attempts = 0;
  await assert.rejects(retryLiveRequest(async () => { attempts++; throw new TypeError('offline'); }, new AbortController().signal, [0, 0]));
  assert.equal(attempts, 3);
  assert.ok(isTransientLiveFailure(new DOMException('timeout', 'TimeoutError')));
});
test('closing the room cancels a retry during backoff', async () => {
  const controller = new AbortController();
  let attempts = 0;
  const pending = retryLiveRequest(async () => { attempts++; throw new TypeError('offline'); }, controller.signal, [10000]);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(attempts, 1);
});
test('an already cancelled session never sends a request', async () => {
  const controller = new AbortController(); controller.abort();
  let called = false;
  await assert.rejects(retryLiveRequest(async () => { called = true; }, controller.signal));
  assert.equal(called, false);
});
test('parallel transcriptions are delivered in spoken order', () => {
  const buffer = new OrderedTranscriptBuffer();
  const first = buffer.issue(), second = buffer.issue(), third = buffer.issue();
  assert.deepEqual(buffer.complete(third, 'três'), []);
  assert.deepEqual(buffer.complete(second, 'dois'), []);
  assert.deepEqual(buffer.complete(first, 'um'), ['um', 'dois', 'três']);
  assert.deepEqual(buffer.complete(first, 'duplicado'), []);
  assert.deepEqual(buffer.complete(999, 'não emitido'), []);
});
test('a failed transcription releases later successful chunks', () => {
  const buffer = new OrderedTranscriptBuffer(); buffer.issue(); buffer.issue();
  assert.deepEqual(buffer.complete(1, 'continuação'), []);
  assert.deepEqual(buffer.complete(0, ''), ['continuação']);
});
test('long-run ordered buffer: 7,200 chunks completed in reverse pairs without duplication', () => {
  const buffer = new OrderedTranscriptBuffer(); const delivered = [];
  for (let i = 0; i < 7200; i += 2) {
    buffer.issue(); buffer.issue();
    delivered.push(...buffer.complete(i + 1, `${i + 1}`), ...buffer.complete(i, `${i}`));
  }
  assert.deepEqual(delivered, Array.from({ length: 7200 }, (_, i) => `${i}`));
});
