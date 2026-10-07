// Offline evidence analysis; no production endpoints or state are modified.
const fs = require('node:fs');
const path = require('node:path');
const file = process.argv[2];
if (!file) throw new Error('Usage: node tests/analyze-pitch-evidence.cjs /absolute/path/ledger.json');
const r = JSON.parse(fs.readFileSync(file, 'utf8'));
const quantiles = values => {
  const sorted = values.sort((a, b) => a - b);
  return { count: sorted.length, p50: sorted[Math.floor(sorted.length * .5)] ?? null, p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))] ?? null, max: sorted.at(-1) ?? null };
};
const tokens = text => text.trim().split(/\s+/);
const input = r.input.flatMap(item => tokens(item.text).map(word => ({ word, at: item.at })));
const lastCompletedAt = Math.max(...r.batches.flatMap(batch => batch.updates.filter(update => update.status === 'done').map(update => update.at)));
const primary = r.events.filter(e => e.type === 'neotalk:playing' && e.at <= lastCompletedAt);
const external = (r.externalEvents || []).filter(e => e.type === 'neotalk:playing');
const missingExternal = primary.filter(e => !external.some(other => other.correlationId === (e.correlationId || e.loadId)));
let offset = 0;
const wordCompletion = [], batchCompletion = [];
for (const batch of r.batches) {
  const done = batch.updates.find(update => update.status === 'done');
  const source = input.slice(offset, offset + tokens(batch.text).length);
  offset += tokens(batch.text).length;
  if (!done || !source.length) continue;
  batchCompletion.push(done.at - source[0].at);
  wordCompletion.push(...source.map(word => done.at - word.at));
}
const analysis = {
  result: r.result, failure: r.failure?.message, inputWords: input.length, batches: r.batches.length,
  completed: r.batches.filter(batch => batch.status === 'done').length,
  retainedInOrder: input.map(item => item.word).join(' ') === r.batches.flatMap(batch => tokens(batch.text)).join(' '),
  firstInputToPrimaryPlaybackMs: primary[0] && r.input[0] ? primary[0].at - r.input[0].at : null,
  wordCompletionLatencyMs: quantiles(wordCompletion),
  oldestWordInBatchCompletionMs: quantiles(batchCompletion),
  postSpeechDrainMs: r.batches.length && r.input.length ? Math.max(...r.batches.flatMap(batch => batch.updates.filter(update => update.status === 'done').map(update => update.at))) - (r.input[0].at + r.configuration.durationMs) : null,
  primaryPlaybackCommands: primary.length, externalPlaybackAcks: external.length,
  missingExternalCommandIds: r.externalEvents ? missingExternal.map(e => e.loadId) : null,
  externalAckSkewMs: quantiles(primary.flatMap(e => { const other = external.find(other => other.correlationId === (e.correlationId || e.loadId)); return other ? [other.at - e.at] : []; })),
  injectedFailures: r.injections,
  uncaughtExceptions: r.pageErrors,
  animationPixelChangeObserved: r.visualFramesDiffer ?? null,
  // Proposed QA target, NOT a promise about an SLA previously agreed with users.
  proposedRealtimeTarget: { wordCompletionP95Under10Seconds: wordCompletion.length ? quantiles(wordCompletion).p95 <= 10000 : false },
  limitations: ['Scripted final transcripts, no physical microphone or local ASR.', 'Deterministic keyword translation, no GPT or linguistic fidelity validation.', 'Only four real pose files, not the entire dataset.', 'Software-rendered Chromium, not mobile hardware or Safari.', 'Controlled same-origin external window shell; native PiP initialization not certified.', 'Three-minute input does not establish one-hour reliability.', 'Heap readings may be coarsened; they do not certify absence of leaks.'],
};
fs.writeFileSync(path.join(path.dirname(file), 'analysis.json'), JSON.stringify(analysis, null, 2));
console.log(JSON.stringify(analysis, null, 2));
