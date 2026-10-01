import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../app/liveTiming.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const timing = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

test("advances shortly after the last pose frame, without cutting it", () => {
  assert.equal(timing.playbackDurationMs({ frame_count: 90, fps: 30 }, 2), 3080);
  assert.equal(timing.playbackDurationMs({ frame_count: 89, fps: 30 }, 2), 3047);
});

test("keeps a conservative fallback when the widget omits frame timing", () => {
  assert.equal(timing.playbackDurationMs(undefined, 1), 3500);
  assert.equal(timing.playbackDurationMs({ frame_count: 90, fps: 0 }, 4), 5200);
});

test("shortens only the handoff buffers", () => {
  assert.ok(timing.LIVE_BATCH_PUNCTUATION_MS < timing.LIVE_BATCH_SILENCE_MS);
  assert.ok(timing.LIVE_BATCH_SILENCE_MS <= 350);
  assert.ok(timing.LIVE_IDLE_LOOP_GAP_MS <= 150);
});
