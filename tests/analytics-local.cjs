// Interactive QA fixture server, localhost only, with its own disposable PostgreSQL.
// No production database, CRM, external API keys or real visitor records.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { randomBytes, randomUUID } = require("node:crypto");
const root = path.resolve(__dirname, "..");
const pg = process.env.POSTGRES_BIN, python = process.env.PYTHON_BIN;
if (!pg || !python) throw Error("Set POSTGRES_BIN and PYTHON_BIN");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nt-landing-qa-"));
const cluster = path.join(dir, "data"), secret = randomBytes(24).toString("hex");
const password = "qa-local-only-" + randomBytes(16).toString("hex");
const children = [];
let started = false;
function run(exe, args, options = {}) {
  const r = spawnSync(exe, args, { cwd: root, windowsHide: true, encoding: "utf8", timeout: 120000, ...options });
  if (r.status !== 0) throw Error(`${path.basename(exe)}: ${r.stderr || r.stdout}`);
}
function start(exe, args, cwd, env) {
  const p = spawn(exe, args, { cwd, windowsHide: true, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  children.push(p); p.stdout.on("data", d => process.stdout.write(d)); p.stderr.on("data", d => process.stderr.write(d));
}
async function wait(url) {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(url)).ok) return; } catch {} await new Promise(r => setTimeout(r, 200)); }
  throw Error("Local QA service did not become ready: " + url);
}
async function main() {
  const pw = path.join(dir, "password.local"); fs.writeFileSync(pw, secret, { mode: 0o600 });
  try {
    run(path.join(pg, "initdb.exe"), ["-D", cluster, "-U", "analytics_qa", "-A", "scram-sha-256", "--pwfile=" + pw, "-E", "UTF8", "--locale=C"]);
    run(path.join(pg, "pg_ctl.exe"), ["-D", cluster, "-w", "-l", path.join(dir, "postgres.log"), "-o", "-h 127.0.0.1 -p 55489 -c shared_buffers=32MB -c max_connections=20", "start"], { stdio: "ignore" });
    started = true;
    const api = "http://127.0.0.1:8098", app = "http://127.0.0.1:5188";
    start(python, ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8098"], path.join(root, "backend"), { DATABASE_URL: `postgresql://analytics_qa:${secret}@127.0.0.1:55489/postgres`, ADMIN_BOOTSTRAP_EMAIL: "qa-admin@example.invalid", ADMIN_BOOTSTRAP_PASSWORD: password, ADMIN_BOOTSTRAP_NAME: "QA LOCAL · DADOS SINTÉTICOS", SESSION_COOKIE_SECURE: "false", SESSION_COOKIE_NAME: "nt_landing_qa", PUBLIC_ACCESS_MODE: "password", CORS_ORIGINS: app, ANALYTICS_FORM_ORIGINS: "http://127.0.0.1:5187", OPENAI_API_KEY: "", NEOTALK_API_KEY: "" });
    await wait(api + "/api/v1/health");
    const login = await fetch(api + "/api/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "qa-admin@example.invalid", password }) });
    if (!login.ok) throw Error("Local QA admin login failed");
    const user = await login.json(), cookie = login.headers.get("set-cookie").split(";")[0];
    const groups = Object.fromEntries(["funnel", "engagement", "heatmap", "errors", "attribution"].map(g => [g, true]));
    const cfg = await fetch(api + "/api/v1/admin/analytics/settings", { method: "PUT", headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": user.csrf_token }, body: JSON.stringify({ enabled: true, groups, sources: { access: true, landing: true } }) });
    if (!cfg.ok) throw Error("Local QA settings failed");
    for (let i = 0; i < 3; i++) {
      const events = [["landing_view", "page", {}], ["section_view", "hero", {}], ["section_view", "pricing", {}], ["heat_click", "hero", { x: 10, y: 10 }], ["active_time", "hero", { active_ms: 12000 }], ["scroll_depth", "hero", { depth: 100 }], ["cta_click", "hero", { cta: "hero_start", target: "access" }], ["faq_open", "faq", { faq: "faq_1" }], ["pricing_change", "pricing", { plan: "pro", hours: 25, billing: "annual" }]];
      const r = await fetch(api + "/api/v1/analytics/events", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:5187" }, body: JSON.stringify({ schema: 1, release: "landing-analytics-v1", visitor: randomUUID(), session: randomUUID(), consent: groups, device: "desktop", language: "pt", campaign: { utm_source: "qa_local_synthetic" }, events: events.map(([name, step, props]) => ({ id: randomUUID(), at: Date.now(), name, step, props, device: "desktop" })) }) });
      if (!r.ok) throw Error("Local synthetic ingestion failed");
    }
    start(process.execPath, [path.join(root, "node_modules/vinext/dist/cli.js"), "start", "--hostname", "127.0.0.1", "--port", "5188"], root, { INTERNAL_API_URL: api + "/api/v1", WRANGLER_SEND_METRICS: "false" });
    await wait(app + "/login");
    console.log(JSON.stringify({ qa: "LOCAL SYNTHETIC DATA ONLY", app, email: "qa-admin@example.invalid", password }));
    await new Promise(resolve => { process.once("SIGINT", resolve); process.once("SIGTERM", resolve); });
  } finally {
    for (const child of children) child.kill();
    if (started) run(path.join(pg, "pg_ctl.exe"), ["-D", cluster, "-w", "-m", "fast", "stop"]);
  }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
