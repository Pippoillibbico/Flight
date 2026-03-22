import assert from 'node:assert/strict';
import test from 'node:test';
import { createDealsContentEngine } from '../server/lib/deals-content-engine.js';

function makeDeal(overrides = {}) {
  return {
    deal_key: 'deal_default',
    origin_iata: 'FCO',
    destination_iata: 'LIS',
    destination_city: 'Lisbon',
    price: 120,
    savings_pct: 30,
    final_score: 70,
    deal_type: 'great_deal',
    source_observed_at: '2026-03-12T09:00:00.000Z',
    published_at: '2026-03-12T09:00:00.000Z',
    depart_date: '2026-03-20',
    return_date: '2026-03-23',
    currency: 'EUR',
    ...overrides
  };
}

function buildFeedPayload() {
  const d1 = makeDeal({ deal_key: 'd1', destination_iata: 'LIS', destination_city: 'Lisbon', price: 95, savings_pct: 38, final_score: 72 });
  const d2 = makeDeal({
    deal_key: 'd2',
    destination_iata: 'BCN',
    destination_city: 'Barcelona',
    price: 120,
    savings_pct: 50,
    final_score: 88,
    deal_type: 'rare_opportunity',
    depart_date: '2026-03-18',
    return_date: '2026-03-22'
  });
  const d3 = makeDeal({
    deal_key: 'd3',
    destination_iata: 'ATH',
    destination_city: 'Athens',
    price: 70,
    savings_pct: 32,
    final_score: 67,
    depart_date: '2026-03-14',
    return_date: '2026-03-16'
  });
  const d4 = makeDeal({
    deal_key: 'd4',
    destination_iata: 'MAD',
    destination_city: 'Madrid',
    price: 60,
    savings_pct: 55,
    final_score: 91,
    source_observed_at: '2026-03-11T20:00:00.000Z',
    published_at: '2026-03-11T20:00:00.000Z'
  });
  const d5 = makeDeal({
    deal_key: 'd5',
    destination_iata: 'JFK',
    destination_city: 'New York',
    price: 299,
    savings_pct: 46,
    final_score: 86,
    deal_type: 'exceptional_price',
    depart_date: '2026-03-21',
    return_date: '2026-03-29'
  });
  const d6 = makeDeal({
    deal_key: 'd6',
    destination_iata: 'DXB',
    destination_city: 'Dubai',
    price: 280,
    savings_pct: 40,
    final_score: 83,
    depart_date: '2026-03-27',
    return_date: '2026-03-30'
  });

  return {
    skipped: false,
    reason: null,
    queries: {
      top_offers: [d2, d5, d6, d1, d3, d4],
      recent_offers: [d3, d2, d6, d1, d5, d4],
      popular_offers: [d5, d2, d6, d1]
    },
    categories: {
      cheap_flights: [d4, d3, d1, d2, d6, d5],
      weekend_flights: [d1, d3, d6],
      last_minute_flights: [d3, d2],
      long_haul_discounted: [d5, d6]
    }
  };
}

test('deals content engine builds the requested sections and channel outputs', async () => {
  const now = new Date('2026-03-12T12:00:00.000Z');
  const feedPayload = buildFeedPayload();
  const feedService = {
    async buildDiscoveryFeed() {
      return feedPayload;
    }
  };

  const engine = createDealsContentEngine({
    feedService,
    timezone: 'UTC',
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });

  const result = await engine.generateContent({ now });
  assert.equal(result.skipped, false);
  assert.equal(result.source, 'detected_deals');

  assert.equal(result.sections.top5CheapFlightsToday.length, 5);
  assert.equal(result.sections.top5CheapFlightsToday[0].deal_key, 'd3');
  assert.equal(Number(result.sections.top5CheapFlightsToday[0].price) <= Number(result.sections.top5CheapFlightsToday[1].price), true);

  assert.equal(result.sections.destinationsUnder300.length >= 4, true);
  assert.equal(result.sections.destinationsUnder300.every((item) => Number(item.from_price) <= 300), true);
  const destinationSet = new Set(result.sections.destinationsUnder300.map((item) => item.destination_iata_raw));
  assert.equal(destinationSet.size, result.sections.destinationsUnder300.length);

  assert.equal(result.sections.weekendLowCost.some((item) => item.deal_key === 'd1'), true);

  assert.equal(result.sections.crazyFlightsToday.some((item) => item.deal_key === 'd2'), true);
  assert.equal(result.sections.crazyFlightsToday.some((item) => item.deal_key === 'd5'), true);
  assert.equal(result.sections.crazyFlightsToday.some((item) => item.deal_key === 'd4'), false);

  assert.equal(typeof result.outputs.pushNotification.title, 'string');
  assert.equal(typeof result.outputs.pushNotification.message, 'string');
  assert.equal(result.outputs.newsletter.text.includes('Top 5 voli economici oggi'), true);
  assert.equal(result.outputs.newsletter.text.includes('Destinazioni sotto 300EUR'), true);
  assert.equal(result.outputs.newsletter.text.includes('Weekend low cost'), true);
  assert.equal(result.outputs.newsletter.text.includes('Voli folli trovati oggi'), true);
  assert.equal(typeof result.outputs.socialContents.x, 'string');
  assert.equal(typeof result.outputs.socialContents.instagram, 'string');
  assert.equal(typeof result.outputs.socialContents.linkedin, 'string');
});

test('deals content engine delivers push, newsletter and social payloads', async () => {
  const now = new Date('2026-03-12T12:00:00.000Z');
  const feedService = {
    async buildDiscoveryFeed() {
      return buildFeedPayload();
    }
  };

  const fetchCalls = [];
  const mailCalls = [];
  const emailLogs = [];

  const engine = createDealsContentEngine({
    feedService,
    timezone: 'UTC',
    pushWebhookUrl: 'https://push.example/mock',
    pushWebhookToken: 'push-token',
    pushUserIds: ['u1', 'u2'],
    socialWebhookUrl: 'https://social.example/mock',
    socialWebhookToken: 'social-token',
    newsletterRecipients: ['a@example.com', 'b@example.com'],
    fetchFn: async (url, options) => {
      fetchCalls.push({ url, options });
      return { ok: true, status: 200 };
    },
    sendMail: async (payload) => {
      mailCalls.push(payload);
      return { sent: true, messageId: `mail_${mailCalls.length}` };
    },
    insertEmailDeliveryLog: async (row) => {
      emailLogs.push(row);
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });

  const result = await engine.runOnce({ now, deliver: true });
  assert.equal(result.delivery.push.attempted, 2);
  assert.equal(result.delivery.push.sent, 2);
  assert.equal(result.delivery.newsletter.attempted, 2);
  assert.equal(result.delivery.newsletter.sent, 2);
  assert.equal(result.delivery.social.attempted, 1);
  assert.equal(result.delivery.social.sent, 1);

  assert.equal(fetchCalls.length, 3);
  assert.equal(mailCalls.length, 2);
  assert.equal(emailLogs.length, 2);
  assert.equal(emailLogs.every((row) => row.status === 'sent'), true);
});
