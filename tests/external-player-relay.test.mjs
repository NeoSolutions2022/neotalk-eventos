import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../public/external-player-relay.js', import.meta.url), 'utf8');
function harness() {
  const sent = [];
  const opener = {};
  let receive;
  const window = { opener, location: { origin: 'null' }, addEventListener: (_, callback) => { receive = callback; } };
  const document = {
    currentScript: { src: 'https://plataforma.neotalk.app/external-player-relay.js' },
    querySelector: () => ({ src: 'https://avatar.example/widget', contentWindow: { postMessage: (...args) => sent.push(args) } }),
  };
  runInNewContext(source, { window, document, URL });
  return { opener, sent, receive };
}
test('PiP about:blank forwards the authorized opener command to the widget origin', () => {
  const { opener, sent, receive } = harness();
  const message = { type: 'neotalk:sign', phrase: 'TESTE' };
  receive({ source: opener, origin: 'https://plataforma.neotalk.app', data: { type: 'neotalk:external-player-command', message, widgetOrigin: 'https://attacker.example' } });
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], message);
  assert.equal(sent[0][1], 'https://avatar.example');
});
test('rejects a different window, a different origin and malformed commands', () => {
  const { opener, sent, receive } = harness();
  const data = { type: 'neotalk:external-player-command', message: { type: 'neotalk:sign' } };
  receive({ source: {}, origin: 'https://plataforma.neotalk.app', data });
  receive({ source: opener, origin: 'https://attacker.example', data });
  receive({ source: opener, origin: 'https://plataforma.neotalk.app', data: null });
  assert.equal(sent.length, 0);
});
