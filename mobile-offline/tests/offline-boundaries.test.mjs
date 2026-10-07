import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const read = path => readFile(new URL(path, import.meta.url), 'utf8');
test('local ASR refuses remote models and pins Portuguese', async () => {
  const source = await read('../src/speech.worker.ts');
  assert.match(source, /allowRemoteModels = false/);
  assert.match(source, /language: 'portuguese'/);
  assert.match(source, /numThreads = 1/);
});
test('native configuration loads packaged files, not the production website', async () => {
  const source = await read('../capacitor.config.ts');
  assert.match(source, /webDir: 'dist'/);
  assert.doesNotMatch(source, /url:\s*['"]https?:/);
});
test('offline live room cannot use cloud SpeechRecognition', async () => {
  const source = await read('../../app/LiveRoom.tsx');
  assert.match(source, /const SpeechRecognitionApi = offline \? undefined/);
  assert.match(source, /!recording && !captureAvailable/);
  assert.match(source, /\(!offline && !navigator.onLine\)/);
});
test('both platforms declare microphone usage', async () => {
  assert.match(await read('../android/app/src/main/AndroidManifest.xml'), /android.permission.RECORD_AUDIO/);
  assert.match(await read('../ios/App/App/Info.plist'), /NSMicrophoneUsageDescription/);
});
test('missing or incomplete dataset cannot pass the native release gate', async () => {
  const result = spawnSync(process.execPath, ['scripts/verify-release.mjs'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  // This workspace intentionally has a development catalog. Full release
  // fixtures belong to device/CI validation, never replace the user dataset.
  const catalog = await read('../public/offline/catalog.json').then(JSON.parse).catch(() => null);
  if (!catalog?.complete) assert.notEqual(result.status, 0);
});
