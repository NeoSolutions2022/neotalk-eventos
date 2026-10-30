// Own isolated PostgreSQL cluster. Never connects to the user's existing database/service.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const net = require("node:net");
async function main() {
  const root = path.resolve(__dirname, "..");
  const pg = process.env.POSTGRES_BIN;
  if (!pg)
    throw Error("Set POSTGRES_BIN to an installed PostgreSQL bin directory");
  const python = process.env.PYTHON_BIN;
  if (!python) throw Error("Set PYTHON_BIN to the backend test interpreter");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nt-analytics-pg-"));
  const secret = randomBytes(24).toString("hex");
  const pw = path.join(dir, "password.local");
  fs.writeFileSync(pw, secret, { mode: 0o600 });
  const cluster = path.join(dir, "data");
  const log = path.join(dir, "postgres.log");
  const port = await new Promise((r) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const p = server.address().port;
      server.close(() => r(p));
    });
  });
  function run(exe, args, options = {}) {
    const result = spawnSync(exe, args, {
      cwd: root,
      windowsHide: true,
      encoding: "utf8",
      timeout: 180000,
      ...options,
    });
    if (result.status !== 0)
      throw Error(
        `${path.basename(exe)} failed: ${result.stdout || ""} ${result.stderr || ""}`,
      );
    return result;
  }
  const pgctl = path.join(pg, "pg_ctl.exe");
  let started = false;
  try {
    run(path.join(pg, "initdb.exe"), [
      "-D",
      cluster,
      "-U",
      "analytics_qa",
      "-A",
      "scram-sha-256",
      "--pwfile=" + pw,
      "-E",
      "UTF8",
      "--locale=C",
    ]);
    run(
      pgctl,
      [
        "-D",
        cluster,
        "-w",
        "-l",
        log,
        "-o",
        `-h 127.0.0.1 -p ${port} -c shared_buffers=32MB -c max_connections=20`,
        "start",
      ],
      { stdio: "ignore", timeout: 60000 },
    );
    started = true;
    const url = `postgresql://analytics_qa:${secret}@127.0.0.1:${port}/postgres`;
    const result = run(
      python,
      [
        "-m",
        "unittest",
        "discover",
        "-s",
        "tests",
        "-p",
        process.argv.includes("--dataset-gaps") ? "test_dataset_gaps_postgres.py" : "test_analytics_postgres.py",
        "-v",
      ],
      {
        cwd: path.join(root, "backend"),
        env: {
          ...process.env,
          DATABASE_URL: url,
          ANALYTICS_TEST_DATABASE_URL: url,
          ANALYTICS_TEST_LOCAL_ONLY: "1",
          ADMIN_BOOTSTRAP_EMAIL: "",
          ADMIN_BOOTSTRAP_PASSWORD: "",
          OPENAI_API_KEY: "",
          NEOTALK_API_KEY: "",
          ANALYTICS_FORM_ORIGINS: "https://neotalk.app",
          CORS_ORIGINS: "http://localhost:3000",
        },
      },
    );
    console.log(result.stdout);
    console.log(result.stderr);
    console.log(
      "PostgreSQL integration passed. Production database untouched.",
    );
    if (process.argv.includes("--browser")) {
      const { runBrowser } = await import("./analytics-browser.mjs");
      await runBrowser({ root, python, databaseUrl: url });
    }
  } finally {
    if (started) run(pgctl, ["-D", cluster, "-w", "-m", "fast", "stop"]);
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
