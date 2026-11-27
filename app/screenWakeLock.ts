// One lifecycle per visible output. Never let a late request keep an idle page awake.
export function keepScreenAwake(target: Window): () => void {
  const doc = target.document;
  const api = target.navigator?.wakeLock;
  if (!api || typeof api.request !== "function") return () => {};

  let active = true;
  let pageAvailable = true;
  let pending = false;
  let lock: WakeLockSentinel | null = null;
  let retry: number | undefined;
  const eligible = () => active && pageAvailable && doc.visibilityState === "visible";

  function cancelRetry() {
    if (retry !== undefined) target.clearTimeout(retry);
    retry = undefined;
  }

  function scheduleRetry() {
    if (!eligible() || retry !== undefined) return;
    retry = target.setTimeout(() => {
      retry = undefined;
      void acquire();
    }, 15_000);
  }

  function drop() {
    cancelRetry();
    const previous = lock;
    lock = null;
    if (previous && !previous.released) void previous.release().catch(() => {});
  }

  async function acquire() {
    if (!eligible() || pending || (lock && !lock.released)) return;
    pending = true;
    try {
      const next = await api.request("screen");
      if (!eligible()) {
        if (!next.released) await next.release();
        return;
      }
      if (next.released) {
        scheduleRetry();
        return;
      }
      lock = next;
      next.addEventListener("release", () => {
        if (lock !== next) return;
        lock = null;
        scheduleRetry();
      }, { once: true });
    } catch {
      // Battery saver, OS policy or an invisible document may deny the lock.
      // Translation and audio capture must continue independently.
      scheduleRetry();
    } finally {
      pending = false;
    }
  }

  function onVisibilityChange() {
    if (!eligible()) return drop();
    cancelRetry();
    void acquire();
  }
  function onPageHide() {
    pageAvailable = false;
    drop();
  }
  function onPageShow() {
    pageAvailable = true;
    onVisibilityChange();
  }

  doc.addEventListener("visibilitychange", onVisibilityChange);
  target.addEventListener("pagehide", onPageHide);
  target.addEventListener("pageshow", onPageShow);
  void acquire();

  return () => {
    active = false;
    doc.removeEventListener("visibilitychange", onVisibilityChange);
    target.removeEventListener("pagehide", onPageHide);
    target.removeEventListener("pageshow", onPageShow);
    drop();
  };
}
