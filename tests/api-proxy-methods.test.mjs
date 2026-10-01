import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../app/api/v1/[...path]/route.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { PUT } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

test("forwards QA audio PUT body, query and CSRF token to the internal API", async () => {
  const previousFetch = globalThis.fetch;
  let upstream;
  globalThis.fetch = async (url, options) => {
    upstream = { url: String(url), options };
    return new Response(JSON.stringify({ has_audio: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const bytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]);
    const request = new Request("https://plataforma.neotalk.app/api/v1/admin/quality-runs/run-1/ratings/comparison/audio?duration_ms=1234", {
      method: "PUT",
      headers: {
        "content-type": "audio/webm",
        "x-csrf-token": "test-csrf",
        cookie: "neotalk_session=test-cookie",
      },
      body: bytes,
    });
    const result = await PUT(request, { params: Promise.resolve({ path: ["admin", "quality-runs", "run-1", "ratings", "comparison", "audio"] }) });
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { has_audio: true });
    assert.equal(upstream.options.method, "PUT");
    assert.equal(new URL(upstream.url).searchParams.get("duration_ms"), "1234");
    assert.equal(upstream.options.headers.get("x-csrf-token"), "test-csrf");
    assert.equal(upstream.options.headers.get("cookie"), "neotalk_session=test-cookie");
    assert.deepEqual([...new Uint8Array(upstream.options.body)], [...bytes]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
