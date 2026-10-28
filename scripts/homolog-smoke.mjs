// Explicit one-phrase REAL-service smoke test; not a 100-batch latency benchmark.
// Run only against compose.homolog.yaml. Never accepts a production target.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const api = 'http://localhost:38100/api/v1';
const avatar = 'http://localhost:38080';
const local = Object.fromEntries((await readFile(new URL('.env.homolog.local', root), 'utf8'))
  .split(/\r?\n/).filter(line => /^[A-Z_]+=/.test(line))
  .map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
if (!local.HOMOLOG_ADMIN_PASSWORD) throw new Error('Local admin password missing');
let cookie = '', csrf = '';
const report = { capturedAt: new Date().toISOString(), kind: 'real-services-single-phrase-smoke', steps: [],
  limitations: ['No browser, ASR, Unity frames or mini-player tested', 'Not a performance baseline or production approval'] };
async function request(name, url, body, authenticated = false) {
  const started = performance.now();
  try {
    const response = await fetch(url, { method: body === undefined ? 'GET' : 'POST',
      signal: AbortSignal.timeout(65000), headers: { Origin: 'http://localhost:3310',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(authenticated ? { Cookie: cookie, 'X-CSRF-Token': csrf } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await response.json().catch(() => null);
    report.steps.push({ name, status: response.status, elapsedMs: Math.round(performance.now() - started) });
    // Do not log response text, request bodies, upstream errors, keys or cookies.
    if (!response.ok || !data) throw new Error('HTTP_OR_FORMAT');
    return { data, response };
  } catch {
    if (report.steps.at(-1)?.name !== name) report.steps.push({ name, status: null, error: 'transport_or_timeout' });
    throw new Error('SMOKE_STEP_FAILED');
  }
}
let successful = false;
try {
  await request('api_health', `${api}/health`);
  const widget = await request('avatar_health', `${avatar}/api/v1/health`);
  if (!widget.data.webgl_ready) throw new Error('WEBGL_NOT_READY');
  const login = await request('local_admin_login', `${api}/auth/login`, {
    email: 'qa@homolog.invalid', password: local.HOMOLOG_ADMIN_PASSWORD,
  });
  cookie = login.response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  csrf = login.data.csrf_token;
  const sync = await request('real_catalog_sync', `${api}/admin/dataset/sync`, {}, true);
  report.catalogWordCount = Number.isInteger(sync.data.word_count) ? sync.data.word_count : null;
  if (!(report.catalogWordCount > 0)) throw new Error('EMPTY_CATALOG');
  const translation = await request('real_gpt_translation', `${api}/agent/translate`, {
    text: 'Eu quero aprender Libras.', trace_id: 'homolog_smoke',
  }, true);
  report.translationSkipped = Boolean(translation.data.skipped);
  report.glossCount = Array.isArray(translation.data.glosses) ? translation.data.glosses.length : null;
  const phrase = translation.data.gloss_text;
  if (report.translationSkipped || typeof phrase !== 'string' || !phrase.trim() || phrase.length > 500) throw new Error('NO_VALID_GLOSSES');
  const submitted = await request('real_pose_submit', `${avatar}/api/v1/mvp/sign`, { phrase });
  const id = submitted.data.task_id;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(id)) throw new Error('INVALID_TASK');
  const deadline = performance.now() + 120000;
  while (performance.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const status = await request('real_pose_poll', `${avatar}/api/v1/mvp/tasks/${encodeURIComponent(id)}`);
    if (status.data.status !== 'ready') continue;
    report.poseFrameCount = Number.isInteger(status.data.pose?.frame_count) ? status.data.pose.frame_count : null;
    report.poseReady = true;
    successful = true;
    break;
  }
} catch {
  report.failure = 'Smoke test did not complete; inspect the last stage and HTTP status locally';
} finally {
  report.successful = successful;
  const directory = new URL('outputs/homolog-local/', root);
  await mkdir(directory, { recursive: true });
  await writeFile(new URL('smoke.json', directory), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  console.log(`Sanitized report: ${fileURLToPath(new URL('smoke.json', directory))}`);
  if (!successful) process.exitCode = 1;
}
