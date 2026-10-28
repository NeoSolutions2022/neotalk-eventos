// Actual component closures with deterministic hooks. This is orchestration
// coverage, not proof of Unity rendering (the browser test is a separate gate).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../app/QualityAdmin.tsx', import.meta.url), 'utf8');
function harness() {
  const effects = [], listeners = new Map(), timers = [], commands = [], stateWrites = [], calls = [], frames = [];
  const window = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name),
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {}, setInterval() {}, clearInterval() {} };
  const react = { useRef: value => ({ current: value }), useState: value => [value, next => stateWrites.push(next)],
    useEffect: fn => effects.push(fn), useCallback: fn => fn };
  const jsx = (type, props) => { if (type === 'iframe') frames.push(props); return null; };
  const context = vm.createContext({ exports: {}, window, process: { env: { NEXT_PUBLIC_AVATAR_WIDGET_URL: 'https://qa-widget.test/widget' } },
    URL, console, Date, Blob, Error,
    require: name => ({ react, 'react/jsx-runtime': { jsx, jsxs: jsx },
      './avatarMessages': { isNonBlockingAvatarError: () => false },
      './apiClient': { API_BASE: '/api/v1', ApiError: Error, apiRequest: async (path, options) => { calls.push({ path, options }); return { id: 'qa-run', gloss_text: 'EU APRENDER' }; } },
    })[name] });
  const exposed = source.replace('  return <>', '  globalThis.qa = { frameRef, executeTest, selectAvatar };\n  return <>');
  vm.runInContext(ts.transpileModule(exposed, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, context);
  context.exports.default({ showToast() {} });
  const frame = { postMessage: value => commands.push(value) };
  context.qa.frameRef.current = { contentWindow: frame };
  effects.forEach(effect => effect());
  return { frames, timers, commands, stateWrites, calls, qa: context.qa,
    message(data, origin = 'https://qa-widget.test', eventSource = frame) { listeners.get('message')({ origin, source: eventSource, data }); } };
}
test('quality delegates looping to the widget and never schedules a new sign from playing', () => {
  const qa = harness();
  assert.equal(new URL(qa.frames[0].src).searchParams.get('loop'), '1');
  const timersBefore = qa.timers.length;
  for (let i = 0; i < 100; i++) qa.message({ type: 'neotalk:playing', words: ['EU', 'APRENDER'] });
  assert.equal(qa.timers.length, timersBefore);
  assert.equal(qa.commands.filter(command => command.type === 'neotalk:sign').length, 0);
});
test('playing from another origin or frame cannot alter quality state', () => {
  const qa = harness(), before = qa.stateWrites.length;
  qa.message({ type: 'neotalk:playing' }, 'https://untrusted.test');
  qa.message({ type: 'neotalk:playing' }, 'https://qa-widget.test', {});
  assert.equal(qa.stateWrites.length, before);
});
test('starting another comparison pauses the old clip before the real run is requested', async () => {
  const qa = harness(); await qa.qa.executeTest();
  assert.equal(qa.commands[0].type, 'neotalk:pause');
  assert.equal(qa.calls[0].path, '/admin/quality-runs');
  assert.equal(qa.commands.filter(command => command.type === 'neotalk:sign').length, 0);
});
test('avatar switching waits for readiness instead of scheduling sign by a time estimate', () => {
  const qa=harness(), before=qa.timers.length;
  qa.qa.selectAvatar('elia');assert.equal(qa.commands.length,0);
  qa.qa.selectAvatar('lia');assert.equal(qa.commands.length,1);
  assert.equal(qa.commands[0].type,'neotalk:set-avatar');assert.equal(qa.commands[0].avatar,'lia');
  assert.equal(qa.timers.length,before);
});
test('stale avatar readiness and malformed events do not change quality state', () => {
  const qa=harness(), before=qa.stateWrites.length;
  qa.message({type:'neotalk:ready',avatar:'asuna'});qa.message(null);
  assert.equal(qa.stateWrites.length,before);
});
