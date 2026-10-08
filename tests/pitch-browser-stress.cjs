// Real-time integration/soak test: actual React + widget JS + Unity WebGL.
// Recognition and HTTP services are controlled doubles, NOT production QA.
const { chromium } = require('C:/Users/felip/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const workspace = process.env.PITCH_WORKSPACE_ROOT || path.resolve(__dirname, '../..');
const platformRoot = process.env.PITCH_PLATFORM_ROOT || path.join(workspace, 'neotalk-eventos');
const widgetRoot = process.env.PITCH_WIDGET_REPO || path.join(workspace, 'Avatar3DFrontend');
const frontend = path.join(widgetRoot, 'frontend');
const nativeRoot = process.env.ELIA_NATIVE_BUILD;
const base = 'http://localhost:3110';
const widgetHost = 'https://infra-avatar3d-oficial.k3p3ex.easypanel.host';
const durationMs = Number(process.env.PITCH_DURATION_SECONDS || 180) * 1000;
const wordsPerMinute = Number(process.env.PITCH_WPM || 180);
const failureEvery = Number(process.env.PITCH_FAIL_EVERY || 11);
// Stability and latency are distinct gates: do not mark a healthy delayed
// execution failed merely for exceeding the previous four-minute target.
const drainLimitMs = Number(process.env.PITCH_DRAIN_LIMIT_SECONDS || 900) * 1000;
process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = '1';
const output = path.join(workspace, 'outputs', `pitch-soak-${Date.now()}`);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.pose': 'text/plain' };
const normalize = text => text.replace(/\s+/g, ' ').trim();
const phrases = process.env.PITCH_TEXTS_FILE ? require(path.resolve(process.env.PITCH_TEXTS_FILE)) : [
  'Nosso amigo pode aprender com você.',
  'Quero aprender antes de comprar agora.',
  'O amigo consegue compreender nossa proposta.',
  'Podemos comprar para aprender ainda mais.',
  'Vamos compreender para ajudar nosso amigo.',
  'Precisamos aprender para compreender esta solução.',
];
const summarize = values => {
  const sorted = values.slice().sort((a, b) => a - b);
  const percentile = p => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? null;
  return { count: values.length, p50: percentile(.5), p95: percentile(.95), max: sorted.at(-1) ?? null };
};
(async () => {
  await fs.mkdir(output, { recursive: true });
  const { concatenatePoses } = await import(pathToFileURL(path.join(platformRoot, 'mobile-offline/src/engine.mjs')));
  const poses = new Map();
  for (const word of ['amigo', 'aprender', 'comprar', 'compreender']) poses.set(word.toUpperCase(), await fs.readFile(path.join(nativeRoot || path.join(widgetRoot,'webgl/elia'), 'StreamingAssets', `${word}.pose`), 'utf8'));
  const ledger = { configuration: { durationMs, wordsPerMinute, failureEvery, harnessSha256: crypto.createHash('sha256').update(await fs.readFile(__filename)).digest('hex'), realTime: true, fps: 30, translation: 'deterministic keyword double', recognition: 'scripted final transcripts', runtime: 'real Unity WebGL/SwiftShader', external: 'controlled same-origin popup shell, native PiP initialization NOT tested' }, input: [], batches: [], translations: [], injections: [], samples: [], events: [], pageErrors: [], consoleErrors: [], assertions: [], result: 'RUNNING' };
  const batchMap = new Map(), tasks = new Map(), combined = new Map(), translationAttempts = new Map(), signAttempts = new Map(), failedPoseCounters = new Set();
  let translationCounter = 0, taskCounter = 0, heartbeatCounter = 0, translateConcurrent = 0, maxTranslateConcurrent = 0, browser, page, popup, trackingStart = 0;
  const check = (condition, message) => { assert.ok(condition, message); ledger.assertions.push(message); console.log('PASS', message); };
  const checkpoint = async () => {
    if (page && !page.isClosed()) ledger.events = await page.evaluate(() => window.pitchEvents || []);
    if (popup && !popup.isClosed()) ledger.externalEvents = await popup.evaluate(() => window.pitchEvents || []);
    await fs.writeFile(path.join(output, 'ledger.json'), JSON.stringify(ledger, null, 2));
  };
  try {
    browser = await chromium.launch({ channel: process.env.PITCH_BROWSER_CHANNEL || 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    context.on('requestfailed', request => console.log('REQUEST_FAILED', request.url(), request.failure()));
    context.on('response', response => { if (response.url().includes('external-player-relay')) console.log('RELAY', response.status()); });
    context.on('page', target => {
      target.on('pageerror', error => ledger.pageErrors.push({ message: error.message, at: Date.now() }));
      target.on('console', message => { if (message.type() === 'error') { ledger.consoleErrors.push({ text: message.text(), at: Date.now() }); console.log('BROWSER_ERROR', message.text().slice(0, 400)); } });
    });
    await context.addInitScript(() => {
      class Speech { start() { window.pitchRecognition = this; } stop() {} abort() {} }
      window.SpeechRecognition = window.webkitSpeechRecognition = Speech;
      window.pitchEvents = [];
      // Controlled same-origin shell avoids Playwright's unrouteable initial
      // about:blank requests. This does not certify native PiP initialization.
      Object.defineProperty(window, 'documentPictureInPicture', { configurable: true, value: { requestWindow: async () => {
        const popup = window.open('/__qa-window', '_blank', 'width=560,height=420');
        return new Promise(resolve => popup.addEventListener('load', () => resolve(popup), { once: true }));
      } } });
      window.addEventListener('message', event => {
        if (event.data?.type?.startsWith('neotalk:') && event.source === document.querySelector('iframe.avatar-widget-frame, iframe')?.contentWindow)
          window.pitchEvents.push({ ...event.data, at: Date.now() });
      });
    });
    await context.route('**/__qa-window', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head></head><body></body></html>' }));
    await context.route('**/external-player-relay.js*', async route => route.fulfill({ contentType: 'text/javascript', body: await fs.readFile(path.join(platformRoot, 'public/external-player-relay.js')) }));
    await context.route(widgetHost + '/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/v1/widget/config') return route.fulfill({ json: { allowed_origins: [base] } });
      if (url.pathname === '/api/v1/mvp/sign') {
        const phrase = route.request().postDataJSON().phrase;
        const attempts = (signAttempts.get(phrase) || 0) + 1; signAttempts.set(phrase, attempts);
        if (taskCounter > 0 && taskCounter % failureEvery === 0 && !failedPoseCounters.has(taskCounter)) {
          failedPoseCounters.add(taskCounter);
          ledger.injections.push({ stage: 'submit-pose', status: 502, at: Date.now() });
          return route.fulfill({ status: 502, json: { detail: 'Controlled transient pose submit failure' } });
        }
        const id = String(++taskCounter); tasks.set(id, { phrase, polls: 0 });
        await sleep(120 + taskCounter % 4 * 70);
        return route.fulfill({ json: { task_id: id } });
      }
      if (url.pathname.startsWith('/api/v1/mvp/tasks/')) {
        const task = tasks.get(url.pathname.split('/').pop());
        if (!task) return route.fulfill({ status: 404 });
        if (++task.polls === 1) return route.fulfill({ status: 202, json: { status: 'processing' } });
        const words = task.phrase.split(/\s+/).filter(word => poses.has(word));
        const sequence = concatenatePoses(words.map(word => poses.get(word)));
        const key = crypto.createHash('sha256').update(task.phrase).digest('hex'); combined.set(key, sequence.content);
        return route.fulfill({ json: { pose: { content_url: `${widgetHost}/qa/poses/${key}.pose`, fps: 30, frame_count: sequence.frame_count }, palavras_encontradas: words } });
      }
      if (url.pathname.startsWith('/qa/poses/')) return route.fulfill({ contentType: 'text/plain', body: combined.get(path.basename(url.pathname, '.pose')) || '' });
      const file = url.pathname === '/widget' ? path.join(frontend, 'widget.html')
        : url.pathname.startsWith('/static/') ? path.join(frontend, url.pathname.slice(8))
          : nativeRoot && url.pathname.startsWith('/webgl/elia/') ? path.join(nativeRoot, url.pathname.slice('/webgl/elia/'.length))
          : path.join(widgetRoot, url.pathname.slice(1));
      try { await route.fulfill({ body: await fs.readFile(file), contentType: mime[path.extname(file)] || 'application/octet-stream' }); }
      catch { await route.fulfill({ status: 404, body: 'Missing test asset' }); }
    });
    await context.route('**/api/v1/**', async route => {
      if (route.request().url().startsWith(widgetHost)) return route.fallback();
      const url = new URL(route.request().url()), p = url.pathname, method = route.request().method();
      const data = route.request().postData() ? route.request().postDataJSON() : {};
      if (p.endsWith('/auth/me')) return route.fulfill({ json: { id: 'pitch-qa', name: 'QA Pitch', role: 'user', csrf_token: 'qa', onboarding_version: 1, password_set: true } });
      if (p.endsWith('/agent/translate')) {
        const number = ++translationCounter, started = Date.now();
        const attempt = (translationAttempts.get(data.text) || 0) + 1; translationAttempts.set(data.text, attempt);
        translateConcurrent++; maxTranslateConcurrent = Math.max(maxTranslateConcurrent, translateConcurrent);
        try {
          await sleep(number % 9 === 0 ? 1800 : 180 + number % 5 * 110);
          if (number % failureEvery === 0) {
            const status = number % (failureEvery * 2) === 0 ? 429 : 502;
            ledger.injections.push({ stage: 'translate', status, at: Date.now() });
            ledger.translations.push({ text: data.text, started, ended: Date.now(), attempt, status });
            return route.fulfill({ status, json: { detail: 'Controlled translation failure' } });
          }
          const gloss = [...data.text.toUpperCase().matchAll(/\b(AMIGO|APRENDER|COMPRAR|COMPREENDER)\b/g)].map(match => match[1]).join(' ');
          ledger.translations.push({ text: data.text, gloss, started, ended: Date.now(), attempt, status: 200 });
          return route.fulfill({ json: { gloss_text: gloss, model: 'QA-keyword-double' } });
        } finally { translateConcurrent--; }
      }
      if (p.endsWith('/batches') && method === 'POST') {
        const batch = { id: `pitch-batch-${batchMap.size + 1}`, text: data.text, at: Date.now(), status: 'queued', updates: [] };
        batchMap.set(batch.id, batch); ledger.batches.push(batch); return route.fulfill({ json: batch });
      }
      if (p.includes('/batches/') && method === 'PATCH') {
        const batch = batchMap.get(p.split('/').pop());
        if (batch) { batch.updates.push({ ...data, at: Date.now() }); Object.assign(batch, data); }
        return route.fulfill({ json: batch || { id: p.split('/').pop(), ...data } });
      }
      if (p.endsWith('/heartbeat')) {
        if (++heartbeatCounter === 2) { ledger.injections.push({ stage: 'heartbeat', status: 503, at: Date.now() }); return route.fulfill({ status: 503, json: { detail: 'Controlled heartbeat failure' } }); }
        return route.fulfill({ status: 204, body: '' });
      }
      if (p === '/api/v1/rooms' && method === 'GET') return route.fulfill({ json: [] });
      return route.fulfill({ json: { id: 'pitch-room', status: p.endsWith('/finish') ? 'finished' : 'live' } });
    });
    page = await context.newPage();
    await page.goto(base + '/salas/ao-vivo', { waitUntil: 'domcontentloaded' });
    await page.locator('.avatar-health.connected').waitFor({ timeout: 120000 });
    // Use a separate real window: this covers the platform's relay and a second
    // Unity runtime without pretending to certify native Document PiP.
    const pop = context.waitForEvent('page');
    await page.getByRole('button', { name: /Mini-player flutuante/ }).click(); popup = await pop;
    await page.waitForFunction(() => !!window.pitchRecognition);
    check(await popup.getByRole('button', {name:'Encerrar sala',exact:true}).isVisible(), 'Opening mini-player starts capture and exposes room control');
    await popup.waitForFunction(() => window.pitchEvents?.some(event => event.type === 'neotalk:ready'), null, { timeout: 120000 });
    trackingStart = Date.now();
    const primaryReady = await page.evaluate(() => window.pitchEvents.filter(event => event.type === 'neotalk:ready').length);
    const externalReady = await popup.evaluate(() => window.pitchEvents.filter(event => event.type === 'neotalk:ready').length);
    let nextInput = trackingStart, nextSample = trackingStart, index = 0;
    const interval = 360000 / wordsPerMinute;
    console.log('START REAL-TIME PITCH', { durationMs, wordsPerMinute, output });
    while (Date.now() - trackingStart < durationMs) {
      if (Date.now() >= nextInput) {
        const text = phrases[index++ % phrases.length];
        checkSilent(await page.getByRole('button', { name: 'Mutar microfone', exact: true }).isVisible(), 'Microphone unexpectedly muted during pitch');
        ledger.input.push({ text, at: Date.now() });
        await page.evaluate(text => window.pitchRecognition.onresult({ resultIndex: 0, results: { length: 1, 0: { isFinal: true, 0: { transcript: text } } } }), text);
        nextInput += process.env.PITCH_TEXTS_FILE ? text.trim().split(/\s+/).length * 60000 / wordsPerMinute : interval;
      }
      if (Date.now() >= nextSample) {
        const sample = await page.evaluate(() => ({ heap: performance.memory?.usedJSHeapSize ?? null, caption: document.querySelector('.live-captions')?.textContent, toast: document.querySelector('.toast')?.textContent || '', health: document.querySelector('.avatar-health')?.textContent, playing: window.pitchEvents.filter(event => event.type === 'neotalk:playing').length }));
        ledger.samples.push({ ...sample, at: Date.now(), unfinished: ledger.batches.filter(batch => !['done', 'error'].includes(batch.status)).length });
        console.log('SAMPLE', { seconds: Math.round((Date.now() - trackingStart) / 1000), input: ledger.input.length, done: ledger.batches.filter(batch => batch.status === 'done').length, ...sample });
        await checkpoint(); nextSample += 10000;
      }
      await sleep(70);
    }
    check(true, 'Timed pitch input completed without microphone pause');
    // Flush trailing text naturally, then wait for actual completion callbacks.
    const drainStarted = Date.now();
    for (;;) {
      await sleep(1000);
      const accepted = ledger.batches.map(batch => batch.text).join(' ');
      const expected = ledger.input.map(item => item.text).join(' ');
      if (normalize(accepted) === normalize(expected) && ledger.batches.every(batch => batch.status === 'done')) break;
      if (ledger.batches.some(batch => batch.status === 'error')) throw new Error('An admitted batch was marked error instead of completing');
      if (Date.now() - drainStarted > drainLimitMs) throw new Error(`Drain exceeded bounded observation window (${drainLimitMs}ms), not proof of renderer failure`);
      if ((Date.now() - drainStarted) % 10000 < 1200) { console.log('DRAIN', ledger.batches.filter(batch => batch.status === 'done').length, '/', ledger.batches.length); await checkpoint(); }
    }
    ledger.events = await page.evaluate(() => window.pitchEvents);
    const externalEvents = await popup.evaluate(() => window.pitchEvents);
    ledger.externalEvents = externalEvents;
    check(normalize(ledger.batches.map(batch => batch.text).join(' ')) === normalize(ledger.input.map(item => item.text).join(' ')), 'Every input word persisted in order, no discarded transcript');
    check(ledger.batches.every(batch => batch.status === 'done'), 'Every admitted batch completed');
    check(ledger.batches.every(batch => batch.text.split(/\s+/).length <= 12), 'Every animation job is limited to twelve source words');
    check(maxTranslateConcurrent <= 2, 'Translation concurrency stayed bounded at two');
    check(ledger.events.filter(event => event.type === 'neotalk:ready').length === primaryReady, 'Primary runtime never reinitialized');
    check(externalEvents.filter(event => event.type === 'neotalk:ready').length === externalReady, 'External runtime never reinitialized');
    check(!ledger.samples.some(sample => /acumul|pausad|excedid/i.test(sample.toast)), 'No overload warning during pitch');
    check(ledger.pageErrors.length === 0, 'No uncaught browser exceptions');
    const loaded = new Set(externalEvents.filter(event => event.type === 'neotalk:playing').map(event => event.phrase));
    check(ledger.translations.filter(item => item.status === 200).every(item => loaded.has(item.gloss)), 'External Unity acknowledged every distinct translated phrase');
    const lastCompletedAt = Math.max(...ledger.batches.flatMap(batch => batch.updates.filter(update => update.status === 'done').map(update => update.at)));
    const primaryCommands = ledger.events.filter(event => event.type === 'neotalk:playing' && event.at <= lastCompletedAt);
    check(primaryCommands.every(event => externalEvents.some(external => external.type === 'neotalk:playing' && external.correlationId === (event.correlationId || event.loadId))), 'External acknowledged every individual primary playback command, including repeated phrases');
    if (nativeRoot) {
      const terminal = events => events.filter(event => event.type === 'neotalk:playback-frame' && event.status === 'finished' && event.frame === event.frameCount - 1);
      check(primaryCommands.every(event => terminal(ledger.events).some(end => end.loadId === event.loadId)), 'Every primary execution reached its actual terminal frame');
      check(primaryCommands.every(event => terminal(externalEvents).some(end => end.correlationId === (event.correlationId || event.loadId))), 'Every mirrored execution reached its actual terminal frame');
    }
    const canvas = popup.frameLocator('iframe').locator('canvas');
    const first = await canvas.screenshot(); await sleep(250); const second = await canvas.screenshot();
    ledger.visualFramesDiffer = !first.equals(second); // informational: idle loop can be between poses
    await page.screenshot({ path: path.join(output, 'platform.png') }); await popup.screenshot({ path: path.join(output, 'external-player.png') });
    ledger.metrics = { inputWords: ledger.input.reduce((sum, item) => sum + item.text.split(/\s+/).length, 0), actualInputDurationMs: ledger.input.at(-1).at - ledger.input[0].at, maxTranslateConcurrent, drainMs: ledger.batches.at(-1).updates.find(update => update.status === 'done').at - drainStarted,
      translationLatencyMs: summarize(ledger.translations.filter(item => item.status === 200).map(item => item.ended - item.started)),
      batchCompletionLatencyMs: summarize(ledger.batches.map(batch => batch.updates.find(update => update.status === 'done').at - batch.at)) };
    const ends = ledger.events.filter(e => e.type === 'neotalk:playback-frame' && e.status === 'finished');
    const starts = ledger.events.filter(e => e.type === 'neotalk:playback-frame' && e.status === 'started');
    ledger.metrics.handoffGapMs = summarize(ends.map(end => starts.find(start => start.at > end.at && start.loadId !== end.loadId)?.at - end.at).filter(Number.isFinite));
    await popup.getByRole('button', { name: 'Encerrar sala', exact: true }).click();
    await page.getByRole('button', { name: 'Iniciar sala ao vivo', exact: true }).waitFor();
    await popup.getByRole('button', { name: 'Iniciar sala', exact: true }).click();
    await page.getByRole('button', { name: 'Encerrar sala', exact: true }).waitFor();
    check(true,'Mini-player can stop and restart the room');
    await popup.getByRole('button', { name: 'Encerrar sala', exact: true }).click();
    ledger.result = 'PASS'; console.log('FINAL', ledger.metrics);
  } catch (error) {
    ledger.result = 'FAIL'; ledger.failure = { message: error.message, stack: error.stack };
    console.error('FAIL', error); process.exitCode = 1;
  } finally {
    if (popup && !popup.isClosed()) ledger.externalEvents = await popup.evaluate(() => window.pitchEvents || []).catch(() => ledger.externalEvents);
    if (page && !page.isClosed()) {
      ledger.events = await page.evaluate(() => window.pitchEvents || []).catch(() => ledger.events);
      await page.screenshot({ path: path.join(output, 'final-state.png') }).catch(() => {});
    }
    await checkpoint(); await browser?.close(); console.log('EVIDENCE', output);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
function checkSilent(condition, message) { if (!condition) throw new Error(message); }
