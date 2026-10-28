// Real local widget/Unity/API test of native QA loop. No API mocks, no audio.
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'C:/Users/felip/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..'), base = 'http://localhost:3310';
const output = path.join(root, 'outputs', `quality-native-loop-${Date.now()}`);
const result = { kind: 'real-quality-native-loop', startedAt: new Date().toISOString(), poseSubmissions: 0, pageErrors: 0,
  limitations: ['Synthetic text; no physical audio or linguistic QA', 'Native progress callbacks are sampled, not a recording of every GPU frame'], result: 'RUNNING' };
let browser, page;
(async () => {
  await fs.mkdir(output, { recursive: true });
  try {
    const password = (await fs.readFile(path.join(root, '.env.homolog.local'), 'utf8')).match(/^HOMOLOG_ADMIN_PASSWORD=(.+)$/m)?.[1].trim();
    browser = await chromium.launch({ channel: 'msedge', args: ['--enable-unsafe-swiftshader'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const login = await context.request.post(`${base}/api/v1/auth/login`, { headers: { Origin: base }, data: { email: 'qa@homolog.invalid', password } });
    if (!login.ok()) throw new Error('Local authentication failed');
    context.on('response', response => {
      if (response.url() === 'http://localhost:38080/api/v1/mvp/sign') result.poseSubmissions++;
    });
    await context.addInitScript(() => {
      if (location.origin === 'http://localhost:38080') {
        window.addEventListener('avatar3d-playback', event => {
          const native = event.detail || {};
          window.parent.postMessage({ type: '__qa:native-observation', status: native.status,
            frame: native.frame, frameCount: native.frameCount, playbackId: native.playbackId }, 'http://localhost:3310');
        });
      } else {
        window.__qaLoop = { native: [], readyCount: 0, poseLoads: 0, loadId: null };
        window.addEventListener('message', event => {
          if (event.origin !== 'http://localhost:38080' || event.source !== document.querySelector('iframe')?.contentWindow) return;
          const data = event.data;
          if (data?.type === 'neotalk:ready') window.__qaLoop.readyCount++;
          if (data?.type === 'neotalk:pose-ready') { window.__qaLoop.loadId = data.loadId; window.__qaLoop.poseLoads++; }
          if (data?.type === '__qa:native-observation') {
            window.__qaLoop.native.push({ at: Date.now(), status: data.status, frame: data.frame, frameCount: data.frameCount, playbackId: data.playbackId });
            if (window.__qaLoop.native.length > 5000) window.__qaLoop.native.shift();
          }
        });
      }
    });
    page = await context.newPage(); page.on('pageerror', () => result.pageErrors++);
    await page.goto(`${base}/qualidade`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__qaLoop?.readyCount > 0, null, { timeout: 120000 });
    const loop = new URL(await page.locator('iframe').getAttribute('src')).searchParams.get('loop');
    if (loop !== '1') throw new Error('Candidate native looping is not deployed locally');
    await page.getByRole('textbox', { name: 'Texto em português', exact: true }).fill('Eu quero aprender Libras.');
    await page.getByRole('button', { name: 'Executar comparação', exact: true }).click();
    await page.waitForFunction(() => {
      const data = window.__qaLoop, frames = data.native.filter(frame => frame.playbackId === data.loadId &&
        ['started', 'progress', 'finished'].includes(frame.status));
      let wraps = 0;
      for (let i = 1; i < frames.length; i++) {
        if (frames[i].frame < frames[i - 1].frame && frames[i - 1].frame >= .9 * (frames[i - 1].frameCount - 1)) wraps++;
      }
      return wraps >= 2;
    }, null, { timeout: 180000 });
    const observed = await page.evaluate(() => {
      const data = window.__qaLoop;
      return { readyCount: data.readyCount, poseLoads: data.poseLoads,
        frames: data.native.filter(frame => frame.playbackId === data.loadId && ['started', 'progress', 'finished'].includes(frame.status)) };
    });
    result.readyCount = observed.readyCount; result.poseLoads = observed.poseLoads;
    result.nativeSamples = observed.frames;
    result.wraps = observed.frames.reduce((total, frame, index, frames) => total + (index > 0 && frame.frame < frames[index - 1].frame && frames[index - 1].frame >= .9 * (frames[index - 1].frameCount - 1) ? 1 : 0), 0);
    if (result.poseSubmissions !== 1 || result.poseLoads !== 1 || result.readyCount !== 1 || result.pageErrors) throw new Error('Native loop repeated API/load work or reset the runtime');
    await page.locator('.compare-grid').screenshot({ path: path.join(output, 'comparison.png') }).catch(() => {});
    result.result = 'PASS';
  } catch (error) { result.result = 'FAIL'; result.failure = error.message.replace(/https?:\/\/\S+/g, '[url]'); process.exitCode = 1; }
  finally {
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'final-state.png') }).catch(() => {});
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(result, null, 2));
    await browser?.close(); console.log('QUALITY_LOOP', result.result, result.failure || '', output);
  }
})().catch(() => { console.error('Quality loop setup failed'); process.exitCode = 1; });
