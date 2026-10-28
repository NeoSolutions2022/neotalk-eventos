import { spawn, spawnSync, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function freePort() {
  return await new Promise((r) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => r(p));
    });
  });
}
export async function runBrowser({ root, python, databaseUrl }) {
  const formRoot = process.env.ANALYTICS_FORM_ROOT;
  if (!formRoot) throw Error("Set ANALYTICS_FORM_ROOT to the form checkout");
  const { chromium } = await import(
    pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
  );
  const out =
    process.env.ANALYTICS_TEST_OUTPUT ||
    path.join(root, "outputs/analytics-qa");
  mkdirSync(out, { recursive: true });
  const formBuild = path.join(out, "form-dist");
  const [apiPort, appPort, formPort] = await Promise.all([
    freePort(),
    freePort(),
    freePort(),
  ]);
  const api = `http://127.0.0.1:${apiPort}`,
    app = `http://127.0.0.1:${appPort}`,
    form = `http://127.0.0.1:${formPort}`;
  const password = "local-only-" + randomBytes(16).toString("hex");
  let logs = "",
    browser;
  const processes = [];
  const checks = [];
  const errors = [];
  const telemetry = [];
  const check = (ok, label) => {
    if (!ok) throw Error(label);
    checks.push(label);
  };
  function start(exe, args, cwd, env) {
    const child = spawn(exe, args, {
      cwd,
      env: { ...process.env, ...env },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    processes.push(child);
    child.stdout.on("data", (b) => {
      logs += b;
    });
    child.stderr.on("data", (b) => {
      logs += b;
    });
    return child;
  }
  async function wait(url) {
    for (let i = 0; i < 120; i++) {
      try {
        const r = await fetch(url);
        if (r.ok) return;
      } catch {}
      await sleep(250);
    }
    throw Error(
      "Local service did not start: " + url + " " + logs.slice(-1500),
    );
  }
  const staticServer = http.createServer((req, res) => {
    const pathname = new URL(req.url, form).pathname;
    if (!pathname.startsWith("/acesso/")) {
      res.writeHead(404).end();
      return;
    }
    let file = path.resolve(formBuild, pathname.slice(8) || "index.html");
    if (!file.startsWith(formBuild + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    if (!existsSync(file)) file = path.join(formBuild, "index.html");
    const ext = path.extname(file);
    res.setHeader(
      "Content-Type",
      {
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".html": "text/html",
      }[ext] || "application/octet-stream",
    );
    res.end(readFileSync(file));
  });
  try {
    const build = spawnSync(
      process.execPath,
      [
        path.join(formRoot, "node_modules/vite/bin/vite.js"),
        "build",
        "--outDir",
        formBuild,
      ],
      {
        cwd: formRoot,
        env: { ...process.env, VITE_ANALYTICS_API_URL: api + "/api/v1" },
        windowsHide: true,
        encoding: "utf8",
        timeout: 120000,
      },
    );
    if (build.status !== 0)
      throw Error("Test form build failed: " + build.stderr);
    const env = {
      DATABASE_URL: databaseUrl,
      ANALYTICS_FORM_ORIGINS: form,
      CORS_ORIGINS: app,
      ADMIN_BOOTSTRAP_EMAIL: "analytics-admin@example.invalid",
      ADMIN_BOOTSTRAP_PASSWORD: password,
      SESSION_COOKIE_SECURE: "false",
      PUBLIC_ACCESS_MODE: "quick",
      OPENAI_API_KEY: "",
      NEOTALK_API_KEY: "",
    };
    start(
      python,
      [
        "-m",
        "uvicorn",
        "app.main:app",
        "--host",
        "127.0.0.1",
        "--port",
        String(apiPort),
      ],
      path.join(root, "backend"),
      env,
    );
    await wait(api + "/api/v1/health");
    start(
      process.execPath,
      [
        path.join(root, "node_modules/vinext/dist/cli.js"),
        "dev",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(appPort),
      ],
      root,
      {
        NEXT_PUBLIC_API_URL: api + "/api/v1",
        INTERNAL_API_URL: api + "/api/v1",
        WRANGLER_SEND_METRICS: "false",
      },
    );
    await wait(app + "/login");
    await new Promise((r) => staticServer.listen(formPort, "127.0.0.1", r));
    browser = await chromium.launch({ channel: "msedge", headless: true });
    const admin = await browser.newContext({
      viewport: { width: 1500, height: 1080 },
    });
    const login = await admin.request.post(api + "/api/v1/auth/login", {
      data: { email: "analytics-admin@example.invalid", password },
    });
    check(login.status() === 200, "existing platform admin login works");
    const user = await login.json();
    const setting = {
      enabled: true,
      groups: {
        funnel: true,
        engagement: true,
        heatmap: true,
        errors: true,
        attribution: true,
      },
    };
    check(
      (
        await admin.request.put(api + "/api/v1/admin/analytics/settings", {
          data: setting,
          headers: { "X-CSRF-Token": user.csrf_token },
        })
      ).status() === 200,
      "existing platform CSRF allows analytics settings",
    );
    // The DB is owned by this harness; clear only its analytics fixtures after the API tests.
    const cleanup = spawnSync(
      python,
      [
        "-c",
        'import asyncio, asyncpg, os\nasync def clear():\n c=await asyncpg.connect(os.environ["DATABASE_URL"])\n await c.execute("TRUNCATE analytics_events,analytics_rate_limits")\n await c.close()\nasyncio.run(clear())',
      ],
      {
        env: { ...process.env, DATABASE_URL: databaseUrl },
        windowsHide: true,
        encoding: "utf8",
      },
    );
    if (cleanup.status !== 0) throw Error("Fixture reset failed");
    const page = await admin.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(app + "/analytics");
    await page
      .getByRole("heading", {
        name: "Do interesse ao próximo passo.",
        exact: true,
      })
      .waitFor({ timeout: 60000 });
    await page
      .getByRole("button", {
        name: "Salvar preferências de coleta",
        exact: true,
      })
      .waitFor();
    check(
      await page
        .getByRole("link", { name: "Analytics", exact: true })
        .isVisible(),
      "analytics is integrated in platform admin navigation",
    );
    async function journey(accept = true, failOnce = false) {
      const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
      });
      let saves = 0;
      await ctx.route("**/*", async (route) => {
        const req = route.request(),
          url = req.url();
        if (
          url.startsWith(api + "/api/v1/analytics/events") &&
          req.method() === "POST"
        )
          telemetry.push(JSON.parse(req.postData()));
        if (url.includes("/webhook/neotalk-leads-crm")) {
          saves++;
          await route.fulfill({
            status: failOnce && saves === 1 ? 503 : 200,
            contentType: "application/json",
            body: '{"ok":true}',
          });
          return;
        }
        if (url === "https://plataforma.neotalk.app/api/v1/auth/lead-access") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: '{"status":"created","code":"TEST_TICKET"}',
          });
          return;
        }
        if (url.startsWith("https://plataforma.neotalk.app/acesso?")) {
          await route.fulfill({
            status: 200,
            contentType: "text/html",
            body: "<h1>Destino simulado</h1>",
          });
          return;
        }
        if (
          url.startsWith(form) ||
          url.startsWith(api) ||
          url.startsWith("https://neotalk.lovable.app/__l5e/")
        ) {
          await route.continue();
          return;
        }
        await route.fulfill({ status: 204, body: "" });
      });
      const p = await ctx.newPage();
      p.on("pageerror", (e) => errors.push(e.message));
      await p.goto(
        form +
          "/acesso/?utm_source=qa_event&nome=DO_NOT_CAPTURE&code=DO_NOT_CAPTURE",
      );
      await p
        .getByRole("button", { name: "Aceitar métricas", exact: true })
        .waitFor();
      await p
        .getByRole("button", {
          name: accept ? "Aceitar métricas" : "Recusar opcionais",
          exact: true,
        })
        .click();
      await p
        .getByRole("button", { name: "Criar conteúdos", exact: true })
        .click();
      await p.getByRole("button", { name: "Vídeos", exact: true }).click();
      await p.getByRole("button", { name: "Continuar", exact: true }).click();
      await p.getByRole("button", { name: "Até 5 horas", exact: true }).click();
      await p
        .getByRole("button", { name: "Nos próximos 30 dias", exact: true })
        .click();
      await p.getByLabel("Nome", { exact: true }).fill("Pessoa QA sintética");
      await p.getByLabel("E-mail", { exact: true }).fill("qa@example.invalid");
      await p.getByLabel("WhatsApp", { exact: true }).fill("11900000000");
      await p
        .getByRole("button", {
          name: "Continuar para a plataforma",
          exact: true,
        })
        .click();
      if (failOnce) {
        await p
          .getByRole("button", { name: "Tentar novamente", exact: true })
          .click();
      }
      await p.waitForURL(
        "https://plataforma.neotalk.app/acesso?code=TEST_TICKET",
      );
      await sleep(500);
      check(
        saves === (failOnce ? 2 : 1),
        "CRM flow preserved without migration",
      );
      await ctx.close();
    }
    await journey(false);
    for (let i = 0; i < 3; i++) await journey(true);
    const response = await admin.request.get(
      api + "/api/v1/admin/analytics/report",
    );
    const report = await response.json();
    check(
      report.events.find((e) => e.name === "lead_submit_accepted")?.sessions ===
        3,
      "three browser journeys stored in platform PostgreSQL",
    );
    check(
      report.heatmap.length > 0,
      "real form clicks produce heatmap in platform database",
    );
    check(
      !JSON.stringify(telemetry).includes("qa@example.invalid") &&
        !JSON.stringify(telemetry).includes("TEST_TICKET") &&
        !JSON.stringify(telemetry).includes("DO_NOT_CAPTURE"),
      "no CRM contact or login ticket enters analytics",
    );
    await page.getByRole("button", { name: "Atualizar", exact: true }).click();
    await page.getByText("3", { exact: true }).first().waitFor();
    await page
      .locator(".ana-scope")
      .evaluate((e) => e.prepend("HOMOLOGAÇÃO LOCAL · DADOS SINTÉTICOS — "));
    await page.screenshot({
      path: path.join(out, "platform-analytics-overview.png"),
    });
    await page.screenshot({
      path: path.join(out, "platform-analytics-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: path.join(out, "platform-analytics-mobile.png"),
      fullPage: true,
    });
    check(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "platform analytics fits mobile width",
    );
    await page
      .getByRole("checkbox", { name: "Mapa de calor", exact: true })
      .uncheck();
    await page
      .getByRole("button", {
        name: "Salvar preferências de coleta",
        exact: true,
      })
      .click();
    await page
      .getByText("Preferências de coleta salvas.", { exact: false })
      .waitFor();
    check(
      (
        await (
          await admin.request.get(api + "/api/v1/admin/analytics/settings")
        ).json()
      ).groups.heatmap === false,
      "admin UI toggles settings in existing database",
    );
    await journey(true, true);
    const guest = await browser.newContext();
    await guest.request.post(api + "/api/v1/auth/quick-access", {
      data: { name: "QA user", whatsapp_phone: "11900000000" },
    });
    const guestPage = await guest.newPage();
    await guestPage.goto(app + "/analytics");
    await guestPage.waitForURL(app + "/salas");
    check(
      (await guestPage
        .getByRole("link", { name: "Analytics", exact: true })
        .count()) === 0,
      "ordinary user cannot see analytics page or navigation",
    );
    await guest.close();
    check(errors.length === 0, "no unhandled browser errors");
    writeFileSync(
      path.join(out, "platform-browser-report.json"),
      JSON.stringify(
        {
          checks,
          scope:
            "local FastAPI + PostgreSQL + platform UI + static form; CRM/auth handoff mocked; no production mutation",
          errors,
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({ browser: "passed", checks: checks.length, out }),
    );
  } catch (error) {
    writeFileSync(
      path.join(out, "platform-browser-failure.json"),
      JSON.stringify(
        { message: error.message, checks, errors, logs: logs.slice(-5000) },
        null,
        2,
      ),
    );
    throw error;
  } finally {
    await browser?.close();
    staticServer.close();
    for (const p of processes.reverse())
      if (p.exitCode === null) {
        if (process.platform === "win32") {
          try {
            execFileSync("taskkill.exe", ["/PID", String(p.pid), "/T", "/F"], {
              windowsHide: true,
              stdio: "ignore",
            });
          } catch {}
        } else p.kill();
      }
  }
}
