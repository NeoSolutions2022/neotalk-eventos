export type PoseTiming = { fps?: number; frame_count?: number };

export const LIVE_BATCH_SILENCE_MS = 320;
export const LIVE_BATCH_PUNCTUATION_MS = 120;
export const LIVE_IDLE_LOOP_GAP_MS = 120;
export const LIVE_BATCH_BACKPRESSURE_MS = 650;

export function batchFlushDelayMs(lastTranscript: string, bufferedWords: number, queuedBatches: number): number {
  if (/[.!?;:]$/.test(lastTranscript.trim())) return LIVE_BATCH_PUNCTUATION_MS;
  if (queuedBatches >= 3 && bufferedWords < 6) return LIVE_BATCH_BACKPRESSURE_MS;
  return LIVE_BATCH_SILENCE_MS;
}

export function matchesActivePhrase(reported: string | undefined, active: string): boolean {
  if (!reported) return true;
  const normalized = (value: string) => value.replace(/\s+/g, " ").trim().toUpperCase();
  return !!active && normalized(reported) === normalized(active);
}

export function playbackDurationMs(pose: PoseTiming | undefined, wordCount: number): number {
  const frameCount = pose?.frame_count ?? 0;
  const fps = pose?.fps ?? 0;
  if (Number.isFinite(frameCount) && Number.isFinite(fps) && frameCount > 0 && fps > 0) {
    // Aguarda todos os frames; a margem pequena evita um intervalo visível
    // entre poses sem antecipar a próxima e cortar o último sinal.
    return Math.ceil((frameCount / fps) * 1000) + 80;
  }
  // Sem metadados confiáveis, prefira não cortar a animação.
  return Math.max(3500, wordCount * 1300);
}
