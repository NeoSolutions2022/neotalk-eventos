import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const available = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8', timeout: 15000 });
const skip = available.status !== 0 ? 'Docker Compose CLI is needed; no daemon or API calls are used' : false;
function config(extraEnv = {}) {
  // Override real values even when the operator has a private .env file.
  const result = spawnSync('docker', ['compose', '--env-file', '.env.example', '-f', 'compose.homolog.yaml', 'config', '--format', 'json'], {
    cwd, encoding: 'utf8', timeout: 15000,
    env: { ...process.env, NEOTALK_API_KEY: 'fixture-neotalk', OPENAI_API_KEY: 'fixture-openai', HOMOLOG_ADMIN_PASSWORD: 'fixture-password', ...extraEnv },
  });
  return result;
}
function parsed() {
  const result = config();
  assert.equal(result.status, 0, 'Compose must accept the local config (details suppressed to protect environment)');
  return JSON.parse(result.stdout);
}

test('homologation isolates storage, network bindings and production configuration', { skip }, () => {
  const model = parsed();
  assert.equal(model.name, 'neotalk-homolog-observability');
  assert.equal(model.services.postgres.ports, undefined);
  assert.equal(model.services.postgres.environment.POSTGRES_DB, 'neotalk_homolog');
  for (const [name, service] of Object.entries(model.services)) {
    assert.equal(service.container_name, undefined, name);
    for (const port of service.ports || []) assert.equal(port.host_ip, '127.0.0.1', name);
    for (const volume of service.volumes || []) {
      assert.equal(volume.type, 'volume', name);
      assert.match(volume.source, /^homolog_(postgres|avatar)$/);
    }
  }
  assert.match(model.services.api.environment.DATABASE_URL, /@postgres:5432\/neotalk_homolog$/);
  assert.equal(model.services.api.environment.CORS_ORIGINS, 'http://localhost:3310');
  assert.equal(model.services.api.environment.SESSION_COOKIE_NAME, 'neotalk_homolog_session');
  assert.equal(model.services.platform.environment.INTERNAL_API_URL, 'http://api:8000/api/v1');
  assert.equal(model.services.platform.build.args.NEXT_PUBLIC_AVATAR_WIDGET_URL, 'http://localhost:38080/widget');
  assert.equal(model.services.platform.build.args.NEXT_PUBLIC_API_URL, '/api/v1');
  assert.equal(model.services.platform.environment.OPENAI_API_KEY, undefined);
  assert.equal(model.services.avatar.environment.OPENAI_API_KEY, undefined);
});

test('missing integration credentials prevent accidental partially configured runs', { skip }, () => {
  for (const key of ['OPENAI_API_KEY', 'NEOTALK_API_KEY', 'HOMOLOG_ADMIN_PASSWORD']) {
    assert.notEqual(config({ [key]: '' }).status, 0, `${key} must be required`);
  }
});
