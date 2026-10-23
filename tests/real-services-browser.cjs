// Local-only integration test. GPT/pose/Unity are real; transcripts and the
// permission-check audio device are controlled. NO HTTP routes are replaced.
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'C:/Users/felip/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const base = 'http://localhost:3310';
const target = Number(process.env.QA_TRANSCRIPTS || 3);
const wpm = Number(process.env.QA_WPM || 180);
const limitSeconds = Number(process.env.QA_MAX_SECONDS || (target >= 100 ? 2400 : 240));
const mode = process.env.QA_OUTPUT || 'pip';
if (!Number.isInteger(target) || target < 1 || target > 200 || !Number.isFinite(wpm) || wpm < 60 || wpm > 240 || !['primary', 'pip', 'window'].includes(mode) || limitSeconds < 30 || limitSeconds > 3600) throw new Error('Invalid bounded QA configuration');
const output = path.join(root, 'outputs', `real-services-${Date.now()}`);
const phrases = [
  'Nosso amigo pode aprender com você hoje.', 'Quero compreender melhor esta proposta para trabalhar.',
  'Vamos aprender juntos e conversar sobre acessibilidade.', 'Meu amigo quer comprar isso aqui agora.',
  'Precisamos compreender para ajudar nosso amigo hoje.', 'Eu quero aprender Libras e trabalhar hoje.',
  'Você pode acompanhar nosso trabalho aqui hoje.', 'Vamos conversar sobre acessibilidade com vocês hoje.',
  'Quero perguntar e compreender melhor esta proposta.', 'Meu amigo quer estudar Libras comigo hoje.',
];
// Seven or more words prevent two arrivals being combined into one <=12-word
// job by the production queue policy. Never disable that policy for the test.
if (phrases.some(text => text.split(/\s+/).length < 7 || text.split(/\s+/).length > 12)) throw new Error('Workload must naturally produce individually bounded batches');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const normalize = text => text.replace(/\s+/g, ' ').trim();
const report = { schema: 1, startedAt: new Date().toISOString(), configuration: {
  targetTranscripts: target, wpm, output: mode, maxSeconds: limitSeconds,
  services: 'real local candidates + remote GPT/NeoTalk', recognition: 'scripted final pt-BR transcripts; fake audio permission device',
  pip: 'native API when supported; actual window fallback, never a simulated shell',
  browser: 'isolated Edge headless; no background-throttling bypass flags',
}, samples: [], http: {}, checks: [], limitations: [
  'Not physical microphone/ASR validation, production infrastructure approval or linguistic QA',
  'Local mixed cache workload; no before/after performance claim',
], result: 'RUNNING' };
const batches = new Map(), incoming = [], jobs = new Set();
let browser, context, page, roomId, csrf, initialReady, startedAt, lastInputAt;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function check(value, label) { report.checks.push({ label, passed: Boolean(value) }); if (!value) throw new Error(label); }
function countHttp(response) {
  const url = new URL(response.url());
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) return;
  let stage = /\/agent\/translate$/.test(url.pathname) ? 'translate' : /\/mvp\/sign$/.test(url.pathname) ? 'pose_submit'
    : /\/mvp\/tasks\//.test(url.pathname) ? 'pose_poll' : /\/batches/.test(url.pathname) ? 'batch'
    : /\/heartbeat$/.test(url.pathname) ? 'heartbeat' : null;
  if (stage) { const key = `${stage}:${response.status()}`; report.http[key] = (report.http[key] || 0) + 1; }
}
async function checkpoint() {
  if (page && !page.isClosed()) report.observations = await page.evaluate(() => window.__qa?.events || []).catch(() => report.observations || []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
async function exportTelemetry() {
  const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
  await page.getByRole('button', { name: /Baixar relatório de latência/ }).click({ timeout: 10000 });
  await (await downloadPromise).saveAs(path.join(output, 'latency.json'));
  return JSON.parse(await fs.readFile(path.join(output, 'latency.json'), 'utf8'));
}
(async () => {
  await fs.mkdir(output, { recursive: true });
  try {
    report.platformCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    report.widgetCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.resolve(root, '../release-avatar'), encoding: 'utf8' }).trim();
    report.runtimeImages = {};
    for (const service of ['platform', 'api', 'avatar']) report.runtimeImages[service] = execFileSync('docker',
      ['inspect', '--format', '{{.Image}}', `neotalk-homolog-observability-${service}-1`], { encoding: 'utf8', timeout: 10000 }).trim();
    report.limitations.push('Checkout commits are metadata; runtime Docker image IDs identify the actual prebuilt services');
    report.harnessSha256 = hash(await fs.readFile(__filename));
    const envText = await fs.readFile(path.join(root, '.env.homolog.local'), 'utf8');
    const password = envText.match(/^HOMOLOG_ADMIN_PASSWORD=(.+)$/m)?.[1].trim();
    if (!password) throw new Error('Missing local admin password');
    browser = await chromium.launch({ channel: 'msedge', headless: process.env.QA_HEADED !== '1',
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--enable-unsafe-swiftshader'] });
    report.browserVersion = browser.version();
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const login = await context.request.post(`${base}/api/v1/auth/login`, {
      headers: { Origin: base }, data: { email: 'qa@homolog.invalid', password },
    });
    check(login.ok(), 'Local admin authentication');
    csrf = (await login.json()).csrf_token;
    // Only local onboarding state; no user accounts or production data changed.
    const onboarding = await context.request.patch(`${base}/api/v1/auth/onboarding`, {
      headers: { Origin: base, 'X-CSRF-Token': csrf }, data: { step: 5, status: 'completed' },
    });
    check(onboarding.ok(), 'Local QA onboarding completed');
    const integrations = await context.request.get(`${base}/api/v1/admin/integrations`);
    const info = await integrations.json(); report.catalogWordCount = info.dataset_words;
    check(info.openai_configured && info.neotalk_configured && info.dataset_words > 0, 'Real integrations and catalog configured');
    const manifest = await context.request.get('http://localhost:38080/webgl/elia/manifest.json');
    report.webglManifest = await manifest.json();
    context.on('response', response => {
      countHttp(response);
      const job = (async () => {
        const url = new URL(response.url()), request = response.request();
        if (url.origin !== base || !response.ok()) return;
        if (url.pathname === '/api/v1/rooms' && request.method() === 'POST') { roomId = (await response.json()).id; return; }
        if (!/\/batches(?:\/[^/]+)?$/.test(url.pathname) || !['POST', 'PATCH'].includes(request.method())) return;
        const value = await response.json();
        if (value.id) batches.set(value.id, { ...batches.get(value.id), ...value });
      })().catch(() => { report.observerFailures = (report.observerFailures || 0) + 1; });
      jobs.add(job); job.finally(() => jobs.delete(job));
    });
    await context.addInitScript(() => {
      window.__qa = { events: [] };
      class ScriptedSpeech { start() { window.__qaRecognition = this; } stop() {} abort() {} }
      window.SpeechRecognition = window.webkitSpeechRecognition = ScriptedSpeech;
      window.__qaAttach = (targetWindow, output) => {
        targetWindow.addEventListener('message', event => {
          if (event.origin !== 'http://localhost:38080' || event.source !== targetWindow.document.querySelector('iframe.avatar-widget-frame')?.contentWindow) return;
          const data = event.data;
          if (!data || !['neotalk:ready', 'neotalk:playing', 'neotalk:playback-frame', 'neotalk:error', 'neotalk:status'].includes(data.type)) return;
          const entry = { at: Date.now(), output, type: data.type };
          for (const field of ['status', 'code', 'frame', 'frameCount', 'loadId', 'correlationId', 'version']) {
            if (typeof data[field] === 'string' || Number.isFinite(data[field])) entry[field] = data[field];
          }
          if (data.type === 'neotalk:ready') entry.native = data.capabilities?.includes('native-playback-progress') === true;
          window.__qa.events.push(entry);
          if (window.__qa.events.length > 20000) { window.__qa.events.shift(); window.__qa.evicted = true; }
        });
      };
      window.__qaAttach(window, 'primary');
      const pip = window.documentPictureInPicture;
      if (pip?.requestWindow) {
        const request = pip.requestWindow.bind(pip);
        pip.requestWindow = async options => {
          const result = await request(options); window.__qaExternal = result; window.__qaNativePiP = true; return result;
        };
      }
      const open = window.open.bind(window);
      window.open = (...args) => {
        const result = open(...args);
        if (args[1] === 'neotalk-live-output') window.__qaExternal = result;
        return result;
      };
    });
    page = await context.newPage();
    report.pageErrors = 0;
    page.on('pageerror', () => report.pageErrors++);
    await page.goto(`${base}/salas/ao-vivo`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__qa?.events.some(event => event.type === 'neotalk:ready' && event.output === 'primary'), null, { timeout: 120000 });
    if (mode !== 'primary') {
      await page.getByRole('button', { name: mode === 'pip' ? /Mini-player flutuante/ : /Abrir em outra janela/ }).click();
      await page.waitForFunction(() => window.__qaExternal?.document.querySelector('iframe.avatar-widget-frame')?.src.startsWith('http://localhost:38080/'), null, { timeout: 30000 });
      await page.evaluate(() => window.__qaAttach(window.__qaExternal, 'external'));
      await page.waitForFunction(() => window.__qa.events.some(event => event.type === 'neotalk:ready' && event.output === 'external'), null, { timeout: 120000 });
      report.configuration.actualOutput = await page.evaluate(() => window.__qaNativePiP ? 'native-document-pip' : 'real-popup-window');
    } else await page.getByRole('button', { name: 'Iniciar sala ao vivo', exact: true }).click();
    await page.waitForFunction(() => !!window.__qaRecognition, null, { timeout: 30000 });
    check(await page.evaluate(() => window.__qaRecognition.lang === 'pt-BR'), 'Portuguese recognition configuration');
    initialReady = await page.evaluate(() => window.__qa.events.filter(event => event.type === 'neotalk:ready'));
    check(initialReady.every(event => event.native), 'Both active outputs advertise native playback progress');
    startedAt = Date.now(); let nextInputAt = startedAt, nextSampleAt = startedAt;
    for (;;) {
      const now = Date.now();
      if (now - startedAt > limitSeconds * 1000) throw new Error('Bounded observation window elapsed; not a proof of renderer crash');
      if (incoming.length < target && now >= nextInputAt) {
        const text = phrases[incoming.length % phrases.length];
        await page.evaluate(value => window.__qaRecognition.onresult({ resultIndex: 0, results: { length: 1, 0: { isFinal: true, 0: { transcript: value } } } }), text);
        incoming.push(text); lastInputAt = now;
        nextInputAt = now + text.split(/\s+/).length * 60000 / wpm;
      }
      if (now >= nextSampleAt) {
        await Promise.all([...jobs]);
        const sample = await page.evaluate(() => ({
          microphoneActive: !!document.querySelector('.audio-source.listening'),
          nativeFirst: window.__qa.events.filter(event => event.type === 'neotalk:playback-frame' && event.status === 'started').length,
          nativeLast: window.__qa.events.filter(event => event.type === 'neotalk:playback-frame' && event.status === 'finished' && event.frame === event.frameCount - 1).length,
          readyEvents: window.__qa.events.filter(event => event.type === 'neotalk:ready').length,
        }));
        report.samples.push({ seconds: Math.round((now - startedAt) / 1000), submittedTranscripts: incoming.length,
          persistedBatches: batches.size, done: [...batches.values()].filter(batch => batch.status === 'done').length, ...sample });
        console.log('SAMPLE', JSON.stringify(report.samples.at(-1)));
        await checkpoint(); nextSampleAt = now + 10000;
        if (!sample.microphoneActive) throw new Error('Capture became inactive during admitted work');
      }
      if ([...batches.values()].some(batch => batch.status === 'error')) throw new Error('An admitted batch failed');
      const persisted = [...batches.values()].sort((a, b) => a.sequence - b.sequence);
      if (incoming.length === target && now - lastInputAt > 1000 && persisted.length &&
        normalize(persisted.map(batch => batch.text).join(' ')) === normalize(incoming.join(' ')) && persisted.every(batch => batch.status === 'done')) break;
      await sleep(150);
    }
    report.elapsedMs = Date.now() - startedAt;
    report.sourceWords = incoming.join(' ').split(/\s+/).length;
    report.persistedBatchCount = batches.size;
    report.workloadSha256 = hash(incoming.join('\n'));
    const exported = await exportTelemetry();
    const telemetry = exported.telemetry; report.metrics = telemetry.metrics; report.outcomes = telemetry.outcomes;
    report.pressure = telemetry.pressure; report.runtimeResets = telemetry.runtimeResets;
    check(exported.mode === 'translation', 'Translation mode, not presentation');
    check(telemetry.missing.firstFrame === 0 && telemetry.missing.lastFrame === 0, 'All admitted batches have actual first and last frames');
    check(telemetry.missing.serverTimings === 0 && telemetry.missing.poseTimings === 0, 'Real backend and pose timings are present');
    check(telemetry.runtimeResets === 0 && telemetry.pressure.capturePauses === 0, 'No automatic capture pauses or runtime resets');
    check(telemetry.pressure.rejectedSourceWords === 0 && telemetry.pressure.rejectedAudioChunks === 0, 'No rejected input');
    check(telemetry.outcomes.error === 0 && telemetry.outcomes.pending === 0 && telemetry.outcomes.skipped === 0, 'No hidden skipped, failed or pending batches');
    check(batches.size >= target, 'At least the requested number of real batches persisted');
    const events = await page.evaluate(() => window.__qa.events);
    check(events.filter(event => event.type === 'neotalk:ready').length === initialReady.length, 'Native runtimes never reinitialized');
    const executions = telemetry.batches.flatMap(batch => batch.executions || []);
    check(executions.filter(execution => execution.output === 'primary' && Number.isFinite(execution.first) && Number.isFinite(execution.last)).length >= target, 'Primary terminal frames for every batch');
    if (mode !== 'primary') check(executions.filter(execution => execution.output === 'external' && Number.isFinite(execution.first) && Number.isFinite(execution.last)).length >= target, 'External terminal frames for every batch');
    check(report.pageErrors === 0, 'No uncaught main-page exceptions');
    await page.screenshot({ path: path.join(output, 'platform.png') });
    report.result = 'PASS';
  } catch (error) {
    report.result = 'FAIL'; report.failure = error.message.replace(/https?:\/\/\S+/g, '[url]'); process.exitCode = 1;
  } finally {
    if (page && !page.isClosed()) {
      if (report.result !== 'PASS') await exportTelemetry().catch(() => {});
      await page.screenshot({ path: path.join(output, 'final-state.png') }).catch(() => {});
      await checkpoint().catch(() => {});
    }
    // End only the room created by this isolated run, not every QA/local room.
    if (roomId && context && csrf) {
      const finish = await context.request.post(`${base}/api/v1/rooms/${encodeURIComponent(roomId)}/finish`, {
        headers: { Origin: base, 'X-CSRF-Token': csrf }, data: { duration_seconds: startedAt ? Math.ceil((Date.now() - startedAt) / 1000) : 0 },
      }).catch(() => null);
      report.roomFinished = finish?.ok() === true;
    }
    await checkpoint().catch(() => {});
    await browser?.close();
    console.log('RESULT', report.result, report.failure || '', 'EVIDENCE', output);
  }
})().catch(() => { console.error('Harness setup failed; details suppressed to protect configuration'); process.exitCode = 1; });
