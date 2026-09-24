import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the authenticated NeoTalk shell without leaking protected content", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /NeoTalk Eventos/);
  assert.match(html, /Preparando sua plataforma/);
  assert.doesNotMatch(html, /Congresso Inova 2026/);
  assert.doesNotMatch(html, /Your site is taking shape|Building your site/);
});

test("serves every primary product route directly", async () => {
  const routes = ["/dashboard", "/salas", "/salas/ao-vivo", "/uso", "/pagamento", "/qualidade", "/login", "/cadastro", "/acesso", "/conta", "/videos", "/plugins"];
  for (const route of routes) {
    const response = await render(route);
    assert.equal(response.status, 200, route);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i, route);
  }
});

test("keeps live capture, agent, quality lab, persistence and Docker services connected", async () => {
  const [liveRoom, quality, rooms, compose, api, services, avatarMessages, apiClient, auth, proxy, externalPlayerRelay] = await Promise.all([
    readFile(new URL("../app/LiveRoom.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/QualityAdmin.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/Rooms.tsx", import.meta.url), "utf8"),
    readFile(new URL("../compose.yaml", import.meta.url), "utf8"),
    readFile(new URL("../backend/app/main.py", import.meta.url), "utf8"),
    readFile(new URL("../backend/app/services.py", import.meta.url), "utf8"),
    readFile(new URL("../app/avatarMessages.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/apiClient.ts", import.meta.url), "utf8"),
    readFile(new URL("../backend/app/auth.py", import.meta.url), "utf8"),
    readFile(new URL("../app/api/v1/[...path]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../public/external-player-relay.js", import.meta.url), "utf8"),
  ]);

  assert.match(liveRoom, /webkitSpeechRecognition/);
  assert.match(liveRoom, /getUserMedia\(\{ audio: true \}\)/);
  assert.match(liveRoom, /stageRef\.current\?\.requestFullscreen\(\)/);
  assert.match(liveRoom, /className="live-captions"/);
  assert.match(liveRoom, /window\.location\.href = "\/salas"/);
  assert.match(liveRoom, /LIVE_BATCH_SILENCE_MS = 650/);
  assert.match(liveRoom, /LIVE_AGENT_CONCURRENCY = 2/);
  assert.match(liveRoom, /LIVE_IDLE_LOOP_DELAY_MS = 2200/);
  assert.match(liveRoom, /recentPhrasesRef\.current.*slice\(-2\)/);
  assert.match(liveRoom, /interruptIdleLoopForSpeech/);
  assert.match(liveRoom, /recognitionWatchdogRef/);
  assert.match(liveRoom, /recognition\.abort\(\)/);
  assert.match(liveRoom, /MediaRecorder/);
  assert.match(liveRoom, /\/agent\/transcribe/);
  assert.match(liveRoom, /\/heartbeat/);
  assert.match(liveRoom, /neotalk:replay/);
  assert.match(liveRoom, /documentPictureInPicture/);
  assert.match(liveRoom, /neotalk-live-output/);
  assert.match(liveRoom, /OBS Virtual Camera/);
  assert.match(liveRoom, /mountStageInWindow/);
  assert.match(liveRoom, /avatarMessageHandlerRef/);
  assert.match(liveRoom, /targetWindow\.addEventListener\("message", messageHandler\)/);
  assert.match(liveRoom, /neotalk:external-player-command/);
  assert.match(liveRoom, /external-player-relay\.js/);
  assert.match(liveRoom, /externalFrameRef/);
  assert.match(liveRoom, /outputStage\.append\(outputFrame, brand, caption, language\)/);
  assert.doesNotMatch(liveRoom, /shell\.appendChild\(stage\)/);
  assert.doesNotMatch(liveRoom, /Formato do player/);
  assert.match(externalPlayerRelay, /frame\.contentWindow\.postMessage/);
  assert.match(liveRoom, /retryTransientApi/);
  assert.match(liveRoom, /agent\.skipped/);
  assert.doesNotMatch(liveRoom, /avatarError && <div className="avatar-error"/);
  assert.match(liveRoom, /LIVE_AVATAR_MAX_RETRIES = 2/);
  assert.match(liveRoom, /LIVE_AVATAR_PROCESSING_TIMEOUT_MS = 60000/);
  assert.match(liveRoom, /scheduleAvatarProcessingWatchdog/);
  assert.match(liveRoom, /Reiniciando o renderizador/);
  assert.match(liveRoom, /avatarCommandAcknowledgedRef/);
  assert.match(liveRoom, /else scheduleAvatarRetry\(\)/);
  assert.match(liveRoom, /toggleMicrophone/);
  assert.match(liveRoom, /track\.onended/);
  assert.match(liveRoom, /recorder\.onerror/);
  assert.match(liveRoom, /LIVE_TRANSCRIPTION_BACKLOG = 6/);
  assert.match(liveRoom, /visibilitychange/);
  assert.match(liveRoom, /AbortSignal\.timeout\(10000\)/);
  assert.match(liveRoom, /Microfone mutado · mantendo a tradução em loop/);
  assert.match(liveRoom, /--stage-zoom/);
  assert.match(liveRoom, /Aumentar zoom/);
  assert.match(liveRoom, /infra-avatar3d-oficial\.k3p3ex\.easypanel\.host\/widget/);
  assert.match(liveRoom, /\/rooms\/\$\{roomId\}\/batches/);
  assert.match(liveRoom, /\/agent\/translate/);
  assert.match(liveRoom, /agent\.gloss_text/);
  assert.match(liveRoom, /option value="elia">Elia · NeoTalk/);
  assert.match(liveRoom, /useState<AvatarId>\("elia"\)/);
  assert.match(quality, /\/admin\/quality-runs/);
  assert.match(quality, /neotalk:sign/);
  assert.match(quality, /neotalk:set-avatar/);
  assert.match(quality, /option value="asuna">Asuna/);
  assert.match(quality, /option value="elia">Elia/);
  assert.match(quality, /avatar=elia/);
  assert.match(quality, /avatarLoopTimerRef/);
  assert.match(quality, /sinalizando em loop/);
  assert.match(quality, /controls autoPlay loop/);
  assert.match(liveRoom, /isNonBlockingAvatarError/);
  assert.match(quality, /isNonBlockingAvatarError/);
  assert.match(avatarMessages, /não confirmou \(\?:o \)\?carregamento da pose/);
  assert.match(avatarMessages, /unprocessable entity/);
  assert.match(avatarMessages, /500\|502\|503\|504/);
  assert.match(rooms, /apiRequest<Room\[]>\("\/rooms"\)/);
  assert.match(apiClient, /credentials: "include"/);
  assert.match(apiClient, /X-CSRF-Token/);
  assert.match(apiClient, /API_REQUEST_TIMEOUT_MS = 60000/);
  assert.match(proxy, /\[204, 205, 304\]\.includes\(upstream\.status\)/);
  assert.match(proxy, /bodyless \? null/);
  assert.match(compose, /postgres:16-alpine/);
  assert.match(compose, /container_name: neotalk-api/);
  assert.match(api, /@app\.post\("\/api\/v1\/rooms"/);
  assert.match(api, /@app\.post\("\/api\/v1\/agent\/transcribe"/);
  assert.match(api, /"skipped": True/);
  assert.match(api, /@app\.post\("\/api\/v1\/rooms\/\{room_id\}\/heartbeat"/);
  assert.match(api, /\$4::TEXT IN \('completed','skipped'\)/);
  assert.match(api, /@app\.patch\("\/api\/v1\/batches\/\{batch_id\}"/);
  assert.match(api, /@app\.post\("\/api\/v1\/admin\/quality-runs"/);
  assert.match(api, /@app\.post\("\/api\/v1\/admin\/dataset\/sync"/);
  assert.match(api, /Depends\(admin_csrf\)/);
  assert.match(api, /Finalize sua sala atual antes de criar outra/);
  assert.match(auth, /PasswordHasher/);
  assert.match(auth, /httponly=True/);
  assert.match(auth, /token_hash/);
  assert.match(services, /OPENAI_BASE_URL.*api\.openai\.com\/v1/);
  assert.match(services, /prompt_cache_key/);
  assert.match(services, /AGENT_CONTEXT_CACHE_TTL_SECONDS/);
  assert.match(services, /NEOTALK_VIDEO_SUBMIT_PATH/);
});
