import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

async function waitForHealth(baseUrl, retries = 40) {
  for (let i = 0; i < retries; i += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return response;
    } catch {}
    await delay(250);
  }
  throw new Error('Server did not become healthy in time.');
}

test('smoke /api/health returns ok', async () => {
  const port = 3200 + Math.floor(Math.random() * 200);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server/index.js'], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      JWT_SECRET: process.env.JWT_SECRET || '12345678901234567890123456789012',
      REDIS_URL: '',
      DATABASE_URL: ''
    },
    stdio: 'pipe'
  });

  try {
    const response = await waitForHealth(baseUrl);
    const payload = await response.json();
    assert.equal(payload.ok, true);
  } finally {
    child.kill('SIGTERM');
    await delay(200);
  }
}, 30000);
