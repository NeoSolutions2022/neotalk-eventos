// A room's async work must never escape into a later room or survive teardown.
export class LiveSessionScope {
  private controller = new AbortController();
  get signal() { return this.controller.signal; }
  begin() {
    this.controller.abort();
    this.controller = new AbortController();
    return this.controller.signal;
  }
  end() { this.controller.abort(); }
  isCurrent(signal: AbortSignal) { return signal === this.controller.signal && !signal.aborted; }
}

// Parallel transcription is useful, but its completion order is not speech order.
export class OrderedTranscriptBuffer {
  private nextIssued = 0;
  private nextDelivered = 0;
  private completed = new Map<number, string>();
  issue() { return this.nextIssued++; }
  complete(sequence: number, text: string): string[] {
    if (sequence < this.nextDelivered || sequence >= this.nextIssued) return [];
    this.completed.set(sequence, text);
    const ready: string[] = [];
    while (this.completed.has(this.nextDelivered)) {
      const value = this.completed.get(this.nextDelivered)!;
      this.completed.delete(this.nextDelivered++);
      if (value.trim()) ready.push(value);
    }
    return ready;
  }
}

export function isTransientLiveFailure(reason: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return false;
  if (!(reason instanceof Error)) return false;
  if ('status' in reason) {
    const status = Number(reason.status);
    return status === 408 || status === 429 || (status >= 500 && status <= 599);
  }
  return reason instanceof TypeError || reason.name === 'TimeoutError';
}

export async function retryLiveRequest<T>(request: () => Promise<T>, signal: AbortSignal,
  delays = [350, 800]): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try { return await request(); }
    catch (reason) {
      signal.throwIfAborted();
      if (!isTransientLiveFailure(reason, signal) || attempt >= delays.length) throw reason;
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, delays[attempt]);
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
      });
    }
  }
}
