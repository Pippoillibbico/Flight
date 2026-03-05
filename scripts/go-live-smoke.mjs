import { setTimeout as delay } from 'node:timers/promises';

const BASE_URL = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3000';

async function getJson(path) {
  const res = await fetch(`${BASE_URL}${path}`);
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

async function waitFor(path, attempts = 30) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(`${BASE_URL}${path}`);
      if (res.ok) return true;
    } catch {}
    await delay(400);
  }
  return false;
}

async function run() {
  const up = await waitFor('/health');
  if (!up) throw new Error(`Server not healthy at ${BASE_URL}`);

  const checks = [
    ['/health', 'core_health'],
    ['/health/db', 'db_health'],
    ['/health/engine', 'engine_health'],
    ['/api/health', 'api_health'],
    ['/api/health/security', 'security_health']
  ];

  const results = [];
  for (const [path, name] of checks) {
    const result = await getJson(path);
    results.push({ name, path, ...result });
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error('go-live-smoke: FAIL');
    for (const row of failed) {
      console.error(`- ${row.name} ${row.path}: status=${row.status}`);
    }
    process.exit(1);
  }

  console.log('go-live-smoke: PASS');
  for (const row of results) {
    console.log(`- ${row.name} ${row.path}: status=${row.status}`);
  }
}

run().catch((error) => {
  console.error('go-live-smoke: ERROR', error?.message || error);
  process.exit(1);
});
