import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';

import { renderCookiePolicy, renderPrivacyPolicy, renderTermsOfService } from '../server/lib/legal-pages.js';
import { getAlertDeliveryReadiness, getProviderReadiness, getSoftLaunchFeatureMatrix } from '../server/lib/launch-mode.js';
import { getRuntimeConfigAudit } from '../server/lib/runtime-config.js';

function productionSoftEnv(extra = {}) {
  return {
    NODE_ENV: 'production',
    LAUNCH_MODE: 'soft',
    BILLING_PROVIDER: 'stripe',
    STRIPE_SECRET_KEY: 'sk_live_prod_key_1234567890abcdef',
    STRIPE_WEBHOOK_SECRET: 'whsec_live_prod_1234567890',
    STRIPE_PUBLISHABLE_KEY: 'pk_live_prod_key_1234567890abcdef',
    STRIPE_PRICE_PRO: 'price_live_pro_12345',
    STRIPE_PRICE_CREATOR: 'price_live_creator_12345',
    ALLOW_MOCK_BILLING_UPGRADES: 'false',
    JWT_SECRET: 'a'.repeat(48),
    OUTBOUND_CLICK_SECRET: 'z'.repeat(32),
    AUDIT_LOG_HMAC_KEY: 'b'.repeat(32),
    INTERNAL_INGEST_TOKEN: 'c'.repeat(32),
    FRONTEND_ORIGIN: 'https://app.flightsuite.test',
    DATABASE_URL: 'postgresql://user:pass@db.flightsuite.internal:5432/flight',
    REDIS_URL: 'redis://cache.flightsuite.internal:6379',
    ENABLE_PROVIDER_DUFFEL: 'false',
    ENABLE_PROVIDER_KIWI: 'false',
    ENABLE_PROVIDER_SKYSCANNER: 'false',
    DEALS_CONTENT_ENABLED: 'true',
    DEALS_CONTENT_INAPP_ENABLED: 'true',
    ENABLE_TRAVELPAYOUTS_AFFILIATE: 'true',
    AFFILIATE_TRAVELPAYOUTS_MARKER: 'tp_marker_prod_123',
    ...extra
  };
}

test('soft launch runtime audit can pass without Duffel when product is cached-only honest', () => {
  const audit = getRuntimeConfigAudit(productionSoftEnv());
  assert.equal(audit.ok, true);
  assert.equal(audit.launchMode, 'soft');
  assert.equal(audit.blockingFailedKeys.includes('LIVE_FLIGHT_PROVIDER_REQUIRED'), false);
  assert.equal(audit.blockingFailedKeys.includes('SOFT_LAUNCH_PROVIDER_PROFILE'), false);
});

test('soft launch allows Kiwi as the primary live provider when configured', () => {
  const audit = getRuntimeConfigAudit(
    productionSoftEnv({
      ENABLE_PROVIDER_KIWI: 'true',
      KIWI_API_KEY: 'kiwi_live_key_123456789'
    })
  );
  assert.equal(audit.ok, true);
  assert.equal(audit.blockingFailedKeys.includes('SOFT_LAUNCH_PROVIDER_PROFILE'), false);
});

test('soft launch allows Kiwi primary with Duffel secondary when both are configured', () => {
  const audit = getRuntimeConfigAudit(
    productionSoftEnv({
      ENABLE_PROVIDER_KIWI: 'true',
      KIWI_API_KEY: 'kiwi_live_key_123456789',
      ENABLE_PROVIDER_DUFFEL: 'true',
      DUFFEL_API_KEY: 'duffel_live_key_123456789',
      PROVIDER_COLLECTION_ENABLED: 'true',
      FLIGHT_SCAN_ENABLED: 'true'
    })
  );
  assert.equal(audit.ok, true);
  assert.equal(audit.blockingFailedKeys.includes('SOFT_LAUNCH_PROVIDER_PROFILE'), false);
  assert.equal(audit.blockingFailedKeys.includes('AT_LEAST_ONE_PROVIDER_CONFIGURED'), false);
});

test('soft launch blocks Kiwi when enabled without credentials', () => {
  const audit = getRuntimeConfigAudit(productionSoftEnv({ ENABLE_PROVIDER_KIWI: 'true', KIWI_API_KEY: '' }));
  assert.equal(audit.ok, false);
  assert.equal(audit.blockingFailedKeys.includes('SOFT_LAUNCH_PROVIDER_PROFILE'), true);
});

