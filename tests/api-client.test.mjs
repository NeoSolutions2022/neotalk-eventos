import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
const source = await readFile(new URL('../app/apiClient.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
function client(fetcher) {
  const timers = new Map(); let timerId = 0;
  const context = vm.createContext({ exports: {}, process: { env: { NEXT_PUBLIC_API_URL: '/api/v1' } }, Headers, AbortController, DOMException, Error, SyntaxError,
    fetch: fetcher, setTimeout(callback) { timers.set(++timerId, callback); return timerId; }, clearTimeout(id) { timers.delete(id); } });
  vm.runInContext(outputText, context);
  return { ...context.exports, timers };
}
test('HTTP 204 does not attempt to decode an empty response', async () => {
  const api = client(async () => ({ ok: true, status: 204, json() { throw new Error('must not decode'); } }));
  assert.equal(await api.apiRequest('/heartbeat'), undefined);
  assert.equal(api.timers.size, 0);
});
test('CSRF and cookies are sent on mutations, not CSRF on GET', async () => {
  const calls = [];
  const api = client(async (url, options) => { calls.push({ url, options }); return { ok: true, status: 204 }; });
  api.setSession({ csrf_token: 'qa-token' });
  await api.apiRequest('/rooms', { method: 'POST', body: '{}' });
  await api.apiRequest('/rooms');
  assert.equal(calls[0].url, '/api/v1/rooms');
  assert.equal(calls[0].options.headers.get('X-CSRF-Token'), 'qa-token');
  assert.equal(calls[0].options.credentials, 'include');
  assert.equal(calls[1].options.headers.has('X-CSRF-Token'), false);
});
test('a malformed successful JSON response becomes an actionable API error', async () => {
  const api = client(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected <'); } }));
  await assert.rejects(api.apiRequest('/translate'), { status: 502, message: 'A API retornou uma resposta inválida.' });
  assert.equal(api.timers.size, 0);
});
for (const status of [401, 403, 422, 502, 503]) {
  test(`HTTP ${status} is preserved even when its body is HTML`, async () => {
    const api = client(async () => ({ ok: false, status, json: async () => { throw new SyntaxError('HTML'); } }));
    await assert.rejects(api.apiRequest('/translate'), { status, message: `Falha da API (${status})` });
    assert.equal(api.timers.size, 0);
  });
}
test('validation arrays never leak [object Object] into the UI', async () => {
  const api = client(async () => ({ ok: false, status: 422, json: async () => ({ detail: [{ msg: 'required' }] }) }));
  await assert.rejects(api.apiRequest('/translate'), { status: 422, message: 'Falha da API (422)' });
});
test('request timeout remains active AFTER headers while a response body stalls', async () => {
  let bodyStarted;
  const ready = new Promise(resolve => { bodyStarted = resolve; });
  const api = client(async (_, { signal }) => ({ ok: true, status: 200,
    json: () => new Promise((_, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }); bodyStarted(); }) }));
  const pending = api.apiRequest('/translate');
  await ready;
  assert.equal(api.timers.size, 1);
  [...api.timers.values()][0]();
  await assert.rejects(pending, { name: 'TimeoutError' });
  assert.equal(api.timers.size, 0);
});
test('caller cancellation interrupts response decoding and clears timers', async () => {
  const controller = new AbortController();
  let bodyStarted;
  const ready = new Promise(resolve => { bodyStarted = resolve; });
  const api = client(async (_, { signal }) => ({ ok: true, status: 200,
    json: () => new Promise((_, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }); bodyStarted(); }) }));
  const pending = api.apiRequest('/translate', { signal: controller.signal });
  await ready; controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(api.timers.size, 0);
});
