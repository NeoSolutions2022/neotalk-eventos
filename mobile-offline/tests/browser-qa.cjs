const { chromium } = require('C:/Users/felip/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [], external = [], events = [];
  page.on('pageerror', error => { errors.push(error.message); console.log('PAGEERROR:', error.message); });
  page.on('console', message => { if (message.type() === 'error') console.log('BROWSER:', message.text()); });
  await page.route('**/*', route => {
    const url = route.request().url();
    if (!url.startsWith('http://127.0.0.1:4179/') && !url.startsWith('blob:') && !url.startsWith('data:')) { external.push(url); return route.abort(); }
    return route.continue();
  });
  await page.goto('http://127.0.0.1:4179/');
  console.log('Page navigated');
  await page.screenshot({ path: path.resolve(__dirname, '../../../outputs/mobile-offline-initial.png'), fullPage: true });
  await page.evaluate(() => { window.offlineEvents = []; window.addEventListener('message', e => { if (e.data?.type?.startsWith('neotalk:')) window.offlineEvents.push(e.data); }); });
  await page.getByText('Pacote de desenvolvimento:', { exact: false }).waitFor();
  console.log('Catalog and UI loaded');
  await page.waitForFunction(() => window.offlineEvents.some(e => e.type === 'neotalk:ready'), null, { timeout: 90000 });
  console.log('Unity ready');
  await page.evaluate(() => document.querySelector('iframe').contentWindow.postMessage({ type: 'neotalk:sign', phrase: 'AMIGO APRENDER' }, location.origin));
  await page.waitForFunction(() => window.offlineEvents.some(e => e.type === 'neotalk:playing'), null, { timeout: 90000 });
  console.log('Local pose playing');
  const pose = await page.evaluate(async () => {
    const a = await window.neoTalkOffline.buildPose('AMIGO APRENDER');
    const b = await window.neoTalkOffline.buildPose('AMIGO APRENDER');
    return { frame_count: a.pose.frame_count, reused: a.pose.content_url === b.pose.content_url, words: a.palavras_encontradas };
  });
  await page.getByRole('button', { name: 'Preparar voz local' }).click();
  await page.getByRole('button', { name: 'Voz em português pronta' }).waitFor({ timeout: 120000 });
  const output = path.resolve(__dirname, '../../../outputs/mobile-offline'); await fs.mkdir(output, { recursive: true });
  await page.screenshot({ path: path.join(output, 'mobile-preview.png'), fullPage: true });
  const result = { pose, errors, externalRequests: external, events: await page.evaluate(() => window.offlineEvents.map(e => ({ type: e.type, status: e.status, code: e.code }))), voicePrepared: true, note: 'Chromium preview only; not Android/iOS certification.' };
  await fs.writeFile(path.join(output, 'browser-results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result)); await browser.close();
  if (errors.length || external.length || !pose.reused) process.exitCode = 1;
})().catch(error => { console.error(error); process.exit(1); });
