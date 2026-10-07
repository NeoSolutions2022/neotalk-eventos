import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const model = 'onnx-community/whisper-tiny';
const infoResponse = await fetch(`https://huggingface.co/api/models/${model}`);
if (!infoResponse.ok) throw new Error(`Model metadata: ${infoResponse.status}`);
const info = await infoResponse.json();
const files = info.siblings.map(file => file.rfilename).filter(name => name.endsWith('.json') || ['onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx'].includes(name));
const manifest = { model, revision: info.sha, files: [] };
for (const file of files) {
  const response = await fetch(`https://huggingface.co/${model}/resolve/${info.sha}/${file}`);
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const target = join(root, 'public', 'models', model, file);
  await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes);
  manifest.files.push({ file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  console.log(`${file}: ${(bytes.length / 1048576).toFixed(1)} MiB`);
}
await writeFile(join(root, 'public', 'models', 'manifest.json'), JSON.stringify(manifest, null, 2));
