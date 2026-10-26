import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const c = vm.createContext({ exports: {} });
vm.runInContext(ts.transpileModule(await readFile(new URL('../app/captureAudio.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, c);
const { acquireCapture, effectiveCapture, needsManagedCapture } = c.exports;
const plain = value => JSON.parse(JSON.stringify(value));
const normal = { deviceId: '', profile: 'standard', compatible: false };
test('default mode does not invent filters or force a new transcription engine', async () => {
  let request;
  const stream = {};
  assert.equal(needsManagedCapture(normal), false);
  assert.equal(await acquireCapture({ getUserMedia: async input => { request = input; return stream; } }, normal), stream);
  assert.deepEqual(plain(request), { audio: true, video: false });
});
test('hardware/profile selection requires managed capture with supported ideal filters only', async () => {
  let request;
  const selection = { ...normal, deviceId: 'private-device', profile: 'lecture' };
  assert.equal(needsManagedCapture(selection), true);
  await acquireCapture({ getSupportedConstraints: () => ({ deviceId: true, noiseSuppression: true, echoCancellation: true }),
    getUserMedia: async input => { request = input; } }, selection);
  assert.deepEqual(plain(request), { audio: { deviceId: { exact: 'private-device' }, echoCancellation: { ideal: true }, noiseSuppression: { ideal: true } }, video: false });
});
test('direct input requests filters off but does not claim the browser honored them', async () => {
  let request;
  await acquireCapture({ getSupportedConstraints: () => ({ autoGainControl: true }), getUserMedia: async input => { request = input; } }, { ...normal, profile: 'direct' });
  assert.deepEqual(plain(request), { audio: { autoGainControl: { ideal: false } }, video: false });
});
test('missing explicit hardware is never silently replaced with another microphone', async () => {
  let calls = 0;
  await assert.rejects(acquireCapture({ getSupportedConstraints: () => ({}), getUserMedia: async () => calls++ }, { ...normal, deviceId: 'missing' }), /selecionar/);
  assert.equal(calls, 0);
  await assert.rejects(acquireCapture({ getSupportedConstraints: () => ({ deviceId: true }), getUserMedia: async () => { calls++; throw new Error('device absent'); } }, { ...normal, deviceId: 'missing' }), /device absent/);
  assert.equal(calls, 1);
});
test('effective settings are allowlisted and unknown stays unknown, without hardware identifiers', () => {
  const report = effectiveCapture({ getSettings: () => ({ echoCancellation: true, noiseSuppression: false, deviceId: 'private', groupId: 'private' }) });
  assert.match(report, /Eco: ligado/); assert.match(report, /Ruído: desligado/); assert.match(report, /Ganho: não informado/);
  assert.ok(!report.includes('private'));
  assert.match(effectiveCapture({ getSettings() { throw Error('denied'); } }), /não informou/);
});
