// Executes the actual component's closures with deterministic hooks and widget/API
// doubles. This verifies orchestration, NOT Unity rendering or browser microphone.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const compilerOptions = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX };
const sources = {};
for (const name of ['LiveRoom', 'liveResilience', 'liveTiming', 'avatarMessages']) {
  sources[name] = await readFile(new URL(`../app/${name}.${name === 'LiveRoom' ? 'tsx' : 'ts'}`, import.meta.url), 'utf8');
}
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; }
function harness(handler = async path => path === '/rooms' ? { id: 'room-qa' } : path.includes('/batches') ? { id: 'batch-qa' } : {}) {
  const calls = [], commands = [], externalCommands = [], toasts = [], timers = new Map(), listeners = new Map();
  const slots = []; let hook = 0, nextTimer = 0, recording = false;
  class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
  class Recognition { start() { this.starts = (this.starts || 0) + 1; } abort() {} stop() {} }
  const track = { label: 'QA microphone', stop() { this.stopped = true; } };
  const setTimeoutFake = (fn, ms) => { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; };
  const window = { SpeechRecognition: Recognition, location: { origin: 'https://qa.neotalk.test' }, setTimeout: setTimeoutFake,
    clearTimeout: id => timers.delete(id), setInterval: setTimeoutFake, clearInterval: id => timers.delete(id),
    addEventListener: (kind, fn) => listeners.set(kind, fn), removeEventListener: kind => listeners.delete(kind) };
  const react = {
    useRef(value) { const id = hook++; return slots[id] ||= { current: value }; },
    useState(value) { const id = hook++; if (!(id in slots)) slots[id] = typeof value === 'function' ? value() : value;
      return [slots[id], next => { slots[id] = typeof next === 'function' ? next(slots[id]) : next; }]; },
    useEffect(fn) { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup); },
  };
  const cleanups = [];
  const context = vm.createContext({ exports: {}, window, navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) } },
    document: { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' }, process: { env: {} }, URL, AbortController, AbortSignal, DOMException, Blob,
    console, Error, TypeError, SyntaxError, setTimeout: setTimeoutFake, clearTimeout: window.clearTimeout, btoa: value => Buffer.from(value).toString('base64') });
  const modules = {
    react, 'react/jsx-runtime': { jsx: () => null, jsxs: () => null, Fragment: Symbol('fragment') },
    './apiClient': { ApiError, apiRequest: async (path, options = {}) => { calls.push({ path, options }); return handler(path, options); } },
  };
  context.require = name => modules[name];
  for (const name of ['liveResilience', 'liveTiming', 'avatarMessages']) {
    context.exports = {};
    vm.runInContext(ts.transpileModule(sources[name], { compilerOptions }).outputText, context, { filename: `${name}.ts` });
    modules[`./${name}`] = context.exports;
  }
  // Test-only exposure: no debug API is included in shipped component source.
  const exposed = ['nativePlaybackRef', 'avatarSupportsNativePlaybackRef', 'externalSupportsNativePlaybackRef', 'handleNativePlaybackFrame', 'finishNativePlayback', 'startLiveRoom', 'stopLiveRoom', 'enqueueBatch', 'completeActiveBatch', 'runHeartbeat', 'sendToAvatar', 'playIdleLoopPhrase', 'queueFallbackTranscription', 'startFallbackChunk', 'fallbackStreamRef', 'fallbackTranscriptionQueueRef', 'fallbackTranscriptionInFlightRef',
    'frameRef', 'externalFrameRef', 'externalWindowRef', 'embeddedAvatarReadyRef', 'externalAvatarReadyRef', 'externalSupportsSharedPoseRef',
    'avatarSupportsSharedPoseRef', 'avatarReadyRef', 'listeningRef', 'recognitionRef', 'pendingBatchesRef', 'activeBatchRef', 'agentPromisesRef',
    'agentResultsRef', 'remoteBatchIdsRef', 'desiredBatchStatusRef', 'latestPoseRef', 'recentPosesRef', 'recentPhrasesRef', 'playbackTimerRef', 'avatarPlaybackStartedRef', 'wordBufferRef', 'roomIdRef', 'sessionScopeRef', 'microphoneMutedRef', 'addTranscriptToBuffer', 'flushWordBuffer', 'toggleMicrophone', 'releaseAvatarAfterRetryFailure'];
  const source = sources.LiveRoom.replace('  return <>', `  globalThis.qa = { ${exposed.join(', ')} };\n  return <>`);
  context.exports = {};
  vm.runInContext(ts.transpileModule(source, { compilerOptions }).outputText, context, { filename: 'LiveRoom.tsx' });
  const component = context.exports.default;
  component({ recording, setRecording: value => { recording = value; }, time: '00:00', showToast: value => toasts.push(value) });
  const qa = context.qa;
  const frameWindow = { postMessage: command => commands.push(command) };
  qa.frameRef.current = { contentWindow: frameWindow };
  qa.embeddedAvatarReadyRef.current = true; qa.avatarReadyRef.current = true;
  return { qa, calls, commands, externalCommands, toasts, timers, track, ApiError, navigator: context.navigator, context,
    message(data, source = frameWindow, origin = 'https://infra-avatar3d-oficial.k3p3ex.easypanel.host') { listeners.get('message')({ data, source, origin }); },
    external() { const externalFrame = {}; qa.externalFrameRef.current = { contentWindow: externalFrame };
      qa.externalWindowRef.current = { closed: false, postMessage: command => externalCommands.push(command) };
      qa.externalAvatarReadyRef.current = true; qa.externalSupportsSharedPoseRef.current = true; qa.avatarSupportsSharedPoseRef.current = true; return externalFrame; },
    get recording() { return recording; } };
}
test('native completion waits for the actual terminal frame of both outputs', async () => {
  const h = harness(async path => path === '/agent/translate' ? { gloss_text: 'TESTE' } : { id: 'qa' });
  const external = h.external();
  h.qa.avatarSupportsNativePlaybackRef.current = true;
  h.qa.externalSupportsNativePlaybackRef.current = true;
  await h.qa.startLiveRoom(); h.qa.enqueueBatch('teste'); await flush();
  h.message({ type: 'neotalk:pose-ready', phrase: 'TESTE', loadId: 'primary', pose: { content_url: '/test.pose', fps: 30, frame_count: 90 } });
  h.message({ type: 'neotalk:playing', phrase: 'TESTE', loadId: 'primary' });
  h.message({ type: 'neotalk:playing', phrase: 'TESTE', correlationId: 'primary', loadId: 'external' }, external);
  const frame = (loadId, status, index = 89) => ({ type: 'neotalk:playback-frame', loadId, status, frame: index, frameCount: 90, fps: 30 });
  h.message(frame('stale', 'finished'));
  h.message(frame('primary', 'finished', 88));
  assert.ok(h.qa.activeBatchRef.current, 'stale or nonterminal reports cannot complete');
  h.message(frame('primary', 'finished'));
  assert.ok(h.qa.activeBatchRef.current, 'main finishing must not cut off floating output');
  h.message(frame('external', 'finished'), external);
  assert.equal(h.qa.activeBatchRef.current, null);
  h.message(frame('external', 'finished'), external);
  assert.equal(h.qa.activeBatchRef.current, null);
  h.qa.stopLiveRoom();
});

