const worker = new Worker(new URL('./speech.worker.ts', import.meta.url), { type: 'module' });
let sequence = 0;
const pending = new Map<number, { resolve: (text: string) => void; reject: (error: Error) => void; cleanup: () => void }>();
worker.onmessage = ({ data }) => {
  const request = pending.get(data.id); if (!request) return;
  request.cleanup();
  if (data.error) request.reject(new Error(data.error)); else request.resolve(data.text || '');
};
worker.onerror = () => {
  for (const request of [...pending.values()]) { request.cleanup(); request.reject(new Error('O reconhecimento de voz local foi interrompido.')); }
};
function request(audio?: Float32Array, signal?: AbortSignal) {
  signal?.throwIfAborted();
  return new Promise<string>((resolve, reject) => {
    const id = ++sequence;
    const abort = () => { worker.postMessage({ id, cancel: true }); cleanup(); reject(signal!.reason || new DOMException('Cancelado', 'AbortError')); };
    const timer = setTimeout(() => { worker.postMessage({ id, cancel: true }); cleanup(); reject(new Error('O aparelho excedeu o tempo de processamento local.')); }, 120000);
    const cleanup = () => { clearTimeout(timer); pending.delete(id); signal?.removeEventListener('abort', abort); };
    pending.set(id, { resolve, reject, cleanup }); signal?.addEventListener('abort', abort, { once: true });
    worker.postMessage({ id, audio }, audio ? [audio.buffer] : []);
  });
}
export const prepareSpeech = () => request();
export async function transcribe(blob: Blob, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const render = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
    const source = render.createBufferSource(); source.buffer = decoded; source.connect(render.destination); source.start();
    const pcm = (await render.startRendering()).getChannelData(0);
    signal?.throwIfAborted();
    // Skip silence to reduce hallucinations and battery consumption.
    const rms = Math.sqrt(pcm.reduce((sum, value) => sum + value * value, 0) / pcm.length);
    if (!Number.isFinite(rms) || rms < 0.003) return '';
    return await request(pcm, signal);
  } finally { await context.close(); }
}
