// Real getUserMedia + MediaRecorder with browser fake audio device, real local
// app/backend and ASR endpoint. No hardware/room IDs, audio or text in report.
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'C:/Users/felip/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'), base = 'http://localhost:3310';
const output = path.join(root, 'outputs', 'capture-managed-' + Date.now());
let browser, room, context, csrf;
const report = { kind: 'managed-capture-browser', result: 'RUNNING',
  limitations: ['Fake browser microphone, not physical device/noise/isolation/clipping/WER QA.',
    'Real MediaRecorder and backend requests; no simulated HTTP responses or transcript injection.'],
  checks: [], asr: [], pageErrors: 0 };
function check(value, name) { report.checks.push({ name, passed: !!value }); assert.ok(value, name); }
(async () => {
  await fs.mkdir(output, { recursive: true });
  try {
    report.platformImage = execFileSync('docker', ['inspect', '--format', '{{.Image}}', 'neotalk-homolog-observability-platform-1'], { encoding: 'utf8', timeout: 10000 }).trim();
    report.sourceSha256 = {};
    for (const file of ['app/captureAudio.ts', 'app/LiveRoom.tsx', 'tests/capture-browser.cjs']) {
      report.sourceSha256[file] = crypto.createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex');
    }
    const configuration = await fs.readFile(path.join(root, '.env.homolog.local'), 'utf8');
    const password = configuration.match(/^HOMOLOG_ADMIN_PASSWORD=(.+)$/m)?.[1].trim();
    assert.ok(password);
    browser = await chromium.launch({ channel: 'msedge', headless: true,
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--enable-unsafe-swiftshader'] });
    report.browser = browser.version();
    context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const login = await context.request.post(base + '/api/v1/auth/login', { headers: { Origin: base }, data: { email: 'qa@homolog.invalid', password } });
    assert.ok(login.ok()); csrf = (await login.json()).csrf_token;
    await context.request.patch(base + '/api/v1/auth/onboarding', { headers: { Origin: base, 'X-CSRF-Token': csrf }, data: { step: 5, status: 'completed' } });
    await context.addInitScript(() => {
      window.__captureQA = { acquired: 0, recorderCount: 0, sameStream: true, speechStarts: 0, requestedLecture: false, asrBytes: [], exactDevice: false };
      const realFetch = window.fetch.bind(window);
      window.fetch = (input, options) => {
        if (String(input).endsWith('/agent/transcribe') && options?.body instanceof Blob) window.__captureQA.asrBytes.push(options.body.size);
        return realFetch(input, options);
      };
      const media = navigator.mediaDevices, acquire = media.getUserMedia.bind(media);
      media.getUserMedia = async constraints => {
        const stream = await acquire(constraints);
        window.__captureQA.acquired++;
        window.__captureQA.stream = stream;
        window.__captureQA.requestedLecture = constraints.audio?.noiseSuppression?.ideal === true;
        window.__captureQA.exactDevice = Boolean(constraints.audio?.deviceId?.exact) && stream.getAudioTracks()[0]?.getSettings().deviceId === constraints.audio.deviceId.exact;
        return stream;
      };
      const Recorder = window.MediaRecorder;
      window.MediaRecorder = class extends Recorder {
        constructor(stream, options) {
          super(stream, options);
          window.__captureQA.recorderCount++;
          window.__captureQA.sameStream &&= stream === window.__captureQA.stream;
        }
      };
      // Trap WebSpeech use; this engine must not take ownership of capture.
      window.SpeechRecognition = window.webkitSpeechRecognition = class {
        start() { window.__captureQA.speechStarts++; }
        stop() {} abort() {}
      };
    });
    const page = await context.newPage();
    page.on('pageerror', () => report.pageErrors++);
    context.on('response', async response => {
      const request = response.request(), url = new URL(response.url());
      if (url.origin !== base) return;
      if (url.pathname === '/api/v1/rooms' && request.method() === 'POST' && response.ok()) room = (await response.json()).id;
      if (url.pathname === '/api/v1/agent/transcribe') report.asr.push({ status: response.status() });
    });
    await page.goto(base + '/salas/ao-vivo');
    await page.getByRole('combobox', { name: 'Perfil de áudio', exact: true }).selectOption('lecture');
    await page.getByRole('button', { name: 'Atualizar microfones', exact: true }).click();
    check(await page.evaluate(() => window.__captureQA.acquired === 0), 'Listing devices does not open microphone');
    await page.getByRole('button', { name: 'Iniciar sala ao vivo', exact: true }).click();
    await page.getByRole('button', { name: 'Mutar microfone', exact: true }).waitFor({ timeout: 30000 });
    await page.waitForFunction(() => window.__captureQA.recorderCount >= 2, null, { timeout: 20000 });
    const first = await page.evaluate(() => ({ ...window.__captureQA, stream: undefined }));
    check(first.acquired === 1 && first.sameStream && first.recorderCount >= 2, 'One acquired stream is actually recorded across chunks');
    check(first.speechStarts === 0 && first.requestedLecture, 'Managed lecture profile bypasses WebSpeech');
    check(await page.getByRole('combobox', { name: 'Microfone da sala' }).isDisabled(), 'Hardware selection is locked during live capture');
    await page.getByRole('button', { name: 'Mutar microfone', exact: true }).click();
    check(await page.evaluate(() => window.__captureQA.stream.getAudioTracks().every(track => !track.enabled)), 'Mute disables the actual recorded tracks');
    const before = await page.evaluate(() => window.__captureQA.recorderCount);
    await page.getByRole('button', { name: 'Ativar microfone', exact: true }).click();
    await page.waitForFunction(count => window.__captureQA.recorderCount > count, before);
    check(await page.evaluate(() => window.__captureQA.acquired === 1 && window.__captureQA.sameStream && window.__captureQA.stream.getAudioTracks().every(track => track.enabled)), 'Unmute resumes the same selected stream without reacquisition');
    // The real ASR response can arrive well after the recorder's next chunk.
    // Do not end/abort the room before observing the endpoint response.
    if (!report.asr.some(call => call.status === 200)) {
      await page.waitForResponse(response => response.url() === base + '/api/v1/agent/transcribe' && response.status() === 200, { timeout: 45000 });
    }
    report.asrPayloadBytes = await page.evaluate(() => window.__captureQA.asrBytes);
    await page.getByRole('button', { name: 'Encerrar sala', exact: true }).click();
    await page.getByRole('button', { name: 'Iniciar sala ao vivo', exact: true }).waitFor();
    check(await page.evaluate(() => window.__captureQA.stream.getTracks().every(track => track.readyState === 'ended')), 'Ending room releases real browser tracks');
    check(report.asrPayloadBytes.some(bytes => bytes > 0) && report.asr.some(call => call.status === 200), 'Nonempty real recorder payload reaches real ASR endpoint');
    await page.getByRole('button', { name: 'Atualizar microfones', exact: true }).click();
    const selected = await page.getByRole('combobox', { name: 'Microfone da sala', exact: true }).locator('option').evaluateAll(options => options.map(option => option.value).find(value => value && value !== 'communications'));
    check(Boolean(selected), 'Browser enumerates a concrete synthetic microphone after permission');
    await page.getByRole('combobox', { name: 'Microfone da sala', exact: true }).selectOption(selected);
    await page.getByRole('combobox', { name: 'Perfil de áudio', exact: true }).selectOption('direct');
    await page.getByRole('button', { name: 'Iniciar sala ao vivo', exact: true }).click();
    await page.getByRole('button', { name: 'Mutar microfone', exact: true }).waitFor();
    check(await page.evaluate(() => window.__captureQA.exactDevice && window.__captureQA.speechStarts === 0 && window.__captureQA.sameStream), 'Exact selected device is the track recorded in the second session');
    await page.getByRole('button', { name: 'Encerrar sala', exact: true }).click();
    await page.getByRole('button', { name: 'Iniciar sala ao vivo', exact: true }).waitFor();
    check(await page.evaluate(() => window.__captureQA.stream.getTracks().every(track => track.readyState === 'ended')), 'Second session releases the selected hardware too');
    check(report.pageErrors === 0, 'No uncaught main-page exception');
    await page.getByRole('combobox', { name: 'Microfone da sala' }).evaluate(element => element.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: path.join(output, 'audio-settings.png') });
    report.result = 'PASS';
  } catch (error) { report.result = 'FAIL'; report.failure = report.checks.find(check => !check.passed)?.name || 'Browser integration incomplete (details suppressed)'; process.exitCode = 1; }
  finally {
    if (room && context && csrf) await context.request.post(`${base}/api/v1/rooms/${encodeURIComponent(room)}/finish`, { headers: { Origin: base, 'X-CSRF-Token': csrf }, data: { duration_seconds: 30 } }).catch(() => {});
    await browser?.close();
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ result: report.result, checks: report.checks, asr: report.asr, output }));
  }
})();
