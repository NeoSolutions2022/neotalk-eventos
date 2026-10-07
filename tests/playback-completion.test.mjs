import test from 'node:test';
import assert from 'node:assert/strict';
import { playbackComplete } from '../app/playbackCompletion.mjs';

test('hidden principal never blocks the completed visible mini-player', () => {
  assert.equal(playbackComplete({ primaryDone: false, externalDone: true, externalRequired: true }, true, true), true);
});
test('never advances before the mini-player has really finished', () => {
  assert.equal(playbackComplete({ primaryDone: true, externalDone: false, externalRequired: true }, true, true), false);
});
test('visible dual players require both final frames', () => {
  assert.equal(playbackComplete({ primaryDone: false, externalDone: true, externalRequired: true }, false, true), false);
  assert.equal(playbackComplete({ primaryDone: true, externalDone: true, externalRequired: true }, false, true), true);
});
test('closing mini-player restores primary completion requirement', () => {
  assert.equal(playbackComplete({ primaryDone: false, externalDone: true, externalRequired: true }, true, false), false);
  assert.equal(playbackComplete({ primaryDone: true, externalDone: false, externalRequired: true }, true, false), true);
});
