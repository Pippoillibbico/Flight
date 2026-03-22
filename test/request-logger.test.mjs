import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { logger, requestLogger } from '../server/lib/logger.js';

function buildRequest({ endpoint = '/api/example', method = 'GET' } = {}) {
  return {
    id: 'req_test_1',
    method,
    originalUrl: endpoint,
    url: endpoint,
    headers: {},
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' }
  };
}

function buildResponse(statusCode) {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  return res;
}

test('requestLogger downgrades expected readiness 503 to warning', async () => {
  const events = [];
  const originalInfo = logger.info;
  const originalWarn = logger.warn;
  const originalError = logger.error;

  logger.info = (payload, msg) => events.push({ level: 'info', payload, msg });
  logger.warn = (payload, msg) => events.push({ level: 'warn', payload, msg });
  logger.error = (payload, msg) => events.push({ level: 'error', payload, msg });

  try {
    const req = buildRequest({ endpoint: '/api/health/deploy-readiness?scope=all' });
    const res = buildResponse(503);
    requestLogger(req, res, () => {});
    res.emit('finish');

    assert.equal(events.some((item) => item.level === 'error' && item.msg === 'request_failed'), false);
    const expectedWarn = events.find((item) => item.level === 'warn' && item.msg === 'request_warning_expected_5xx');
    assert.ok(expectedWarn);
    assert.equal(expectedWarn.payload?.expected_status, true);
  } finally {
    logger.info = originalInfo;
    logger.warn = originalWarn;
    logger.error = originalError;
  }
});

test('requestLogger keeps non-expected 500 as error', async () => {
  const events = [];
  const originalInfo = logger.info;
  const originalWarn = logger.warn;
  const originalError = logger.error;

  logger.info = (payload, msg) => events.push({ level: 'info', payload, msg });
  logger.warn = (payload, msg) => events.push({ level: 'warn', payload, msg });
  logger.error = (payload, msg) => events.push({ level: 'error', payload, msg });

  try {
    const req = buildRequest({ endpoint: '/api/search' });
    const res = buildResponse(500);
    requestLogger(req, res, () => {});
    res.emit('finish');

    const errorEvent = events.find((item) => item.level === 'error' && item.msg === 'request_failed');
    assert.ok(errorEvent);
    assert.equal(events.some((item) => item.msg === 'request_warning_expected_5xx'), false);
  } finally {
    logger.info = originalInfo;
    logger.warn = originalWarn;
    logger.error = originalError;
  }
});
