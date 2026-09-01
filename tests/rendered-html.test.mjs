import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the NeoTalk live rooms product", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /NeoTalk Eventos/);
  assert.match(html, /Salas ao vivo/);
  assert.match(html, /Criar sala ao vivo/);
  assert.match(html, /Microfone em tempo real/);
  assert.match(html, /Lia 3D integrada/);
  assert.doesNotMatch(html, /Your site is taking shape|Building your site/);
});

test("keeps live capture, agent, quality lab, persistence and Docker services connected", async () => {
  const [liveRoom, quality, rooms, compose, api, services] = await Promise.all([
    readFile(new URL("../app/LiveRoom.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/QualityAdmin.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/Rooms.tsx", import.meta.url), "utf8"),
    readFile(new URL("../compose.yaml", import.meta.url), "utf8"),
    readFile(new URL("../backend/app/main.py", import.meta.url), "utf8"),
    readFile(new URL("../backend/app/services.py", import.meta.url), "utf8"),
  ]);

  assert.match(liveRoom, /webkitSpeechRecognition/);
  assert.match(liveRoom, /getUserMedia\(\{ audio: true \}\)/);
  assert.match(liveRoom, /stageRef\.current\?\.requestFullscreen\(\)/);
  assert.match(liveRoom, /className="live-captions"/);
  assert.match(liveRoom, /LIVE_BATCH_SILENCE_MS = 650/);
  assert.match(liveRoom, /LIVE_AGENT_CONCURRENCY = 2/);
  assert.match(liveRoom, /infra-avatar3d-oficial\.k3p3ex\.easypanel\.host\/widget/);
  assert.match(liveRoom, /\/rooms\/\$\{roomId\}\/batches/);
  assert.match(liveRoom, /\/agent\/translate/);
  assert.match(liveRoom, /agent\.gloss_text/);
  assert.match(liveRoom, /option value="elia">Elia · NeoTalk/);
  assert.match(quality, /\/admin\/quality-runs/);
  assert.match(quality, /neotalk:sign/);
  assert.match(rooms, /fetch\(`\$\{apiBase\}\/rooms`\)/);
  assert.match(compose, /postgres:16-alpine/);
  assert.match(compose, /container_name: neotalk-api/);
  assert.match(api, /@app\.post\("\/api\/v1\/rooms"/);
  assert.match(api, /@app\.patch\("\/api\/v1\/batches\/\{batch_id\}"/);
  assert.match(api, /@app\.post\("\/api\/v1\/admin\/quality-runs"/);
  assert.match(api, /@app\.post\("\/api\/v1\/admin\/dataset\/sync"/);
  assert.match(services, /OPENAI_BASE_URL.*api\.openai\.com\/v1/);
  assert.match(services, /prompt_cache_key/);
  assert.match(services, /AGENT_CONTEXT_CACHE_TTL_SECONDS/);
  assert.match(services, /NEOTALK_VIDEO_SUBMIT_PATH/);
});
