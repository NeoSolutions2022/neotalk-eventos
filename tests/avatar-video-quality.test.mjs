import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../app/avatarVideoQuality.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { avatarCaptureConstraints, avatarRecorderOptions, captureDetails, videoFramePresets, videoQualityPresets } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

test("frame presets use native social video aspect ratios", () => {
  assert.equal(videoFramePresets.landscape.ratio, 16 / 9);
  assert.equal(videoFramePresets.shorts.ratio, 9 / 16);
  assert.equal(videoFramePresets.square.ratio, 1);
  assert.equal(videoFramePresets.portrait.ratio, 4 / 5);
});

test("quality presets explicitly control compression and desired frame rate", () => {
  assert.deepEqual(Object.values(videoQualityPresets).map((p) => p.bitrate), [2500000, 8000000, 16000000]);
  for (const quality of Object.keys(videoQualityPresets)) {
    const constraints = avatarCaptureConstraints(quality);
    assert.equal(constraints.displaySurface, "browser");
    assert.equal(constraints.frameRate.ideal, videoQualityPresets[quality].fps);
    assert.equal(constraints.frameRate.max, videoQualityPresets[quality].fps);
    assert.equal(constraints.width.exact, undefined);
    assert.equal(constraints.width.ideal, 3840);
    assert.equal(avatarRecorderOptions(quality, "video/webm").videoBitsPerSecond, videoQualityPresets[quality].bitrate);
    assert.equal(avatarRecorderOptions(quality, "video/webm").mimeType, "video/webm");
  }
});

test("reports actual track settings rather than pretending the crop is full HD", () => {
  assert.equal(captureDetails({ width: 620, height: 426, frameRate: 29.97 }, 8000000), "620 × 426 · 30 fps · 8 Mbps");
  assert.equal(captureDetails({}, 2500000), "Resolução do navegador · 2,5 Mbps");
});
