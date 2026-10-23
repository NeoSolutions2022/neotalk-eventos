// Static scientific figure from recorded samples, not illustrative/mock data.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { analyzeRealServices } from './analyze-real-services.mjs';
const require = createRequire(import.meta.url);
const sharp = require(process.env.QA_SHARP_MODULE || 'C:/Users/felip/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
if (!process.argv[2]) throw new Error('Usage: node scripts/render-real-services-evidence.mjs REPORT_DIRECTORY');
const directory = resolve(process.argv[2]);
const ledger = JSON.parse(await readFile(join(directory, 'report.json'), 'utf8'));
const latency = JSON.parse(await readFile(join(directory, 'latency.json'), 'utf8'));
const analysis = analyzeRealServices(latency, ledger);
const output = join(directory, 'figures'); await mkdir(output, { recursive: true });
const samples = (ledger.samples || []).filter(sample => Number.isFinite(sample.seconds) && sample.seconds >= 0);
if (!samples.length) throw new Error('No recorded samples');
if (Number.isFinite(ledger.elapsedMs)) samples.push({ seconds: ledger.elapsedMs / 1000,
  submittedTranscripts: ledger.configuration.targetTranscripts, done: analysis.outcomes.complete });
const maxX = Math.max(1, ...samples.map(sample => sample.seconds)) / 60;
const maxY = Math.max(1, ...samples.flatMap(sample => [sample.submittedTranscripts, sample.done]));
const x = value => 110 + value / 60 / maxX * 1320, y = value => 580 - value / maxY * 310;
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const text = (x, y, value, size = 24, fill = '#21324a', extra = '') => `<text x="${x}" y="${y}" font-family="Arial,sans-serif" font-size="${size}" fill="${fill}" ${extra}>${escape(value)}</text>`;
const line = (x1, y1, x2, y2, color = '#dbe3ed', width = 1) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}"/>`;
const curve = (key, color) => `<path d="${samples.map((sample, index) => `${index ? 'L' : 'M'}${x(sample.seconds).toFixed(2)},${y(sample[key]).toFixed(2)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="4"/>`;
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1080" viewBox="0 0 1600 1080" role="img"><title>Entrada e escoamento da sala ao vivo em homologação local</title><rect width="1600" height="1080" fill="#ffffff"/>`;
svg += text(80, 65, 'NeoTalk · Evidência real de integração', 21, '#0078ac');
svg += text(80, 112, `${analysis.observedBatches} lotes · entrada e escoamento da fila`, 38, '#10233f');
svg += text(80, 151, 'GPT, API de poses e Unity reais · ASR injetado · Edge headless · Document PiP', 22, '#52657f');
svg += line(110, 220, 155, 220, '#008fc7', 4) + text(168, 227, 'Trechos de fala injetados', 22);
svg += line(580, 220, 625, 220, '#16815d', 4) + text(638, 227, 'Lotes concluídos', 22);
const ticks = Math.min(4, Math.ceil(maxY));
for (let index = 0; index <= ticks; index++) {
  const value = maxY * index / ticks; svg += line(110, y(value), 1430, y(value));
  svg += text(92, y(value) + 7, Math.round(value), 20, '#52657f', 'text-anchor="end"');
  const minute = maxX * index / ticks; svg += text(x(minute * 60), 619, minute.toFixed(1).replace('.', ','), 20, '#52657f', 'text-anchor="middle"');
}
svg += text(110, 260, 'Quantidade', 20, '#52657f') + text(710, 658, 'Tempo decorrido (min)', 22, '#52657f');
svg += curve('submittedTranscripts', '#008fc7') + curve('done', '#16815d');
const seconds = value => value === null ? 'sem amostra' : `${(value / 1000).toFixed(2).replace('.', ',')} s`;
const rows = [['Pedido de tradução', analysis.metricsMs.translationRequest],
  ['Glosas prontas → despacho', analysis.metricsMs.readyToDispatch],
  ['Despacho → primeiro frame', analysis.metricsMs.dispatchToFirstFrame],
  ['Intervalo entre frases · mini-player', analysis.handoffMs.external]];
svg += text(110, 724, 'Etapa observada', 22, '#52657f') + text(920, 724, 'Mediana', 22, '#52657f') + text(1160, 724, 'p95', 22, '#52657f') + text(1380, 724, 'n', 22, '#52657f');
rows.forEach(([label, metric], index) => {
  const position = 772 + index * 48;
  svg += text(110, position, label, 24) + text(920, position, seconds(metric.p50), 24) + text(1160, position, seconds(metric.p95), 24) + text(1380, position, metric.count, 24);
});
svg += line(80, 955, 1520, 955);
svg += text(80, 992, `Pausas automáticas: ${analysis.pressure.capturePauses ?? '?'} · resets: ${analysis.runtimeResets ?? '?'} · lotes com execução completa: ${analysis.completeBatches}`, 23);
svg += text(80, 1032, 'Não é comparação A/B, teste de voz real ou aprovação de produção. Etapas sobrepostas não devem ser somadas.', 20, '#52657f');
svg += '</svg>';
await writeFile(join(output, 'real-queue.svg'), svg);
await sharp(Buffer.from(svg)).png().toFile(join(output, 'real-queue.png'));
await writeFile(join(output, 'analysis.json'), JSON.stringify(analysis, null, 2) + '\n');
console.log(output);
