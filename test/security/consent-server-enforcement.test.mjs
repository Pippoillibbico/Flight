import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { buildConsentRouter } from '../../server/routes/consent.js';
import { canTrack, createConsentService } from '../../server/lib/consent-service.js';
import { getCookies } from '../../server/lib/auth-request-utils.js';

function extractSetCookies(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const raw = headers.get('set-cookie');
  if (!raw) return [];
  return raw.split(/,(?=[^;]+=[^;]+)/g).map((entry) => entry.trim());
}

function mergeCookies(jar, response) {
  for (const setCookie of extractSetCookies(response.headers)) {
    const first = String(setCookie || '').split(';')[0] || '';
    const separator = first.indexOf('=');
    if (separator <= 0) continue;
    const key = first.slice(0, separator).trim();
    const value = first.slice(separator + 1).trim();
    if (!key) continue;
    jar.set(key, value);
  }
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
}

async function withServer(app, fn) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('anonymous consent is persisted server-side and gates optional tracking', async () => {
  const app = express();
  app.use(express.json());
  const memoryDb = { userConsents: [], consentSessions: [] };

  const consentService = createConsentService({
    withDb: async (handler) => handler(memoryDb),
    readDb: async () => memoryDb,
    getCookies,
    optionalAuth: () => null,
    hashValueForLogs: (value) => `hash_${String(value).slice(0, 6)}`,
    anonymizeIpForLogs: (value) => `ip_${String(value || '').slice(0, 6)}`
  });

  app.use(
    buildConsentRouter({
      consentService,
      appendImmutableAudit: async () => {},
      sendMachineError: (_req, res, status, error) => res.status(status).json({ error }),
      isTrustedOrigin: () => true,
      resolveRequestAuthToken: () => ({ source: null }),
      accessCookieName: 'access_token',
      csrfGuard: (_req, _res, next) => next()
    })
  );
  app.post('/api/test-tracking', consentService.attachUserConsent(), (req, res) => {
    if (!canTrack(req, 'analytics')) return res.status(204).send();
    return res.status(201).json({ tracked: true });
  });

  await withServer(app, async (baseUrl) => {
    const jar = new Map();

    const firstTrackingRes = await fetch(`${baseUrl}/api/test-tracking`, { method: 'POST' });
    assert.equal(firstTrackingRes.status, 204);

    const consentRes = await fetch(`${baseUrl}/api/consent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        categories: {
          analytics: true,
          marketing: false,
          personalization: false
        }
      })
    });
    assert.equal(consentRes.status, 200);
    mergeCookies(jar, consentRes);
    assert.equal(jar.has('anonId'), true);

    const trackingWithConsentRes = await fetch(`${baseUrl}/api/test-tracking`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(jar) }
    });
    assert.equal(trackingWithConsentRes.status, 201);

    const revokeRes = await fetch(`${baseUrl}/api/consent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader(jar)
      },
      body: JSON.stringify({
        categories: {
          analytics: false,
          marketing: false,
          personalization: false
        }
      })
    });
    assert.equal(revokeRes.status, 200);

    const trackingAfterRevokeRes = await fetch(`${baseUrl}/api/test-tracking`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(jar) },
      body: JSON.stringify({ analyticsOptIn: true })
    });
    assert.equal(trackingAfterRevokeRes.status, 204);
  });
});
