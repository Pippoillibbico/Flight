import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

async function waitForHealth(baseUrl, { retries = 80, intervalMs = 250, child, getLogs } = {}) {
  for (let i = 0; i < retries; i += 1) {
    if (child && child.exitCode !== null) {
      const logs = typeof getLogs === 'function' ? getLogs() : '';
      throw new Error(`Server exited before healthcheck. exitCode=${child.exitCode}\n${logs}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return response;
    } catch {}
    await delay(intervalMs);
  }
  const logs = typeof getLogs === 'function' ? getLogs() : '';
  throw new Error(`Server did not become healthy in time.\n${logs}`);
}

async function getFreeLocalPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : null;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  assert.ok(port, 'test helper must allocate a local port');
  return port;
}

test('smoke /api/health returns ok', async () => {
  const port = await getFreeLocalPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let stdout = '';
  let stderr = '';
  let child;
  try {
    child = spawn(process.execPath, ['server/index.js'], {
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PORT: String(port),
        JWT_SECRET: process.env.JWT_SECRET || '12345678901234567890123456789012',
        REDIS_URL: '',
        DATABASE_URL: ''
      },
      stdio: 'pipe',
      windowsHide: true
    });
  } catch (error) {
    throw new Error(`Unable to spawn health smoke server: ${error?.message || error}`);
  }
  child.stdout.on('data', (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });
  const getLogs = () => {
    const out = stdout.trim();
    const err = stderr.trim();
    if (!out && !err) return 'No server logs captured.';
    return [`[stdout]\n${out}`, `[stderr]\n${err}`].join('\n');
  };

  try {
    const response = await waitForHealth(baseUrl, { child, getLogs });
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.service, undefined);
    assert.match(response.headers.get('cache-control') || '', /no-store/);
    assert.equal(response.headers.get('x-powered-by'), null);
  } finally {
    child.kill('SIGTERM');
    await delay(200);
  }
}, 60000);
