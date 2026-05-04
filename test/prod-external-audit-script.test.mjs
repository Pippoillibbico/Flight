import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

function runExternalAudit(envPatch = {}) {
  const env = { ...process.env, ...envPatch };
  if (envPatch.PROD_BASE_URL === undefined) delete env.PROD_BASE_URL;
  return spawnSync(process.execPath, ['scripts/prod-external-audit.mjs'], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8'
  });
}

test('prod external audit fails clearly when PROD_BASE_URL is missing', () => {
  const result = runExternalAudit();
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /\[prod-external-audit\] failed/);
  assert.match(output, /PROD_BASE_URL is required/);
  assert.match(output, /PROD_BASE_URL=https:\/\/<domain> npm run test:prod:external/);
});

test('prod external audit rejects non-HTTPS PROD_BASE_URL before network checks', () => {
  const result = runExternalAudit({ PROD_BASE_URL: 'http://example.com' });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /PROD_BASE_URL must use https/);
});
