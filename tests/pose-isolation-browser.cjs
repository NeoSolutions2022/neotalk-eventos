// Isolate rendering from microphone, GPT, queue, polling and popup.
const { chromium } = require('C:/Users/felip/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..');
const host = 'https://infra-avatar3d-oficial.k3p3ex.easypanel.host';
const parent = 'https://qa.neotalk.test';
const out = path.join(root, 'outputs', `pose-isolation-${Date.now()}`);
const nativeRoot = process.env.ELIA_NATIVE_BUILD;
const mime = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' };
(async () => {
  await fs.mkdir(out, { recursive: true });
  const { concatenatePoses } = await import(pathToFileURL(path.join(root, 'neotalk-eventos/mobile-offline/src/engine.mjs')));
  const raw = await fs.readFile(path.join(root, 'Avatar3DFrontend/webgl/elia/StreamingAssets/amigo.pose'), 'utf8');
  const learn = await fs.readFile(path.join(root, 'Avatar3DFrontend/webgl/elia/StreamingAssets/aprender.pose'), 'utf8');
  const cases = [
    ...(process.env.ELIA_SINGLE_FRAME === 'true' ? [{ id: 'single', text: raw.slice(0, raw.indexOf('# Frame: frame_000000000001')), frames: 1 }] : []),
    { id: 'original', text: raw, frames: (raw.match(/- Body Keypoints/g) || []).length },
    { id: 'renumbered', ...concatenatePoses([raw]) },
    { id: 'two', ...concatenatePoses([raw, learn]) },
    { id: 'long', ...concatenatePoses([raw, learn, raw, learn, raw, learn]) },
    { id: 'replay', sourceId: 'long', ...concatenatePoses([raw, learn, raw, learn, raw, learn]) },
  ];
  if (process.env.ELIA_SINGLE_FRAME === 'true') cases.splice(1);
  const report = { cases: [], errors: [], logs: [], nativeRoot, limitation: 'Real Unity WebGL software rendering, controlled local poses. Not microphone, production API or linguistic QA.' };
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1200, height: 700 } });
    await context.route(parent + '/**', route => route.fulfill({ contentType: 'text/html', body: `<iframe src="${host}/widget?avatar=elia&loop=0" style="width:780px;height:670px;border:0"></iframe>${nativeRoot ? `<iframe src="${host}/widget?avatar=elia&loop=0" style="width:380px;height:620px;border:0"></iframe>` : ''}<script>window.events=[];addEventListener('message',e=>events.push({...e.data,output:[...document.querySelectorAll('iframe')].findIndex(f=>f.contentWindow===e.source),at:Date.now()}))</script>` }));
    await context.route(host + '/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/v1/widget/config') return route.fulfill({ json: { allowed_origins: [parent] } });
      if (url.pathname.startsWith('/qa/')) {
        const item = cases.find(item => url.pathname === `/qa/${item.id}.pose`);
        return route.fulfill({ contentType: 'text/plain', body: item.text || item.content });
      }
      const file = url.pathname === '/widget' ? path.join(root, 'Avatar3DFrontend/frontend/widget.html')
        : url.pathname.startsWith('/static/') ? path.join(root, 'Avatar3DFrontend/frontend', url.pathname.slice(8))
          : nativeRoot && url.pathname.startsWith('/webgl/elia/') ? path.join(nativeRoot, url.pathname.slice('/webgl/elia/'.length))
          : path.join(root, 'Avatar3DFrontend', url.pathname.slice(1));
      try { await route.fulfill({ body: await fs.readFile(file), contentType: mime[path.extname(file)] || 'application/octet-stream' }); }
      catch { await route.fulfill({ status: 404 }); }
    });
    const page = await context.newPage();
    page.on('console', message => report.logs.push({ type: message.type(), text: message.text() }));
    page.on('pageerror', error => report.errors.push(error.message));
    await page.goto(parent);
    await page.waitForFunction(count => new Set(window.events.filter(e => e.type === 'neotalk:ready').map(e => e.output)).size === count, nativeRoot ? 2 : 1, { timeout: 120000 });
    if (nativeRoot && !await page.evaluate(() => window.events.some(e => e.type === 'neotalk:ready' && e.capabilities?.includes('native-playback-progress')))) throw new Error('Native capability missing from real build');
    for (const item of cases) {
      const frames = item.frames || item.frame_count;
      await page.evaluate(({ host, id, sourceId, frames }) => document.querySelectorAll('iframe').forEach(frame => frame.contentWindow.postMessage({ type: 'neotalk:load-pose', phrase: id, loadId: id, pose: { content_url: `${host}/qa/${sourceId || id}.pose`, fps: 30, frame_count: frames }, words: ['AMIGO'] }, host)), { host, id: item.id, sourceId: item.sourceId, frames });
      await page.waitForFunction(id => window.events.some(e => e.type === 'neotalk:playing' && e.correlationId === id), item.id, { timeout: 45000 });
      for (const delay of [0, 400, 800]) {
        await page.waitForTimeout(delay);
        await page.screenshot({ path: path.join(out, `${item.id}-${delay}.png`) });
      }
      if (process.env.ELIA_ASSERT_CONTINUITY === 'true' && item.id === 'renumbered') {
        if (!report.logs.some(log => log.text.includes('ELIA_CONTINUITY_START'))) throw new Error('Continuity layer did not start during real preparation');
        const first = await page.frameLocator('iframe').first().locator('#unity-canvas').screenshot();
        await page.waitForTimeout(600);
        const second = await page.frameLocator('iframe').first().locator('#unity-canvas').screenshot();
        if (first.equals(second)) throw new Error('Prepared-history replay remained visually static');
        await fs.writeFile(path.join(out, 'continuity-before.png'), first);
        await fs.writeFile(path.join(out, 'continuity-after.png'), second);
      }
      if (nativeRoot) {
        await page.waitForFunction(id => new Set(window.events.filter(e => e.type === 'neotalk:playback-frame' && e.correlationId === id && e.status === 'finished').map(e => e.output)).size === 2, item.id, { timeout: 90000 });
        const completion = await page.evaluate(id => window.events.filter(e => e.type === 'neotalk:playback-frame' && e.correlationId === id && e.status === 'finished'), item.id);
        if (completion.length !== 2 || completion.some(e => e.frame !== e.frameCount - 1)) throw new Error('Invalid terminal-frame report: ' + item.id);
      } else await page.waitForTimeout(frames / 30 * 1000 + 500);
      await page.screenshot({ path: path.join(out, `${item.id}-end.png`) });
      report.cases.push({ id: item.id, frames, events: await page.evaluate(id => window.events.filter(e => e.correlationId === id || e.phrase === id), item.id) });
      console.log('CAPTURED', item.id, frames);
    }
  } finally {
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close(); console.log('EVIDENCE', out);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
