import assert from 'node:assert/strict';
import test from 'node:test';

const MODULE_PATH = '../../server/lib/affiliate-links.js';

async function loadAffiliateModuleWithEnv(overrides) {
  const prev = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    prev.set(key, process.env[key]);
    if (value == null) delete process.env[key];
    else process.env[key] = String(value);
  }
  const mod = await import(`${MODULE_PATH}?t=${Date.now()}_${Math.random().toString(16).slice(2)}`);
  for (const [key, value] of prev.entries()) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  return mod;
}

test('kiwi affiliate link uses Travelpayouts click wrapper when configured', async () => {
  const { buildAffiliateLink } = await loadAffiliateModuleWithEnv({
    ENABLE_TRAVELPAYOUTS_AFFILIATE: 'true',
    ENABLE_KIWI_VIA_TRAVELPAYOUTS: 'true',
    AFFILIATE_TRAVELPAYOUTS_SHMARKER: '123456.app',
    AFFILIATE_TRAVELPAYOUTS_KIWI_PROMO_ID: '5000',
    AFFILIATE_SITE_NAME: 'flightsuite',
    AFFILIATE_KIWI_ID: ''
  });

  const deepLink = 'https://www.kiwi.com/deep?from=FCO&to=NRT&departure=2026-05-10&type2=salesman';
  const { url, partner } = buildAffiliateLink({
    origin: 'FCO',
    destinationIata: 'NRT',
    dateFrom: '2026-05-10',
    dateTo: '2026-05-18',
    partner: 'kiwi',
    kiwiDeepLink: deepLink
  });

  assert.equal(partner, 'kiwi');
  assert.match(url, /^https:\/\/c111\.travelpayouts\.com\/click\?/);
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('shmarker'), '123456.app');
  assert.equal(parsed.searchParams.get('promo_id'), '5000');
  assert.equal(parsed.searchParams.get('source_type'), 'customlink');
  assert.equal(parsed.searchParams.get('type'), 'click');
  assert.equal(parsed.searchParams.get('custom_url'), deepLink);
});

test('kiwi affiliate link falls back to kiwi search url when wrapper disabled', async () => {
  const { buildAffiliateLink } = await loadAffiliateModuleWithEnv({
    ENABLE_TRAVELPAYOUTS_AFFILIATE: 'false',
    ENABLE_KIWI_VIA_TRAVELPAYOUTS: 'false',
    AFFILIATE_TRAVELPAYOUTS_SHMARKER: '',
    AFFILIATE_KIWI_ID: 'kiwi_partner_1'
  });

  const { url, partner } = buildAffiliateLink({
    origin: 'MXP',
    destinationIata: 'JFK',
    dateFrom: '2026-06-01',
    dateTo: '2026-06-10',
    partner: 'kiwi'
  });

  assert.equal(partner, 'kiwi');
  assert.match(url, /^https:\/\/www\.kiwi\.com\/en\/search\/results\//);
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('affilid'), 'kiwi_partner_1');
});

