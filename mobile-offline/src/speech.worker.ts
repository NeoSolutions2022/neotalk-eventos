import { env, pipeline } from '@huggingface/transformers';
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = '/models/';
env.useBrowserCache = false;
const wasm = env.backends.onnx.wasm;
if (!wasm) throw new Error('Backend de voz WASM indisponível.');
wasm.wasmPaths = '/wasm/';
wasm.numThreads = 1;
wasm.proxy = false;
let model: Promise<any> | undefined;
const load = () => model ||= pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny', { device: 'wasm', dtype: 'q8' });
// Serialize inference: two simultaneous decoders compete for scarce mobile RAM.
let pending = Promise.resolve();
const cancelled = new Set<number>();
self.onmessage = ({ data }) => {
  if (data.cancel) { cancelled.add(data.id); return; }
  pending = pending.then(async () => {
    try {
      if (cancelled.has(data.id)) return;
      const engine = await load();
      if (cancelled.has(data.id)) return;
      const result = data.audio ? await engine(data.audio, { language: 'portuguese', task: 'transcribe', return_timestamps: false }) : { text: '' };
      if (!cancelled.has(data.id)) self.postMessage({ id: data.id, text: result.text });
    } catch (error) {
      model = undefined;
      self.postMessage({ id: data.id, error: error instanceof Error ? error.message : 'Falha no modelo de voz local.' });
    } finally { cancelled.delete(data.id); }
  });
};