test('Duffel absent resolves to provider not ready and cached public copy', () => {
  const readiness = getProviderReadiness({ ENABLE_PROVIDER_DUFFEL: 'false', DUFFEL_API_KEY: '' });
  assert.equal(readiness.status, 'PROVIDER_NOT_READY');
  assert.equal(readiness.liveProviderConfigured, false);
  assert.equal(readiness.publicCopy, 'Public cached opportunities');
});

test('SMTP and push absent resolve to alert delivery not ready without instant promise', () => {
  const readiness = getAlertDeliveryReadiness({
    SMTP_HOST: '',
    SMTP_USER: '',
    SMTP_PASS: '',
    PUSH_WEBHOOK_URL: '',
    VAPID_PUBLIC_KEY: '',
    VAPID_PRIVATE_KEY: ''
  });
  assert.equal(readiness.status, 'ALERT_DELIVERY_NOT_READY');
  assert.equal(readiness.instantAlertsAvailable, false);
  assert.equal(readiness.publicCopy, 'Save this route. Email alerts will be enabled soon.');
});

test('soft launch feature matrix exposes core MVP and hides unready features', () => {
  const matrix = getSoftLaunchFeatureMatrix(productionSoftEnv());
  assert.equal(matrix.launchMode, 'soft');
  assert.ok(matrix.available.includes('public_cached_deals'));
  assert.ok(matrix.available.includes('cached_radar_preview'));
  assert.ok(matrix.disabled.includes('ai_for_free'));
  assert.ok(matrix.disabled.includes('live_fares_copy_and_live_scan'));
  assert.ok(matrix.disabled.includes('instant_alerts_copy_and_delivery'));
});

test('public legal pages are generated from versioned privacy docs', () => {
  const privacy = renderPrivacyPolicy();
  const cookie = renderCookiePolicy();
  const terms = renderTermsOfService();

  assert.match(privacy, /data-legal-source="docs\/privacy\/privacy-policy\.md"/);
  assert.match(privacy, /Version: v1\.3-flight-provider-activation/);
  assert.match(privacy, /Data Controller/);
  assert.match(privacy, /docs\/privacy\/dpa-fornitori\.md/);
  assert.match(privacy, /docs\/security\/data-breach-72h-procedure\.md/);

  assert.match(cookie, /data-legal-source="docs\/privacy\/cookie-policy\.md"/);
  assert.match(cookie, /Consent Management/);
  assert.match(cookie, /necessary/);
  assert.match(cookie, /analytics/);

  assert.match(terms, /Terms and Conditions/);
  assert.match(terms, /Soft-launch transparency/);
  assert.match(terms, /docs\/privacy\/data-retention-policy\.md/);
});

test('footer and auth surfaces link to public legal pages', () => {
  const landing = readFileSync('src/components/LandingSection.jsx', 'utf8');
  const auth = readFileSync('src/components/AuthSection.jsx', 'utf8');
  const cookieBanner = readFileSync('src/components/CookieBanner.jsx', 'utf8');

  for (const source of [landing, auth]) {
    assert.match(source, /href="\/privacy-policy"/);
    assert.match(source, /href="\/terms"/);
  }

  assert.match(landing, /href="\/cookie-policy"/);
  assert.match(auth, /href="\/cookie-policy"/);
  assert.match(cookieBanner, /href="\/cookie-policy"/);
  assert.match(cookieBanner, /href="\/privacy-policy"/);
});

function collectSourceFiles(root, files = []) {
  if (!existsSync(root)) return files;
  const stat = statSync(root);
  if (stat.isFile()) {
    files.push(root);
    return files;
  }

  for (const entry of readdirSync(root)) {
    if (entry === 'audit' || entry === 'node_modules' || entry === 'dist') continue;
    collectSourceFiles(join(root, entry), files);
  }
  return files;
}

test('soft launch public copy avoids unproven Free/live claims', () => {
  const roots = ['src', 'server', 'docs/SOFT_LAUNCH_RUNBOOK.md', 'index.html'];
  const files = roots
    .flatMap((root) => collectSourceFiles(root))
    .filter((file) => /\.(js|jsx|ts|tsx|md|html)$/.test(file));
  const forbidden = [
    /live fares/i,
    /real-time radar/i,
    /AI-powered/i,
    /instant alerts/i,
    /deep scan/i,
    /live radar/i
  ];

  const offenders = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const pattern of forbidden) {
      if (pattern.test(text)) {
        offenders.push(`${relative(process.cwd(), file)}:${pattern}`);
      }
    }
  }

  assert.deepEqual(offenders, []);
});
