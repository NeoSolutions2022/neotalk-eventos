import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../app/presentationDeck.ts', import.meta.url), 'utf8');
const context = vm.createContext({ exports: {} });
vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
const { buildPresentationPhrases, PresentationShuffle, PRESENTATION_DISCLOSURE } = context.exports;
test('large illustrative deck uses only real catalog words and 64 unique short sequences', () => {
  const catalog = Array.from({length:800}, (_,i) => `SINAL_${i}`);
  const phrases = Array.from(buildPresentationPhrases(catalog));
  assert.equal(phrases.length,64); assert.equal(new Set(phrases).size,64);
  for (const phrase of phrases) { assert.equal(phrase.split(' ').length,2); assert.ok(phrase.split(' ').every(word => catalog.includes(word))); }
  assert.equal(buildPresentationPhrases([]).length,0);
  assert.equal(buildPresentationPhrases(['AMIGO']).length,0);
});
test('shuffle avoids all repeats within a cycle and the previous 12 across cycle boundaries', () => {
  const phrases = Array.from(buildPresentationPhrases(Array.from({length:50}, (_,i) => `SINAL_${i}`)));
  const shuffle = new PresentationShuffle(() => .37);
  const played = Array.from({length:192},() => shuffle.next(phrases));
  for(let offset=0; offset<192; offset+=64) assert.equal(new Set(played.slice(offset,offset+64)).size,64);
  for(let i=1;i<played.length;i++) assert.ok(!played.slice(Math.max(0,i-12),i).includes(played[i]));
});
test('dataset additions participate and the simulated nature stays explicit', () => {
  const phrases = Array.from(buildPresentationPhrases(['amigo.pose', 'APRENDER','ACOMPANHAR']));
  assert.ok(phrases.some(phrase => phrase.includes('ACOMPANHAR')));
  assert.equal(PRESENTATION_DISCLOSURE,'Modo demonstração');
});

test('presentation controls are concise while retaining an accessible selector and mode indicator', async () => {
  const room = await readFile(new URL('../app/LiveRoom.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(room,/Modo apresentação · experimental|Variedade da apresentação|Não é tradução em Libras|não o significado das legendas|sinais ilustrativos/);
  assert.match(room,/aria-label="Quantidade de sequências da apresentação"/);
  assert.match(room,/presentationMode \? PRESENTATION_DISCLOSURE : "PT → LIBRAS"/);
});
