import { translate, concatenatePoses, PoseCache } from './engine.mjs';
import { transcribe } from './speech';
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
type Entry = { gloss: string; aliases?: string[]; file: string; sha256: string; fps: number };
let entries: Entry[] = [];
const cache = new PoseCache(64);
const rooms = new Map<string, Record<string, unknown>>();
const batches = new Map<string, Record<string, unknown>>();
const inFlight = new Map<string, Promise<unknown>>();
export async function initializeCatalog() {
  const response = await fetch('/offline/catalog.json');
  if (!response.ok) throw new Error('Pacote de sinais não instalado.');
  const catalog = await response.json();
  entries = catalog.entries;
  if (!entries.length) throw new Error('O catálogo offline está vazio.');
  return catalog;
}
export async function buildPose(phrase: string) {
  const result = translate(phrase, entries);
  if (!result.entries.length) throw new ApiError(422, 'Nenhum sinal local disponível para este trecho.');
  const key = result.gloss_text;
  if (inFlight.has(key)) return inFlight.get(key);
  const work = cache.get(key, async () => {
    const fps = result.entries[0].fps;
    if (result.entries.some((entry: Entry) => entry.fps !== fps)) throw new Error('As poses possuem taxas de frames diferentes.');
    const contents = await Promise.all(result.entries.map(async (entry: Entry) => {
      const response = await fetch(entry.file);
      if (!response.ok) throw new Error(`Sinal local indisponível: ${entry.gloss}`);
      const bytes = await response.arrayBuffer();
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
      if (hash !== entry.sha256) throw new Error(`Sinal local corrompido: ${entry.gloss}`);
      return new TextDecoder().decode(bytes);
    }));
    const combined = concatenatePoses(contents);
    return { pose: { content_url: URL.createObjectURL(new Blob([combined.content], { type: 'text/plain' })), fps, frame_count: combined.frame_count }, palavras_encontradas: result.entries.map((entry: Entry) => entry.gloss) };
  }).finally(() => inFlight.delete(key));
  inFlight.set(key, work); return work;
}
export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  options.signal?.throwIfAborted();
  const method = options.method || 'GET';
  const data = typeof options.body === 'string' ? JSON.parse(options.body) : {};
  let result: unknown;
  if (path === '/health') result = { status: 'offline' };
  else if (path === '/agent/translate') {
    const translated = translate(data.text, entries);
    result = { ...translated, skipped: !translated.gloss_text, model: 'offline-dictionary', agent_latency_ms: 0 };
  } else if (path === '/agent/transcribe' && options.body instanceof Blob) {
    result = { text: await transcribe(options.body, options.signal || undefined) };
  } else if (path === '/rooms') {
    if (method === 'GET') result = [...rooms.values()];
    else {
      const id = crypto.randomUUID(); result = { ...data, id, status: 'ready' }; rooms.set(id, result as Record<string, unknown>);
      // Bound session memory; the offline prototype does not retain old recordings.
      if (rooms.size > 20) rooms.delete(rooms.keys().next().value!);
    }
  } else {
    const match = path.match(/^\/rooms\/([^/]+)\/(start|finish|heartbeat|batches)$/);
    if (match) {
      const room = rooms.get(match[1]); if (!room) throw new ApiError(404, 'Sala local não encontrada.');
      if (match[2] === 'batches') {
        const id = crypto.randomUUID(); result = { ...data, id, status: 'queued' }; batches.set(id, result as Record<string, unknown>);
        if (batches.size > 200) batches.delete(batches.keys().next().value!);
      } else {
        if (match[2] !== 'heartbeat') room.status = match[2] === 'start' ? 'live' : 'finished';
        result = match[2] === 'heartbeat' ? undefined : room;
      }
    } else if (path.startsWith('/batches/') && method === 'PATCH') {
      const batch = batches.get(path.split('/')[2]); if (!batch) throw new ApiError(404, 'Trecho local não encontrado.');
      Object.assign(batch, data); result = batch;
    } else throw new ApiError(404, `Operação não suportada no modo offline: ${path}`);
  }
  options.signal?.throwIfAborted(); return result as T;
}
