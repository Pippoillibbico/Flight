/**
 * Tests for the runtime capability matrix logic.
 *
 * Tests the capability detection rules directly without spinning up an HTTP
 * server, by replicating the env-based logic from system.js.
 *
 * Covers:
 *  1. All capabilities inactive → correct reasons
 *  2. SMTP configured → email_smtp active, email_verification active
 *  3. Live provider enabled with credentials → live_flight_providers active
 *  4. Flight scan enabled but no provider → flight_scan not active
 *  5. Billing active when provider credentials present
 *  6. AI active when at least one key present
 *  7. data_source is 'live' only when scan + provider both enabled
 *  8. Search history persist_enabled flag
 */
import assert from 'node:assert/strict';
import test from 'node:test';

// ── Inline capability resolver (mirrors system.js /api/system/capabilities) ───

function resolveCapabilities(env = {}) {
  const parseFlag = (v, def = false) => {
    if (v === undefined || v === null || v === '') return def;
    return ['true', '1', 'yes'].includes(String(v).trim().toLowerCase());
  };
  const hasValue = (v, min = 4) => String(v || '').trim().length >= min;
  const notPlaceholder = (v) =>
    !['replace-with', 'example.com', 'changeme', 'your-', 'todo'].some((p) =>
      String(v || '').toLowerCase().includes(p)
    );
  const ready = (v, min = 4) => hasValue(v, min) && notPlaceholder(v);

  const smtpReady = ready(env.SMTP_HOST) && ready(env.SMTP_USER) && ready(env.SMTP_PASS);
  const googleReady = ready(env.GOOGLE_CLIENT_ID) || ready(env.GOOGLE_CLIENT_IDS);
  const facebookReady = ready(env.FACEBOOK_CLIENT_ID) || ready(env.FACEBOOK_CLIENT_IDS);
  const appleReady = ready(env.APPLE_CLIENT_ID) || ready(env.APPLE_CLIENT_IDS);
  const openaiReady = ready(env.OPENAI_API_KEY, 8);
  const anthropicReady = ready(env.ANTHROPIC_API_KEY, 8);
  const aiReady = openaiReady || anthropicReady;
  const stripeReady = ready(env.STRIPE_SECRET_KEY, 16);
  const braintreeReady = ready(env.BT_MERCHANT_ID) && ready(env.BT_PUBLIC_KEY) && ready(env.BT_PRIVATE_KEY);
  const billingProvider = String(env.BILLING_PROVIDER || 'braintree').trim().toLowerCase();
  const billingReady = billingProvider === 'stripe' ? stripeReady : braintreeReady;
  const duffelEnabled = parseFlag(env.ENABLE_PROVIDER_DUFFEL);
  const amadeusEnabled = parseFlag(env.ENABLE_PROVIDER_AMADEUS);
  const duffelReady = duffelEnabled && ready(env.DUFFEL_API_KEY, 8);
  const amadeusReady = amadeusEnabled && ready(env.AMADEUS_CLIENT_ID) && ready(env.AMADEUS_CLIENT_SECRET);
  const liveProvidersReady = duffelReady || amadeusReady;
  const flightScanEnabled = parseFlag(env.FLIGHT_SCAN_ENABLED);
  const pushReady = ready(env.PUSH_WEBHOOK_URL, 10);
  const searchHistoryEnabled = parseFlag(env.SEARCH_HISTORY_PERSIST_ENABLED);
  const billingConfigured = ready(env.DATABASE_URL, 10);

  const cap = (active, reason = null) => ({ active: Boolean(active), reason: active ? null : reason });

  return {
    smtp: cap(smtpReady, 'SMTP not configured'),
    ai: cap(aiReady, 'No AI API key'),
    billing: cap(billingReady, `Billing credentials missing`),
    live_providers: cap(liveProvidersReady, 'No live provider'),
    flight_scan: cap(flightScanEnabled && liveProvidersReady, flightScanEnabled ? 'providers missing' : 'scan disabled'),
    data_source: (flightScanEnabled && liveProvidersReady) ? 'live' : 'internal',
    push: cap(pushReady, 'PUSH_WEBHOOK_URL missing'),
    oauth_google: cap(googleReady, 'GOOGLE_CLIENT_ID missing'),
    oauth_facebook: cap(facebookReady, 'FACEBOOK_CLIENT_ID missing'),
    oauth_apple: cap(appleReady, 'APPLE_CLIENT_ID missing'),
    email_verification: cap(smtpReady, 'SMTP not configured'),
    search_history: searchHistoryEnabled,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

test('capability matrix: all empty env → everything inactive with reasons', () => {
  const caps = resolveCapabilities({});
  assert.equal(caps.smtp.active, false);
  assert.equal(typeof caps.smtp.reason, 'string');
  assert.equal(caps.ai.active, false);
  assert.equal(caps.billing.active, false);
  assert.equal(caps.live_providers.active, false);
  assert.equal(caps.flight_scan.active, false);
  assert.equal(caps.data_source, 'internal');
  assert.equal(caps.push.active, false);
  assert.equal(caps.oauth_google.active, false);
  assert.equal(caps.oauth_facebook.active, false);
  assert.equal(caps.oauth_apple.active, false);
  assert.equal(caps.email_verification.active, false);
  assert.equal(caps.search_history, false);
});

test('capability matrix: SMTP configured → smtp and email_verification active', () => {
  const caps = resolveCapabilities({
    SMTP_HOST: 'mail.acme-corp.io',
    SMTP_USER: 'noreply@acme-corp.io',
    SMTP_PASS: 'secretpassword'
  });
  assert.equal(caps.smtp.active, true);
  assert.equal(caps.smtp.reason, null);
  assert.equal(caps.email_verification.active, true);
});

test('capability matrix: placeholder SMTP values → smtp inactive', () => {
  const caps = resolveCapabilities({
    SMTP_HOST: 'replace-with-smtp-host',
    SMTP_USER: 'your-user',
    SMTP_PASS: 'changeme'
  });
  assert.equal(caps.smtp.active, false);
});

test('capability matrix: OpenAI key → ai active', () => {
  const caps = resolveCapabilities({ OPENAI_API_KEY: 'sk-abcdef12345678' });
  assert.equal(caps.ai.active, true);
  assert.equal(caps.ai.reason, null);
});

test('capability matrix: Anthropic key → ai active', () => {
  const caps = resolveCapabilities({ ANTHROPIC_API_KEY: 'sk-ant-abcdef12' });
  assert.equal(caps.ai.active, true);
});

test('capability matrix: Braintree creds → billing active', () => {
  const caps = resolveCapabilities({
    BILLING_PROVIDER: 'braintree',
    BT_MERCHANT_ID: 'merchant123',
    BT_PUBLIC_KEY: 'pubkey123',
    BT_PRIVATE_KEY: 'privkey123'
  });
  assert.equal(caps.billing.active, true);
});

test('capability matrix: Stripe selected but no key → billing inactive', () => {
  const caps = resolveCapabilities({
    BILLING_PROVIDER: 'stripe',
    STRIPE_SECRET_KEY: ''
  });
  assert.equal(caps.billing.active, false);
});

test('capability matrix: Duffel enabled with key → live_providers active', () => {
  const caps = resolveCapabilities({
    ENABLE_PROVIDER_DUFFEL: 'true',
    DUFFEL_API_KEY: 'duffel_live_abcdefgh'
  });
  assert.equal(caps.live_providers.active, true);
});

test('capability matrix: flight scan enabled but no provider → scan inactive', () => {
  const caps = resolveCapabilities({
    FLIGHT_SCAN_ENABLED: 'true',
    ENABLE_PROVIDER_DUFFEL: 'false',
    ENABLE_PROVIDER_AMADEUS: 'false'
  });
  assert.equal(caps.flight_scan.active, false);
  assert.equal(caps.data_source, 'internal');
});

test('capability matrix: scan + duffel provider → data_source is live', () => {
  const caps = resolveCapabilities({
    FLIGHT_SCAN_ENABLED: 'true',
    ENABLE_PROVIDER_DUFFEL: 'true',
    DUFFEL_API_KEY: 'duffel_live_abcdefgh'
  });
  assert.equal(caps.flight_scan.active, true);
  assert.equal(caps.data_source, 'live');
});

test('capability matrix: SEARCH_HISTORY_PERSIST_ENABLED=true → search_history enabled', () => {
  const caps = resolveCapabilities({ SEARCH_HISTORY_PERSIST_ENABLED: 'true' });
  assert.equal(caps.search_history, true);
});

test('capability matrix: SEARCH_HISTORY_PERSIST_ENABLED empty → search_history disabled', () => {
  const caps = resolveCapabilities({ SEARCH_HISTORY_PERSIST_ENABLED: '' });
  assert.equal(caps.search_history, false);
});

test('capability matrix: push webhook configured → push active', () => {
  const caps = resolveCapabilities({ PUSH_WEBHOOK_URL: 'https://push.acme-corp.io/notify' });
  assert.equal(caps.push.active, true);
});

test('capability matrix: Google client id → oauth_google active', () => {
  const caps = resolveCapabilities({ GOOGLE_CLIENT_ID: '1234567890-abc.apps.googleusercontent.com' });
  assert.equal(caps.oauth_google.active, true);
  assert.equal(caps.oauth_google.reason, null);
});

test('capability matrix: no GOOGLE_CLIENT_ID → oauth_google inactive with reason', () => {
  const caps = resolveCapabilities({});
  assert.equal(caps.oauth_google.active, false);
  assert.ok(typeof caps.oauth_google.reason === 'string');
});

test('capability matrix: FACEBOOK_CLIENT_ID → oauth_facebook active', () => {
  const caps = resolveCapabilities({ FACEBOOK_CLIENT_ID: '1234567890123456' });
  assert.equal(caps.oauth_facebook.active, true);
  assert.equal(caps.oauth_facebook.reason, null);
});

test('capability matrix: FACEBOOK_CLIENT_IDS (multi) → oauth_facebook active', () => {
  const caps = resolveCapabilities({ FACEBOOK_CLIENT_IDS: '1234567890123456,9876543210' });
  assert.equal(caps.oauth_facebook.active, true);
});

test('capability matrix: no FACEBOOK_CLIENT_ID → oauth_facebook inactive with reason', () => {
  const caps = resolveCapabilities({});
  assert.equal(caps.oauth_facebook.active, false);
  assert.ok(typeof caps.oauth_facebook.reason === 'string');
});

test('capability matrix: APPLE_CLIENT_ID → oauth_apple active', () => {
  const caps = resolveCapabilities({ APPLE_CLIENT_ID: 'com.acme-corp.app.signin' });
  assert.equal(caps.oauth_apple.active, true);
  assert.equal(caps.oauth_apple.reason, null);
});

test('capability matrix: no APPLE_CLIENT_ID → oauth_apple inactive with reason', () => {
  const caps = resolveCapabilities({});
  assert.equal(caps.oauth_apple.active, false);
  assert.ok(typeof caps.oauth_apple.reason === 'string');
});

test('capability matrix: placeholder APPLE_CLIENT_ID → oauth_apple inactive', () => {
  const caps = resolveCapabilities({ APPLE_CLIENT_ID: 'your-services-id' });
  assert.equal(caps.oauth_apple.active, false);
});

test('capability matrix: push webhook missing → push inactive with reason', () => {
  const caps = resolveCapabilities({});
  assert.equal(caps.push.active, false);
  assert.ok(typeof caps.push.reason === 'string');
});