test('native generation ignores late completion after room stop', async () => {
  const h = harness(async path => path === '/agent/translate' ? { gloss_text: 'TESTE' } : { id: 'qa' });
  h.qa.avatarSupportsNativePlaybackRef.current = true;
  await h.qa.startLiveRoom(); h.qa.enqueueBatch('teste'); await flush();
  h.message({ type: 'neotalk:playing', phrase: 'TESTE', loadId: 'primary' });
  assert.equal(h.timers.get(h.qa.playbackTimerRef.current).ms, 20000, 'native timer is a stall guard, not nominal completion');
  h.qa.stopLiveRoom();
  h.message({ type: 'neotalk:playback-frame', loadId: 'primary', status: 'finished', frame: 89, frameCount: 90 });
  assert.equal(h.qa.activeBatchRef.current, null);
  assert.equal(h.recording, false);
});

test('closing the external output releases an already finished native primary', async () => {
  const h = harness(async path => path === '/agent/translate' ? { gloss_text: 'TESTE' } : { id: 'qa' });
  h.external(); h.qa.avatarSupportsNativePlaybackRef.current = true;
  await h.qa.startLiveRoom(); h.qa.enqueueBatch('teste'); await flush();
  h.message({ type: 'neotalk:playing', phrase: 'TESTE', loadId: 'primary' });
  h.qa.nativePlaybackRef.current.externalRequired = true;
  h.message({ type: 'neotalk:playback-frame', loadId: 'primary', status: 'finished', frame: 89, frameCount: 90 });
  assert.ok(h.qa.activeBatchRef.current);
  h.qa.externalWindowRef.current.closed = true; h.qa.finishNativePlayback();
  assert.equal(h.qa.activeBatchRef.current, null); h.qa.stopLiveRoom();
});

