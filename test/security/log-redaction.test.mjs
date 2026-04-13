import assert from 'node:assert/strict';
import test from 'node:test';

import { redactUrlForLogs, sanitizeHeaderLikeValue } from '../../server/lib/log-redaction.js';

test('redactUrlForLogs hides sensitive query values', () => {
  const output = redactUrlForLogs('/api/auth/callback?code=secret&state=opaque&next=/dashboard');
  assert.equal(output.includes('code=%5BREDACTED%5D'), true);
  assert.equal(output.includes('state=%5BREDACTED%5D'), true);
  assert.equal(output.includes('next=%2Fdashboard'), true);
});

test('redactUrlForLogs keeps origin only when requested', () => {
  const output = redactUrlForLogs('https://app.example.test/path?token=abc&region=eu', { preserveOrigin: true });
  assert.equal(output.startsWith('https://app.example.test/path'), true);
  assert.equal(output.includes('token=%5BREDACTED%5D'), true);
});

test('sanitizeHeaderLikeValue strips control characters and bounds size', () => {
  const output = sanitizeHeaderLikeValue('Mozilla\u0000\nTest-Agent', { maxLength: 20 });
  assert.equal(output.includes('\u0000'), false);
  assert.equal(output.includes('\n'), false);
  assert.equal(output.length <= 20, true);
});
