import test from 'node:test';
import assert from 'node:assert/strict';
import { translate, concatenatePoses, PoseCache } from '../src/engine.mjs';
const entries = [{ gloss: 'EU' }, { gloss: 'ACOMPANHAR', aliases: ['acompanho', 'acompanhar'] }, { gloss: 'PERGUNTAR_DÚVIDA', aliases: ['perguntar dúvida'] }];
test('accents, punctuation and compounds use longest match', () => {
  assert.equal(translate('Eu perguntar dúvida!', entries).gloss_text, 'EU PERGUNTAR_DÚVIDA');
});
test('does not invent or silently replace missing words', () => {
  const result = translate('Eu vou acompanhar', entries);
  assert.equal(result.gloss_text, 'EU ACOMPANHAR'); assert.deepEqual(result.missing, ['VOU']);
});
test('conflicting aliases are rejected', () => {
  assert.throws(() => translate('', [{ gloss: 'A', aliases: ['x'] }, { gloss: 'B', aliases: ['x'] }]), /ambíguo/);
});
const pose = '# Frame: f0 - Body Keypoints\nNose: 1 2 3 1\n# Frame: f0 - Left Hand Keypoints\nThumb: 4 5 6 1\n# Frame: f1 - Body Keypoints\nNose: 2 3 4 1\n';
test('concatenation keeps sections together and renumbers without changing coordinates', () => {
  const result = concatenatePoses([pose, pose]);
  assert.equal(result.frame_count, 4);
  assert.match(result.content, /frame_000000000002_keypoints.json - Left Hand/);
  assert.equal(result.content.match(/Nose: 1 2 3 1/g).length, 2);
});
test('malformed or oversized poses fail explicitly', () => {
  assert.throws(() => concatenatePoses(['garbage']), /inválido/);
  assert.throws(() => concatenatePoses([pose], 1), /limite/);
});
test('replay reuses the sequence instead of generating another pose', async () => {
  const cache = new PoseCache(); let count = 0;
  const create = async () => { count++; return { pose: { content_url: URL.createObjectURL(new Blob(['pose'])) } }; };
  const first = await cache.get('AMIGO', create); const second = await cache.get('AMIGO', create);
  assert.equal(first, second); assert.equal(count, 1); cache.dispose();
});