test('accepted native execution survives prolonged missing progress without replay, discard or reset', async () => {
  const h = harness(async path => path === '/agent/translate' ? { gloss_text: 'TESTE' } : { id: 'qa' });
  h.qa.avatarSupportsNativePlaybackRef.current = true;
  await h.qa.startLiveRoom(); h.qa.enqueueBatch('teste'); await flush();
  h.message({ type: 'neotalk:playing', phrase: 'TESTE', loadId: 'primary' });
  const active = h.qa.activeBatchRef.current;
  const count = h.commands.length;
  for (let i = 0; i < 180; i++) h.timers.get(h.qa.playbackTimerRef.current).fn();
  assert.equal(h.qa.activeBatchRef.current, active);
  assert.equal(h.commands.length, count, 'one virtual hour of delay must not replay or replace the pose');
  h.message({ type: 'neotalk:error', phrase: 'TESTE', code: 'pose_ack_timeout', message: 'late timeout' });
  assert.equal(h.qa.activeBatchRef.current, active);
  h.message({ type: 'neotalk:playback-frame', loadId: 'primary', status: 'finished', frame: 89, frameCount: 90 });
  assert.equal(h.qa.activeBatchRef.current, null);
  h.qa.stopLiveRoom();
});

test('accepted processing delay preserves its batch without sending another command', async () => {
  const h = harness(async path => path === '/agent/translate' ? { gloss_text: 'TESTE' } : { id: 'qa' });
  await h.qa.startLiveRoom(); h.qa.enqueueBatch('teste'); await flush();
  h.message({ type: 'neotalk:status', status: 'processing', phrase: 'TESTE' });
  const active = h.qa.activeBatchRef.current, count = h.commands.length;
  for (let i = 0; i < 12; i++) {
    const timer = [...h.timers.values()].filter(t => t.ms === 20000).at(-1);
    assert.ok(timer); timer.fn();
  }
  assert.equal(h.qa.activeBatchRef.current, active);
  assert.equal(h.commands.length, count);
  h.qa.stopLiveRoom();
});

