import assert from 'node:assert/strict';
import test from 'node:test';

import { getErrorCode, getHumanErrorMessage } from '../../server/middleware/error-handler.js';

test('error handler maps 413 and entity.too.large to payload_too_large', () => {
  assert.equal(getErrorCode({ code: 'entity.too.large' }, 400), 'payload_too_large');
  assert.equal(getErrorCode({}, 413), 'payload_too_large');
});

test('error handler normalizes auth/forbidden/rate-limit codes', () => {
  assert.equal(getErrorCode({ code: 'auth_required' }, 401), 'unauthorized');
  assert.equal(getErrorCode({ code: 'request_forbidden' }, 403), 'forbidden');
  assert.equal(getErrorCode({ code: 'limit_exceeded' }, 429), 'rate_limited');
  assert.equal(getErrorCode({ code: 'premium_required' }, 402), 'premium_required');
  assert.equal(getErrorCode({}, 402), 'premium_required');
});

test('error handler provides bounded human message for payload_too_large', () => {
  const message = getHumanErrorMessage('payload_too_large', '');
  assert.equal(typeof message, 'string');
  assert.equal(message.length > 0, true);
});

test('error handler provides human message for premium_required', () => {
  const message = getHumanErrorMessage('premium_required', '');
  assert.equal(typeof message, 'string');
  assert.equal(message.length > 0, true);
});

test('error handler preserves register-specific machine error codes', () => {
  assert.equal(getErrorCode({ code: 'email_already_exists' }, 409), 'email_already_exists');
  assert.equal(getErrorCode({ code: 'registration_disabled' }, 403), 'registration_disabled');
  assert.equal(getErrorCode({ code: 'service_unavailable' }, 503), 'service_unavailable');
});
