import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const hash = value => typeof value === 'string' && /^(?:sha256:)?[a-f0-9]{64}$/.test(value) ? value : null;
const oneOf = (value, values) => values.includes(value) ? value : null;
export function summarizeCaptureValidation(report) {
  const checks = Array.isArray(report?.checks) ? report.checks : [];
  const calls = Array.isArray(report?.asr) ? report.asr : [];
  const statuses = {};
  for (const call of calls) {
    if (Number.isInteger(call?.status) && call.status >= 100 && call.status <= 599) {
      statuses[call.status] = (statuses[call.status] || 0) + 1;
    }
  }
  return {
    kind: 'synthetic-microphone-managed-capture-validation',
    result: oneOf(report?.result, ['PASS', 'FAIL', 'RUNNING']),
    browserName: oneOf(report?.browserName, ['edge', 'brave']),
    browserVersion: /^\d+(?:\.\d+){1,3}$/.test(report?.browser || '') ? report.browser : null,
    renderer: oneOf(report?.renderer, ['real', 'omit']),
    platformImage: hash(report?.platformImage), apiImage: hash(report?.apiImage),
    sourceSha256: Object.fromEntries(['app/captureAudio.ts', 'app/LiveRoom.tsx', 'backend/app/audio_input.py',
      'backend/app/main.py', 'backend/app/services.py', 'tests/capture-browser.cjs'].map(key => [key, hash(report?.sourceSha256?.[key])])),
    muteStress: { requested: count(report?.muteStress?.requested), completed: count(report?.muteStress?.completed),
      timerResumed: typeof report?.muteStress?.timerResumed === 'boolean' ? report.muteStress.timerResumed : null },
    checks: { total: checks.length, passed: checks.filter(check => check?.passed === true).length,
      failed: checks.filter(check => check?.passed === false).length, unknown: checks.filter(check => typeof check?.passed !== 'boolean').length },
    asr: { statuses, emptyContainer: calls.filter(call => call?.status === 200 && call.skipped === 'empty_container').length,
      normal200: calls.filter(call => call?.status === 200 && !call.skipped).length },
    pageErrors: count(report?.pageErrors),
    limitations: ['Real browser capture/MediaRecorder and ASR requests; synthetic audio, not physical microphone/voice QA.',
      'Omitted rendering does not certify animation, native PiP, permissions in a user profile or device-specific behavior.',
      'Empty-container acknowledgements are not provider successes; normal200 counts HTTP responses, not recognition accuracy.',
      'Only allowlisted counters/hashes leave the private run; free-form errors, text, IDs, cookies and keys are excluded.'],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 4) throw new Error('Usage: node scripts/summarize-capture-validation.mjs REPORT_FILE OUTPUT_FILE');
  const raw = await readFile(resolve(process.argv[2]), 'utf8');
  if (raw.length > 4 * 1024 * 1024) throw new Error('Capture report exceeds bound');
  const result = summarizeCaptureValidation(JSON.parse(raw)), output = resolve(process.argv[3]);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ output, result: result.result, checks: result.checks }));
}