test('double-click startup creates exactly one room and forces pt-BR', async () => {
  const h = harness(); await Promise.all([h.qa.startLiveRoom(), h.qa.startLiveRoom()]);
  assert.equal(h.calls.filter(c => c.path === '/rooms').length, 1);
  assert.equal(h.qa.recognitionRef.current.lang, 'pt-BR');
  assert.equal(h.recording, true); h.qa.stopLiveRoom();
});
test('stop discards pending words, batches, timers, and async translations', async () => {
  const translation = deferred();
  const h = harness(async path => path === '/agent/translate' ? translation.promise : path === '/rooms' ? { id: 'room-qa' } : { id: 'batch-qa' });
  await h.qa.startLiveRoom(); h.qa.enqueueBatch('bom dia'); h.qa.wordBufferRef.current.push('resto');
  h.qa.stopLiveRoom(); translation.resolve({ gloss_text: 'BOM DIA' }); await flush();
  assert.equal(h.qa.pendingBatchesRef.current.length, 0);
  assert.equal(h.qa.activeBatchRef.current, null);
  assert.equal(h.qa.agentPromisesRef.current.size, 0);
  assert.equal(h.qa.wordBufferRef.current.length, 0);
  assert.equal(h.commands.some(c => c.type === 'neotalk:sign'), false);
  assert.ok(h.commands.some(c => c.type === 'neotalk:pause'));
});
test('a delayed translation from room A cannot enter restarted room B', async () => {
  const translation = deferred();
  const h = harness(async path => path === '/agent/translate' ? translation.promise : path === '/rooms' ? { id: 'room-qa' } : { id: 'batch-qa' });
  await h.qa.startLiveRoom(); h.qa.enqueueBatch('sala anterior'); h.qa.stopLiveRoom();
  await h.qa.startLiveRoom(); translation.resolve({ gloss_text: 'ANTERIOR' }); await flush();
  assert.equal(h.qa.pendingBatchesRef.current.length, 0);
  assert.equal(h.qa.agentResultsRef.current.size, 0);
  assert.equal(h.commands.some(c => c.phrase === 'ANTERIOR'), false); h.qa.stopLiveRoom();
});
test('an untranslated fragment is skipped without preventing the next valid phrase', async () => {
  let count = 0;
  const h = harness(async path => path === '/agent/translate' ? (++count === 1 ? { skipped: true, gloss_text: '', reason: 'sem glosa' } : { gloss_text: 'BOM DIA' }) : path === '/rooms' ? { id: 'room-qa' } : { id: 'batch-qa' });
  await h.qa.startLiveRoom(); h.qa.enqueueBatch('fragmento'); h.qa.enqueueBatch('bom dia'); await flush();
  assert.equal(h.qa.activeBatchRef.current.glossText, 'BOM DIA'); h.qa.stopLiveRoom();
});
test('malformed, unauthorized-origin and wrong-frame messages are ignored', () => {
  const h = harness();
  for (const data of [null, [], 42, 'bad']) assert.doesNotThrow(() => h.message(data));
  h.qa.embeddedAvatarReadyRef.current = false;
  h.message({ type: 'neotalk:ready' }, {}, 'https://evil.test');
  assert.equal(h.qa.embeddedAvatarReadyRef.current, false);
});
test('mini-player gets the identical shared pose rather than a second translation', async () => {
  const h = harness(async path => path === '/agent/translate' ? { gloss_text: 'BOM DIA' } : { id: 'room-qa' }); h.external();
  await h.qa.startLiveRoom(); h.qa.enqueueBatch('bom dia'); await flush();
  const pose = { phrase: 'BOM DIA', pose: { content_url: 'https://qa.test/sign.pose', fps: 30, frame_count: 90 }, words: ['BOM', 'DIA'], loadId: 'qa-load' };
  h.message({ type: 'neotalk:pose-ready', ...pose });
  const command = h.externalCommands.find(c => c.message?.type === 'neotalk:load-pose');
  assert.ok(command); assert.equal(command.message.pose.content_url, pose.pose.content_url);
  assert.equal(h.calls.filter(c => c.path === '/agent/translate').length, 1);
  h.qa.stopLiveRoom();
});
test('duplicate playing acknowledgements do not restart the playback clock', async () => {
  const h = harness(async path => path === '/agent/translate' ? { gloss_text: 'BOM DIA' } : path === '/rooms' ? { id: 'room-qa' } : { id: 'batch-qa' });
  await h.qa.startLiveRoom(); h.qa.enqueueBatch('bom dia'); await flush();
  h.message({ type: 'neotalk:playing', phrase: 'BOM DIA' });
  const timer = h.qa.playbackTimerRef.current;
  h.message({ type: 'neotalk:playing', phrase: 'BOM DIA' });
  assert.equal(h.qa.playbackTimerRef.current, timer); h.qa.stopLiveRoom();
});
test('404 heartbeat stops a closed room instead of reviving it', async () => {
  let h;
  h = harness(async path => { if (path.endsWith('/heartbeat')) throw new h.ApiError(404, 'closed'); return { id: 'room-qa' }; });
  await h.qa.startLiveRoom(); await h.qa.runHeartbeat();
  assert.equal(h.recording, false);
  assert.equal(h.calls.filter(c => c.path.endsWith('/start')).length, 1);
});
test('ending during microphone permission does not create a room or leak its track', async () => {
  const permission = deferred(); const h = harness();
  h.navigator.mediaDevices.getUserMedia = () => permission.promise;
  const startup = h.qa.startLiveRoom(); h.qa.stopLiveRoom();
  permission.resolve({ getTracks: () => [h.track], getAudioTracks: () => [h.track] });
  await startup;
  assert.equal(h.track.stopped, true);
  assert.equal(h.calls.filter(c => c.path === '/rooms').length, 0);
});
test('transient translation failure retries and then reaches the widget', async () => {
  let count = 0, h;
  h = harness(async path => { if (path === '/agent/translate') {
    if (++count === 1) throw new h.ApiError(502, 'temporary'); return { gloss_text: 'TESTE' };
  } return { id: 'qa' }; });
  await h.qa.startLiveRoom(); h.qa.enqueueBatch('teste'); await flush();
  const backoff = [...h.timers.values()].find(timer => timer.ms === 350); assert.ok(backoff);
  backoff.fn(); await flush();
  assert.equal(count, 2); assert.equal(h.qa.activeBatchRef.current.glossText, 'TESTE'); h.qa.stopLiveRoom();
});
test('widget loading-avatar status prevents dispatch to an unready runtime', async () => {
  const h = harness(async path => path === '/agent/translate' ? { gloss_text: 'TESTE' } : { id: 'qa' });
  await h.qa.startLiveRoom(); h.message({ type: 'neotalk:status', status: 'loading_avatar' });
  h.qa.enqueueBatch('teste'); await flush();
  assert.equal(h.qa.activeBatchRef.current, null);
  assert.equal(h.commands.some(c => c.type === 'neotalk:sign'), false); h.qa.stopLiveRoom();
});
test('late shared-pose notification after stop cannot restart the mini-player', async () => {
  const h = harness(async path => path === '/agent/translate' ? { gloss_text: 'TESTE' } : { id: 'qa' }); h.external();
  await h.qa.startLiveRoom(); h.qa.enqueueBatch('teste'); await flush(); h.qa.stopLiveRoom();
  const before = h.externalCommands.length;
  h.message({ type: 'neotalk:pose-ready', phrase: 'TESTE', pose: { content_url: '/test.pose' }, loadId: 'late' });
  assert.equal(h.externalCommands.length, before); assert.equal(h.qa.latestPoseRef.current, null);
});
test('virtual long-run orchestration: 1,200 sequential phrases, bounded session metadata', async () => {
  let batch = 0;
  const h = harness(async path => path === '/agent/translate' ? { gloss_text: 'TESTE' } : path === '/rooms' ? { id: 'room-qa' } : { id: `batch-${++batch}` });
  await h.qa.startLiveRoom();
  for (let i = 0; i < 1200; i++) {
    h.qa.enqueueBatch(`teste ${i}`); await flush();
    assert.ok(h.qa.activeBatchRef.current, `batch ${i} must reach widget`);
    h.qa.completeActiveBatch(); await flush();
    assert.equal(h.qa.agentResultsRef.current.size, 0);
    assert.equal(h.qa.remoteBatchIdsRef.current.size, 0);
    assert.equal(h.qa.desiredBatchStatusRef.current.size, 0);
  }
  assert.equal(h.commands.filter(c => c.type === 'neotalk:sign').length, 1200);
  assert.equal(h.qa.recentPhrasesRef.current.length, 2); h.qa.stopLiveRoom();
});
test('audio overload preserves queued chunk order and gives a rate-limited presenter notice', () => {
  const h = harness(); h.qa.fallbackTranscriptionInFlightRef.current = 2;
  for (let i = 0; i < 20; i++) h.qa.queueFallbackTranscription(new Blob([`${i}`]), 0);
  assert.equal(h.qa.fallbackTranscriptionQueueRef.current.length, 6);
  assert.deepEqual(Array.from(h.qa.fallbackTranscriptionQueueRef.current, chunk => chunk.sequence), [0, 1, 2, 3, 4, 5]);
  assert.equal(h.toasts.filter(text => text.includes('Um trecho')).length, 1);
});

