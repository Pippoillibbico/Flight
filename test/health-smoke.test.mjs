import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
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

test('smoke /api/health returns ok', async () => {
  const port = 3200 + Math.floor(Math.random() * 200);
  const baseUrl = `http://127.0.0.1:${port}`;
  let stdout = '';
  let stderr = '';
  const child = spawn(process.execPath, ['server/index.js'], {
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
  } finally {
    child.kill('SIGTERM');
    await delay(200);
  }
}, 60000);
