import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../app/screenWakeLock.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { keepScreenAwake } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const flush = () => new Promise((resolve) => setImmediate(resolve));

class Lock extends EventTarget {
  released = false;
  async release() {
    assert.equal(this.released, false);
    this.released = true;
    this.dispatchEvent(new Event("release"));
  }
}

function fixture(request = async () => new Lock()) {
  const target = new EventTarget();
  const document = new EventTarget();
  document.visibilityState = "visible";
  const timers = new Map();
  let calls = 0;
  let id = 0;
  const locks = [];
  Object.assign(target, {
    document,
    navigator: { wakeLock: { async request(type) {
      assert.equal(type, "screen");
      calls++;
      const lock = await request();
      locks.push(lock);
      return lock;
    } } },
    setTimeout(callback, delay) {
      assert.equal(delay, 15_000);
      timers.set(++id, callback);
      return id;
    },
    clearTimeout(key) { timers.delete(key); },
  });
  return {
    target, locks, timers, get calls() { return calls; },
    visibility(state) {
      document.visibilityState = state;
      document.dispatchEvent(new Event("visibilitychange"));
    },
    retry() {
      const [key, cb] = timers.entries().next().value;
      timers.delete(key);
      cb();
    },
  };
}

test("holds one lock per visible document, restores it and releases on stop", async () => {
  const f = fixture();
  const stop = keepScreenAwake(f.target);
  f.visibility("visible");
  await flush();
  assert.equal(f.calls, 1);
  f.visibility("hidden");
  assert.equal(f.locks[0].released, true);
  assert.equal(f.timers.size, 0);
  f.visibility("visible");
  await flush();
  assert.equal(f.calls, 2);
  stop();
  assert.equal(f.locks[1].released, true);
  f.visibility("visible");
  assert.equal(f.calls, 2);
});

test("handles an OS rejection and release without hammering the API", async () => {
  let denied = true;
  const f = fixture(async () => {
    if (denied) throw new Error("NotAllowedError");
    return new Lock();
  });
  const stop = keepScreenAwake(f.target);
  await flush();
  assert.equal(f.timers.size, 1);
  denied = false;
  f.retry();
  await flush();
  await f.locks[0].release();
  assert.equal(f.timers.size, 1);
  f.target.dispatchEvent(new Event("pagehide"));
  assert.equal(f.timers.size, 0);
  f.target.dispatchEvent(new Event("pageshow"));
  await flush();
  assert.equal(f.calls, 3);
  stop();
});

test("releases an in-flight grant after the room closes", async () => {
  let resolve;
  const f = fixture(() => new Promise((grant) => { resolve = grant; }));
  const stop = keepScreenAwake(f.target);
  stop();
  const late = new Lock();
  resolve(late);
  await flush();
  assert.equal(late.released, true);
  assert.equal(f.timers.size, 0);
});

test("works independently for an external player and tolerates unsupported browsers", async () => {
  const main = fixture();
  const external = fixture();
  main.visibility("hidden");
  const stopMain = keepScreenAwake(main.target);
  const stopExternal = keepScreenAwake(external.target);
  await flush();
  assert.equal(main.calls, 0);
  assert.equal(external.calls, 1);
  stopMain();
  stopExternal();
  assert.equal(external.locks[0].released, true);
  assert.doesNotThrow(() => keepScreenAwake({ document: {}, navigator: {} })());
});