test('stress: 2,000 arrivals while translation stalls must not grow the queue without bound', async () => {
  const held = deferred();
  const h = harness(async path => path === '/agent/translate' ? held.promise : { id: 'qa' });
  await h.qa.startLiveRoom();
  for (let i = 0; i < 2000; i++) h.qa.addTranscriptToBuffer(`frase numero ${i} com palavras para testar a fila agora mesmo aqui`);
  assert.ok(h.qa.pendingBatchesRef.current.length <= 24, `queue grew to ${h.qa.pendingBatchesRef.current.length}`);
  assert.ok(h.qa.wordBufferRef.current.length <= 120);
  assert.ok(h.qa.agentPromisesRef.current.size <= 2);
  assert.equal(h.qa.microphoneMutedRef.current, true);
  assert.equal(h.recording, true);
  h.qa.stopLiveRoom(); held.resolve({ gloss_text: 'TESTE' }); await flush();
  assert.equal(h.commands.some(command => command.type === 'neotalk:sign'), false);
});

test('stress: slow avatar drains every admitted burst in order without resetting either output', async () => {
  let counter = 0;
  const h = harness(async (path, options) => path === '/agent/translate'
    ? { gloss_text: JSON.parse(options.body).text.toUpperCase() }
    : { id: `qa-${++counter}` });
  h.external(); await h.qa.startLiveRoom();
  const admitted = [];
  for (let i = 0; i < 2000; i++) {
    if (h.qa.microphoneMutedRef.current) break; // real recognition callback stops admission
    const text = `frase ${i} com doze palavras de teste para esta fila agora mesmo`;
    admitted.push(...text.split(' ')); h.qa.addTranscriptToBuffer(text); await flush();
  }
  assert.equal(h.qa.microphoneMutedRef.current, true);
  const seen = [];
  for (let tick = 0; tick < 100; tick++) {
    const active = h.qa.activeBatchRef.current;
    if (active) { seen.push(...active.text.split(' ')); h.qa.completeActiveBatch(); }
    await flush();
    if (!h.qa.activeBatchRef.current && !h.qa.pendingBatchesRef.current.length && !h.qa.wordBufferRef.current.length) break;
  }
  assert.deepEqual(seen, admitted);
  assert.equal(h.qa.pendingBatchesRef.current.length, 0);
  assert.equal(h.qa.wordBufferRef.current.length, 0);
  assert.equal(h.qa.agentResultsRef.current.size, 0);
  assert.equal(h.recording, true);
  assert.equal(h.commands.some(c => c.type === 'neotalk:set-avatar'), false);
  h.qa.stopLiveRoom(); await h.qa.startLiveRoom();
  assert.equal(h.qa.microphoneMutedRef.current, false); h.qa.stopLiveRoom();
});

