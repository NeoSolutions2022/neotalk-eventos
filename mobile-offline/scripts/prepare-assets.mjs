import { mkdir, readFile, writeFile, cp, readdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');
const args = process.argv.slice(2);
const arg = name => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
const avatarRoot = resolve(arg('--avatar-root') || '../../Avatar3DFrontend');
const widgetRoot = resolve(arg('--widget-root') || '../../Avatar3DFrontend');
const dataset = arg('--dataset');
await mkdir(join(publicDir, 'static'), { recursive: true });
await mkdir(join(publicDir, 'offline', 'poses'), { recursive: true });
await mkdir(join(publicDir, 'webgl'), { recursive: true });
await cp(join(avatarRoot, 'webgl', 'elia'), join(publicDir, 'webgl', 'elia'), { recursive: true });
await cp(join(root, '..', 'public', 'neotalk-logo.png'), join(publicDir, 'neotalk-logo.png'));
await cp(join(root, '..', 'public', 'external-player-relay.js'), join(publicDir, 'external-player-relay.js'));
await writeFile(join(publicDir, 'platform.css'), (await readFile(join(root, '..', 'app', 'globals.css'), 'utf8')).replace('@import "tailwindcss";', ''));
const fonts = join(root, '..', '.vinext', 'fonts');
async function findFont(dir) {
  for (const file of await readdir(dir, { withFileTypes: true })) {
    if (file.isDirectory()) { const found = await findFont(join(dir, file.name)); if (found) return found; }
    else if (file.name.startsWith('inter-') && file.name.endsWith('.woff2')) return join(dir, file.name);
  }
}
const font = await findFont(fonts).catch(() => null);
if (font) await cp(font, join(publicDir, 'inter.woff2'));
else throw new Error('Fonte Inter local ausente. Faça primeiro o build da plataforma.');
await writeFile(join(publicDir, 'webgl', 'catalog.json'), JSON.stringify({ defaultAvatar: 'elia', avatars: [{ id: 'elia', name: 'Elia', manifestUrl: 'elia/manifest.json' }] }));
let widget = await readFile(join(widgetRoot, 'frontend', 'widget.js'), 'utf8');
// WKWebView serializes capacitor:// origins as "null". Use location.href as
// URL base, but retain origin + source checks for message authorization.
widget = widget.replace('new URL(value, window.location.origin)', 'new URL(value, window.location.href)');
widget = widget.replace('new URL(avatar.manifestUrl, `${window.location.origin}/webgl/`)', 'new URL(avatar.manifestUrl, new URL("/webgl/", window.location.href))');
await writeFile(join(publicDir, 'static', 'widget.js'), widget);
await cp(join(widgetRoot, 'frontend', 'widget.css'), join(publicDir, 'static', 'widget.css'));
await cp(join(root, 'src', 'widget-shim.js'), join(publicDir, 'static', 'offline-widget.js'));
const html = (await readFile(join(widgetRoot, 'frontend', 'widget.html'), 'utf8')).replace(/src="\/static\/widget\.js[^\"]*"/, 'src="/static/offline-widget.js"');
await writeFile(join(publicDir, 'widget.html'), html);
// Release catalog is an explicit manifest, not all Unity debugging poses.
const input = dataset ? JSON.parse(await readFile(resolve(dataset), 'utf8')) : {
  version: 'development-sample', complete: false,
  entries: ['amigo', 'aprender', 'comprar', 'compreender', 'confundir'].map(gloss => ({ gloss: gloss.toUpperCase(), file: join(avatarRoot, 'webgl', 'elia', 'StreamingAssets', `${gloss}.pose`), fps: 24 })),
};
if (!Array.isArray(input.entries) || !input.entries.length) throw new Error('Catálogo vazio.');
const entries = [];
for (const [index, entry] of input.entries.entries()) {
  if (!entry.gloss || !Number.isFinite(entry.fps) || entry.fps <= 0) throw new Error('Cada sinal precisa de glosa e FPS positivo.');
  const source = dataset ? resolve(dirname(resolve(dataset)), entry.file) : entry.file;
  const bytes = await readFile(source);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (entry.sha256 && entry.sha256 !== sha256) throw new Error(`Hash incorreto: ${entry.gloss}`);
  const file = `/offline/poses/${index}-${sha256.slice(0, 12)}.pose`;
  await writeFile(join(publicDir, file), bytes);
  entries.push({ gloss: entry.gloss, aliases: entry.aliases || [], fps: entry.fps, file, sha256 });
}
await writeFile(join(publicDir, 'offline', 'catalog.json'), JSON.stringify({ version: input.version, complete: input.complete === true, expectedCount: input.expectedCount, entries }, null, 2));
// ONNX Runtime must also be bundled: no CDN fetch in offline mode.
const wasmDir = join(root, 'node_modules', 'onnxruntime-web', 'dist');
await mkdir(join(publicDir, 'wasm'), { recursive: true });
for (const file of await readdir(wasmDir)) if (/\.(wasm|mjs)$/.test(file) && file.startsWith('ort-wasm')) await cp(join(wasmDir, file), join(publicDir, 'wasm', file));
console.log(`Assets prepared: ${entries.length} poses; ${input.complete ? 'release candidate' : 'DEVELOPMENT SAMPLE ONLY'}.`);
