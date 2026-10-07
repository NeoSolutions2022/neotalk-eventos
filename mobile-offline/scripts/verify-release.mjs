import { readFile, stat } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { translate, concatenatePoses } from '../src/engine.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
const catalog = JSON.parse(await readFile(join(root, 'offline/catalog.json'), 'utf8'));
if (!catalog.complete || !Number.isInteger(catalog.expectedCount) || catalog.entries.length !== catalog.expectedCount) throw new Error('Release blocked: catalog incomplete or expectedCount missing/mismatched.');
translate('', catalog.entries); // Reject ambiguous aliases.
for (const entry of catalog.entries) {
  const bytes = await readFile(join(root, entry.file));
  if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error(`Corrupt pose: ${entry.gloss}`);
  concatenatePoses([bytes.toString('utf8')]);
}
const manifest = JSON.parse(await readFile(join(root, 'models/manifest.json'), 'utf8'));
for (const entry of manifest.files) {
  const bytes = await readFile(join(root, 'models', manifest.model, entry.file));
  if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error(`Corrupt model: ${entry.file}`);
}
for (const file of ['config.json', 'tokenizer.json', 'preprocessor_config.json', 'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx']) await stat(join(root, 'models', manifest.model, file));
for (const file of ['webgl/elia/Build/elia.wasm', 'webgl/elia/Build/elia.data', 'wasm/ort-wasm-simd-threaded.wasm', 'inter.woff2']) await stat(join(root, file));
console.log(`Release package verified: ${catalog.entries.length} signs, local ASR, Elia runtime.`);