test('stress: 500 untranslated batches leave no failed queue or session metadata behind', async () => {
  let id = 0;
  const h = harness(async path => path === '/agent/translate' ? { skipped: true, gloss_text: '' } : { id: `qa-${++id}` });
  await h.qa.startLiveRoom();
  for (let wave = 0; wave < 50; wave++) {
    for (let i = 0; i < 10; i++) h.qa.enqueueBatch('sem sinal');
    await flush(); await flush();
  }
  assert.equal(h.qa.pendingBatchesRef.current.length, 0);
  assert.equal(h.qa.agentPromisesRef.current.size, 0);
  assert.equal(h.qa.remoteBatchIdsRef.current.size, 0);
  assert.equal(h.recording, true); h.qa.stopLiveRoom();
});

for (const wordsPerMinute of [140, 180, 220]) {
  test(`pitch: five virtual minutes at ${wordsPerMinute} words/min, slow output, no mute or overload notice`, async () => {
    let now = 0, request = 0, id = 0;
    const replies = [], input = [], played = [];
    const h = harness(async (path, options) => {
      if (path !== '/agent/translate') return { id: `pitch-${++id}` };
      const text = JSON.parse(options.body).text;
      const reply = deferred();
      replies.push({ at: now + (++request % 17 === 0 ? 2000 : 400), reply, text });
      return reply.promise;
    });
    await h.qa.startLiveRoom();
    let nextSpeech = 0, flushAt = Infinity, activeId = null, finishAt = Infinity, maxQueue = 0;
    const speechInterval = 360000 / wordsPerMinute; // six-word transcript fragments
    for (now = 0; now < 900000; now += 100) {
      if (now < 300000 && now >= nextSpeech) {
        const words = Array.from({ length: 6 }, (_, i) => `palavra${input.length + i}`);
        input.push(...words); h.qa.addTranscriptToBuffer(words.join(' '));
        flushAt = now + 400; nextSpeech += speechInterval;
      }
      if (now >= flushAt) { h.qa.flushWordBuffer(true); flushAt = Infinity; }
      for (let i = replies.length - 1; i >= 0; i--) if (replies[i].at <= now) {
        const item = replies.splice(i, 1)[0]; item.reply.resolve({ gloss_text: item.text.toUpperCase() });
      }
      await flush();
      const active = h.qa.activeBatchRef.current;
      if (active && active.id !== activeId) {
        activeId = active.id;
        // Explicit synthetic timing assumption: 0.65 gloss/source word,
        // 650 ms/gloss + 80 ms handoff. This is not measured production timing.
        finishAt = now + active.text.split(' ').length * 0.65 * 650 + 80;
      }
      if (active && now >= finishAt) {
        played.push(...active.text.split(' ')); h.qa.completeActiveBatch();
        activeId = null; await flush();
      }
      maxQueue = Math.max(maxQueue, h.qa.pendingBatchesRef.current.length);
      assert.equal(h.qa.microphoneMutedRef.current, false, `unexpected pause at ${now} ms, queue=${maxQueue}`);
      assert.ok(h.qa.agentPromisesRef.current.size <= 2);
      if (now >= 300000 && !h.qa.activeBatchRef.current && !h.qa.pendingBatchesRef.current.length && !h.qa.wordBufferRef.current.length && !replies.length) break;
    }
    assert.deepEqual(played, input, 'all pitch words must be retained and drained in order');
    const persisted = h.calls.filter(call => call.path.endsWith('/batches') && call.options.method === 'POST')
      .flatMap(call => JSON.parse(call.options.body).text.split(' '));
    assert.deepEqual(persisted, input, 'history must persist the sealed compound text, not an earlier fragment');
    assert.ok(maxQueue < 24);
    assert.equal(h.toasts.some(text => /acumul|excedid|não pôde ser processado/.test(text)), false);
    assert.equal(h.commands.some(command => command.type === 'neotalk:set-avatar'), false);
    console.log(`PITCH ${wordsPerMinute} wpm: ${input.length} words; maxQueue=${maxQueue}; drainFinishedAt=${now}ms; translationRequests=${request}`);
    h.qa.stopLiveRoom();
  });
}
test('a recorder constructor failure safely terminates the room instead of throwing from a timer', () => {
  const h = harness(); h.qa.listeningRef.current = true;
  h.context.MediaRecorder = class { static isTypeSupported() { return true; } constructor() { throw new Error('unsupported device'); } };
  h.track.readyState = 'live';
  h.qa.fallbackStreamRef.current = { getAudioTracks: () => [h.track], getTracks: () => [h.track] };
  assert.doesNotThrow(() => h.qa.startFallbackChunk());
  assert.equal(h.qa.listeningRef.current, false);
  assert.equal(h.track.stopped, true);
  assert.ok(h.toasts.some(text => text.includes('captura de áudio')));
});
