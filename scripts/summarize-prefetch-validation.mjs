import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { analyzeRealServices } from './analyze-real-services.mjs';

// Only explicitly selected aggregate/provenance fields leave the private run.
export function summarizePrefetchValidation(latency, ledger, minimum = 5) {
  const sha = value => typeof value === 'string' && /^(?:sha256:)?[a-f0-9]{40,64}$/.test(value) ? value : null;
  return {
    type: 'real-service-integration-smoke-not-speedup-approval',
    workload: ['repeated-phrase-cache-check', 'ten-phrase-pitch-cycle'].includes(ledger.configuration?.workload)
      ? ledger.configuration.workload : null,
    elapsedMs: Number.isFinite(ledger.elapsedMs) && ledger.elapsedMs >= 0 ? ledger.elapsedMs : null,
    browserVersion: /^\d+(?:\.\d+){1,3}$/.test(ledger.browserVersion || '') ? ledger.browserVersion : null,
    runtimeImages: Object.fromEntries(['platform', 'api', 'avatar'].map(key => [key, sha(ledger.runtimeImages?.[key])])),
    harnessSha256: sha(ledger.harnessSha256),
    http: Object.fromEntries(Object.entries(ledger.http || {}).filter(([key, value]) =>
      /^(translate|pose_submit|pose_poll|heartbeat|batch):[1-5]\d\d$/.test(key) && Number.isSafeInteger(value) && value >= 0)),
    analysis: analyzeRealServices(latency, ledger, minimum),
    limitations: ['Controlled ASR, not a physical microphone test.',
      'Small integration run; workload, GPT, cache, polling and clip lengths can vary. Not a controlled speedup A/B.',
      'No transcript, user ID, session ID, raw event, cookie or credential is exported.'],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (![4, 5].includes(process.argv.length)) throw new Error('Usage: node scripts/summarize-prefetch-validation.mjs REPORT_DIRECTORY OUTPUT_FILE [MINIMUM=5]');
  const directory = resolve(process.argv[2]), destination = resolve(process.argv[3]);
  const read = async name => {
    const raw = await readFile(join(directory, name), 'utf8');
    if (raw.length > 16 * 1024 * 1024) throw new Error('Run exceeds evidence bound');
    return JSON.parse(raw);
  };
  const result = summarizePrefetchValidation(await read('latency.json'), await read('report.json'), Number(process.argv[4] || 5));
  await mkdir(resolve(destination, '..'), { recursive: true });
  await writeFile(destination, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ output: destination, executionComplete: result.analysis.executionSampleGate,
    consistent: result.analysis.consistentSampleGate }));
}
