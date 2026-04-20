import express from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { resolveUserPlan } from '../lib/plan-access.js';
import { z } from 'zod';
import { ingestPriceObservation, initDealEngineStore, recomputeRouteBaselines, scoreDeal } from '../lib/deal-engine-store.js';
import { findCheapestWindows } from '../lib/window-finder-engine.js';
import { detectDealV2 } from '../lib/deal-detector.js';
import { evaluateObservationForAlerts } from '../lib/alert-intelligence.js';
import { getPriceDatasetStatus } from '../lib/price-history-store.js';
import { getLiveDeals, getRealtimeStats } from '../lib/realtime-anomaly-engine.js';
import { generateAffiliateLink, buildBookingUrl } from '../lib/affiliate-link-engine.js';
import { insertAffiliateClick, getAffiliateStats, initAffiliateClicksStore } from '../lib/affiliate-clicks-store.js';
import { multiSourceSearch, getProviderStatus, isMultiSourceEnabled } from '../lib/multi-source-search-engine.js';
import { getCacheRuntimeState } from '../lib/free-cache.js';
import { getAffiliateConfig } from '../lib/affiliate-links.js';
import { readDb } from '../lib/db.js';
import { getCostCapMonitoringSnapshot } from '../lib/cost-cap-monitor.js';
import { logger } from '../lib/logger.js';

const ingestSchema = z.object({
  origin_iata: z.string().trim().length(3),
  destination_iata: z.string().trim().length(3),
  departure_date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  return_date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  currency: z.string().trim().min(3).max(3).optional(),
  total_price: z.number().positive(),
  provider: z.string().trim().min(2).max(80),
  cabin_class: z.string().trim().min(2).max(30).optional(),
  trip_type: z.string().trim().min(2).max(30).optional(),
  observed_at: z.string().trim().optional(),
  source: z.string().trim().min(2).max(40).optional(),
  fingerprint: z.string().trim().min(20).max(128).optional(),
  metadata: z.record(
    z.string().max(64),
    z.union([z.string().max(200), z.number(), z.boolean(), z.null()])
  ).optional()
}).strict();

const dealScoreSchema = z.object({
  origin: z.string().trim().length(3),
  destination: z.string().trim().length(3),
  departure_date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  price: z.coerce.number().positive()
}).strict();

const engineWindowSchema = z.object({
  origin: z.string().trim().length(3),
  dateFrom: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateTo: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  stayDays: z.coerce.number().int().min(2).max(30),
  destinationQuery: z.string().trim().max(120).optional(),
  region: z.enum(['all', 'eu', 'asia', 'america', 'oceania']).optional().default('all'),
  maxBudget: z.coerce.number().positive().optional(),
  travellers: z.coerce.number().int().min(1).max(9).optional().default(1),
  cabinClass: z.enum(['economy', 'premium', 'business']).optional().default('economy'),
  topN: z.coerce.number().int().min(1).max(50).optional().default(20)
}).strict();

const engineDealsSchema = z.object({
  origin: z.string().trim().length(3),
  dateFrom: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateTo: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  stayDays: z.coerce.number().int().min(2).max(30),
  destinationQuery: z.string().trim().max(120).optional(),
  region: z.enum(['all', 'eu', 'asia', 'america', 'oceania']).optional().default('all'),
  maxBudget: z.coerce.number().positive().optional(),
  travellers: z.coerce.number().int().min(1).max(9).optional().default(1),
  cabinClass: z.enum(['economy', 'premium', 'business']).optional().default('economy'),
  topN: z.coerce.number().int().min(1).max(30).optional().default(12)
}).strict();

const alertSimSchema = z.object({
  origin: z.string().trim().length(3),
  destination: z.string().trim().length(3),
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  price: z.coerce.number().positive(),
  targetPrice: z.coerce.number().positive().optional()
}).strict();

function secureEquals(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function extractToken(req) {
  const auth = String(req.headers.authorization || '').trim();
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return String(req.headers['x-internal-ingest-token'] || '').trim();
}

function internalIngestGuard(req, res, next) {
  const expected = String(process.env.INTERNAL_INGEST_TOKEN || '').trim();
  if (!expected) return res.status(503).json({ error: 'ingest_token_not_configured' });
  const provided = extractToken(req);
  if (!provided || !secureEquals(provided, expected)) return res.status(401).json({ error: 'unauthorized' });
  return next();
}

function adminOrDevGuard(req, res, next) {
  if (process.env.NODE_ENV !== 'production') return next();
  const adminKey = String(process.env.ENGINE_ADMIN_KEY || '').trim();
  const provided = String(req.headers['x-engine-admin-key'] || '').trim();
  if (adminKey && provided && secureEquals(provided, adminKey)) return next();
  return res.status(403).json({ error: 'request_forbidden' });
}

function generateRealtimeId(deal) {
  return createHash('sha1')
    .update(JSON.stringify(deal))
    .digest('hex')
    .slice(0, 12);
}

function readRealtimeCacheMeta() {
  const state = getCacheRuntimeState();
  return { redisConnected: state.redisConnected, source: state.source };
}

function sanitizeRedirectUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ''));
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return null;
  }
}

function ensureInternalBookingUrl(rawBookingUrl, dealId, dealPayload) {
  const normalized = String(rawBookingUrl || '').trim();
  if (/^\/api\/redirect\/[^/?#]+/i.test(normalized)) return normalized;
  const fallback = buildBookingUrl(dealId, dealPayload || {});
  logger.warn(
    {
      dealId,
      rawBookingUrl: normalized || null
    },
    'booking_url_rewritten_to_internal_redirect'
  );
  return fallback;
}

function devOnlyGuard(req, res, next) {
  if (String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production') {
    return res.status(404).json({ error: 'not_found' });
  }
  return next();
}

export function buildDealEngineRouter({ authGuard = (_req, _res, next) => next() } = {}) {
  const router = express.Router();

  router.get('/api/engine/status', async (_req, res) => {
    try {
      const dataset = await getPriceDatasetStatus();
      return res.json({
        ok: true,
        engines: {
          baseline: true,
          ingestion: true,
          detector: true,
          ranking: true,
          discovery: true,
          seasonalContext: true,
          windowFinder: true,
          anomalyDetector: true,
          pricePredictor: true,
          alertIntelligence: true
        },
        dataset,
        mode: {
          externalFlightProviders: String(process.env.ENABLE_EXTERNAL_FLIGHT_PARTNERS || 'false').toLowerCase() === 'true',
          proprietaryLocalDefault: true,
          // data_source is 'live' only when flight scan is enabled AND a provider is configured.
          data_source: (process.env.FLIGHT_SCAN_ENABLED === 'true' &&
            process.env.ENABLE_PROVIDER_DUFFEL === 'true')
            ? 'live' : 'internal'
        }
      });
    } catch (error) {
      logger.error({ err: error }, 'engine_status_failed');
      return res.status(500).json({ error: 'internal_error' });
    }
  });

  router.post('/api/internal/ingest/price-observation', internalIngestGuard, async (req, res) => {
    const parsed = ingestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid payload.' });
    }
    try {
      await initDealEngineStore();
      const result = await ingestPriceObservation(parsed.data);
      logger.info(
        {
          inserted: result.inserted,
          deduped: !result.inserted,
          id: result.id,
          fingerprint: result.fingerprint,
          origin: parsed.data.origin_iata,
          destination: parsed.data.destination_iata
        },
        'ingestion_accepted'
      );
      if (!result.inserted) {
        logger.info(
          {
            fingerprint: result.fingerprint,
            origin: parsed.data.origin_iata,
            destination: parsed.data.destination_iata
          },
          'ingestion_deduped'
        );
      }

      return res.status(result.inserted ? 201 : 200).json({
        ok: true,
        inserted: result.inserted,
        deduped: !result.inserted,
        id: result.id,
        fingerprint: result.fingerprint,
        ingestion_policy: 'local_proprietary_only'
      });
    } catch (error) {
      const message = String(error?.message || '');
      if (message.toLowerCase().startsWith('rejected by ingestion policy')) {
        return res.status(422).json({ error: message });
      }
      logger.error({ err: error }, 'ingest_price_observation_failed');
      return res.status(500).json({ error: 'internal_error' });
    }
  });

  router.post('/api/internal/engine/recompute-baselines', internalIngestGuard, async (_req, res) => {
    try {
      await initDealEngineStore();
      const result = await recomputeRouteBaselines();
      return res.json({ ok: true, ...result });
    } catch (error) {
      logger.error({ err: error }, 'recompute_route_baselines_failed');
      return res.status(500).json({ error: 'internal_error' });
    }
  });

  router.post('/api/engine/recompute', adminOrDevGuard, async (_req, res) => {
    try {
      await initDealEngineStore();
      const result = await recomputeRouteBaselines();
      return res.json({ ok: true, ...result });
    } catch (error) {
      logger.error({ err: error }, 'engine_recompute_failed');
      return res.status(500).json({ error: 'internal_error' });
    }
  });

  router.post('/api/engine/windows', authGuard, async (req, res) => {
    const parsed = engineWindowSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid payload.' });
    try {
      const result = findCheapestWindows(parsed.data);
      return res.json(result);
    } catch (error) {
      logger.error({ err: error }, 'engine_windows_failed');
      return res.status(500).json({ error: 'internal_error' });
    }
  });

  router.post('/api/engine/deals', authGuard, async (req, res) => {
    const { planType } = resolveUserPlan(req.user);
    if (planType === 'free') {
      return res.status(402).json({ error: 'premium_required', message: 'Deal engine requires a Pro or Creator plan.' });
    }
    const parsed = engineDealsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid payload.' });
    try {
      const windows = findCheapestWindows(parsed.data).windows;
      const deals = [];
      for (const item of windows) {
        const evaluated = await detectDealV2({
          origin: item.origin,
          destination: item.destinationIata,
          date: item.dateFrom,
          price: item.price,
          stopCount: item.stopCount,
          isNightFlight: item.isNightFlight,
          comfortScore: item.comfortScore
        });
        // Stable dealId for this deal (deterministic from route+date+price)
        const dealId = createHash('sha1')
          .update(`${item.origin}|${item.destinationIata}|${item.dateFrom}|${item.price}`)
          .digest('hex').slice(0, 16);
        const { provider, estimated_commission } = generateAffiliateLink({
          origin: item.origin, destination: item.destinationIata,
          departure_date: item.dateFrom, return_date: item.dateTo || null,
          price: item.price
        });
        const booking_url = buildBookingUrl(dealId, {
          origin: item.origin, destination: item.destinationIata,
          departure_date: item.dateFrom, return_date: item.dateTo || null,
          price: item.price, deal_type: evaluated.deal_type || 'unknown',
          deal_confidence: evaluated.dealConfidence
        });
        const safeBookingUrl = ensureInternalBookingUrl(booking_url, dealId, {
          origin: item.origin,
          destination: item.destinationIata,
          departure_date: item.dateFrom,
          return_date: item.dateTo || null,
          price: item.price,
          deal_type: evaluated.deal_type || 'unknown',
          deal_confidence: evaluated.dealConfidence
        });
        deals.push({ ...item, ...evaluated, deal_id: dealId, booking_url: safeBookingUrl, provider, estimated_commission });
      }
      deals.sort((a, b) => b.dealConfidence - a.dealConfidence || a.price - b.price);
      return res.json({ deals: deals.slice(0, parsed.data.topN) });
    } catch (error) {
      logger.error({ err: error }, 'engine_deals_failed');
      return res.status(500).json({ error: 'internal_error' });
    }
  });

  router.post('/api/alerts/simulate', async (req, res) => {
    const parsed = alertSimSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid payload.' });
    try {
      const result = await evaluateObservationForAlerts(
        {
          origin: parsed.data.origin,
          destination: parsed.data.destination,
          date: parsed.data.date,
          price: parsed.data.price,
          fingerprint: `sim-${Date.now()}-${parsed.data.origin}-${parsed.data.destination}-${parsed.data.date}`
        },
        {
          threshold: 50,
          deviationThresholdPct: 18
        }
      );
      return res.json({
        ok: true,
        simulated: true,
        targetPrice: parsed.data.targetPrice || null,
        result
      });
    } catch (error) {
      logger.error({ err: error }, 'alerts_simulate_failed');
      return res.status(500).json({ error: 'internal_error' });
    }
  });

  router.get('/api/engine/deal-score', async (req, res) => {
    const parsed = dealScoreSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid query.' });
    }
    try {
      await initDealEngineStore();
      const result = await scoreDeal({
        origin: parsed.data.origin,
        destination: parsed.data.destination,
        departureDate: parsed.data.departure_date,
        price: parsed.data.price
      });
      return res.json(result);
    } catch (error) {
      const message = String(error?.message || '');
      if (message.toLowerCase().startsWith('invalid')) return res.status(400).json({ error: message });
      logger.error({ err: error }, 'deal_score_failed');
      return res.status(500).json({ error: 'internal_error' });
    }
  });

  // ── Affiliate redirect + click tracking ─────────────────────────────────

  router.get('/api/redirect/:dealId', async (req, res) => {
    const dealId = String(req.params.dealId || '').trim().slice(0, 128);
    if (!dealId) return res.status(400).json({ error: 'deal_id_required' });

    // Deal metadata comes from query params (encoded by buildBookingUrl)
    const origin = String(req.query.o || '').trim().toUpperCase().slice(0, 3);
    const destination = String(req.query.d || '').trim().toUpperCase().slice(0, 3);
    const departureDate = String(req.query.dep || '').trim().slice(0, 10) || null;
    const returnDate = String(req.query.ret || '').trim().slice(0, 10) || null;
    const price = Number(req.query.prc) || null;
    const cabinClass = String(req.query.cab || 'economy').trim();
    const tripType = String(req.query.tt || 'round_trip').trim();
    const dealType = String(req.query.dt || '').trim() || null;
    const dealConfidence = req.query.dc ? Number(req.query.dc) : null;
    const surface = String(req.query.surface || 'deal_feed').trim();

    if (!origin || !destination) {
      return res.status(400).json({ error: 'origin_and_destination_required' });
    }

    const deal = { origin, destination, departure_date: departureDate, return_date: returnDate, price, cabin_class: cabinClass };
    const { url: affiliateUrl, provider, estimated_commission } = generateAffiliateLink(deal);
    const sanitizedAffiliateUrl = sanitizeRedirectUrl(affiliateUrl);
    logger.info(
      {
        dealId,
        provider,
        origin,
        destination,
        affiliateUrl: sanitizedAffiliateUrl || 'invalid_url'
      },
      'redirect_destination_resolved'
    );

    // Hash PII for privacy-safe storage
    const ipRaw = String(req.ip || req.socket?.remoteAddress || '');
    const ipHash = ipRaw ? createHash('sha256').update(ipRaw).digest('hex').slice(0, 16) : null;
    const uaRaw = String(req.headers['user-agent'] || '');
    const uaHash = uaRaw ? createHash('sha256').update(uaRaw).digest('hex').slice(0, 16) : null;
    const userId = req.user?.sub || req.auth?.sub || null;
    const sessionId = req.sessionID || req.cookies?.sid || null;

    // Store click — fire-and-forget, never block the redirect
    initAffiliateClicksStore()
      .then(() =>
        insertAffiliateClick({
          dealId, provider, origin, destination,
          departureDate, returnDate, cabinClass, tripType,
          price, dealType, dealConfidence, estimatedCommission: estimated_commission,
          userId, sessionId, ipHash, userAgentHash: uaHash, surface,
          affiliateUrl
        })
      )
      .then(() => {
        logger.info(
          {
            dealId,
            provider,
            origin,
            destination,
            price
          },
          'redirect_tracked'
        );
      })
      .catch((err) => logger.warn({ err, dealId }, 'affiliate_click_insert_failed'));

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    logger.info(
      {
        dealId,
        provider,
        redirectStatus: 302,
        affiliateUrl: sanitizedAffiliateUrl || 'invalid_url'
      },
      'redirect_issued'
    );
    return res.redirect(302, affiliateUrl);
  });

  // ── Admin affiliate analytics ─────────────────────────────────────────────

  router.get('/api/admin/affiliate-stats', adminOrDevGuard, async (req, res) => {
    try {
      await initAffiliateClicksStore();
      const windowDays = Math.max(1, Math.min(365, Number(req.query.days || 30)));
      const stats = await getAffiliateStats(windowDays);
      return res.json({ ok: true, ...stats });
    } catch (error) {
      logger.error({ err: error }, 'affiliate_stats_failed');
      return res.status(500).json({ error: 'internal_error' });
    }
  });

  // ── Real-time live deals ──────────────────────────────────────────────────

  router.get('/api/engine/realtime-deals', authGuard, async (req, res) => {
    try {
      const limit = Math.max(1, Math.min(200, Number(req.query.limit || 50)));
      const origin = req.query.origin ? String(req.query.origin).trim().toUpperCase() : null;
      const minConfidence = Math.max(0, Number(req.query.min_confidence || 0));
      const minDelta = Math.max(0, Number(req.query.min_delta || 0));

      const rawDeals = await getLiveDeals({ limit, origin, minConfidence, minDelta });
      const { redisConnected, source } = readRealtimeCacheMeta();
      // Enrich live deals with booking_url + estimated_commission
      const deals = rawDeals.map((deal) => {
        const realtimeId = generateRealtimeId(deal);
        const { provider, estimated_commission } = generateAffiliateLink({
          origin: deal.origin, destination: deal.destination,
          departure_date: deal.departure_date, return_date: deal.return_date,
          price: deal.price
        });
        const booking_url = buildBookingUrl(deal.fingerprint || deal.observation_id || realtimeId, {
          origin: deal.origin, destination: deal.destination,
          departure_date: deal.departure_date, return_date: deal.return_date,
          price: deal.price, deal_type: deal.deal_type,
          deal_confidence: deal.deal_confidence
        });
        const safeBookingUrl = ensureInternalBookingUrl(
          booking_url,
          deal.fingerprint || deal.observation_id || realtimeId,
          {
            origin: deal.origin,
            destination: deal.destination,
            departure_date: deal.departure_date,
            return_date: deal.return_date,
            price: deal.price,
            deal_type: deal.deal_type,
            deal_confidence: deal.deal_confidence
          }
        );
        return { ...deal, realtime_id: realtimeId, booking_url: safeBookingUrl, provider, estimated_commission };
      });
      return res.json({
        deals,
        meta: {
          enabled: String(process.env.REALTIME_ANOMALY_ENABLED || 'true') !== 'false',
          redisConnected,
          source,
          reason: deals.length === 0 ? 'no_data' : 'ok'
        }
      });
    } catch (error) {
      logger.error({ err: error }, 'realtime_deals_failed');
      return res.status(500).json({ error: 'internal_error' });
    }
  });

  router.get('/api/engine/realtime-deals/stats', authGuard, async (_req, res) => {
    try {
      const stats = await getRealtimeStats();
      const { redisConnected, source } = readRealtimeCacheMeta();
      return res.json({ ok: true, ...stats, meta: { redisConnected, source } });
    } catch (error) {
      logger.error({ err: error }, 'realtime_stats_failed');
      return res.status(500).json({ error: 'internal_error' });
    }
  });

  // ── Multi-source search ────────────────────────────────────────────────────

  const multiSourceSchema = z.object({
    origin:          z.string().trim().length(3),
    destination:     z.string().trim().length(3),
    departure_date:  z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
    return_date:     z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    adults:          z.coerce.number().int().min(1).max(9).optional().default(1),
    cabin_class:     z.enum(['economy', 'premium', 'business', 'first']).optional().default('economy'),
    max_offers:      z.coerce.number().int().min(1).max(50).optional().default(20)
  }).strict();

  router.post('/api/engine/multi-source-search', internalIngestGuard, async (req, res) => {
    if (!isMultiSourceEnabled()) {
      return res.status(503).json({
        error: 'multi_source_search_disabled',
        hint: 'Set ENABLE_MULTI_SOURCE_SEARCH=true to activate this endpoint.'
      });
    }

    const parsed = multiSourceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload.' });
    }

    const { origin, destination, departure_date, return_date, adults, cabin_class, max_offers } = parsed.data;

    try {
      const result = await multiSourceSearch({
        originIata:      origin,
        destinationIata: destination,
        departureDate:   departure_date,
        returnDate:      return_date || null,
        adults,
        cabinClass:      cabin_class,
        maxOffers:       max_offers
      });

      return res.json({ ok: true, ...result });
    } catch (error) {
      logger.error({ err: error }, 'multi_source_search_endpoint_failed');
      return res.status(500).json({ error: 'internal_error' });
    }
  });

  router.get('/api/engine/provider-status', async (_req, res) => {
    try {
      const providers = getProviderStatus();
      const multiSourceOn = isMultiSourceEnabled();
      return res.json({
        ok: true,
        multi_source_enabled: multiSourceOn,
        providers
      });
    } catch (error) {
      logger.error({ err: error }, 'provider_status_failed');
      return res.status(500).json({ error: 'internal_error' });
    }
  });

  router.get('/api/dev/funnel-health', devOnlyGuard, async (_req, res) => {
    try {
      const providers = getProviderStatus();
      const activeProviders = providers.filter((item) => item.enabled && item.configured && !item.circuitOpen);
      const rawDeals = await getLiveDeals({ limit: 50 });
      const latestDeal = [...rawDeals]
        .sort((left, right) => new Date(String(right?.detected_at || 0)).getTime() - new Date(String(left?.detected_at || 0)).getTime())[0] || null;
      const realtime = await getRealtimeStats().catch(() => null);
      const cacheMeta = readRealtimeCacheMeta();
      const affiliate = getAffiliateConfig();
      const costMonitoring = await getCostCapMonitoringSnapshot().catch(() => null);

      if (costMonitoring?.alerts?.length) {
        logger.warn(
          {
            alerts: costMonitoring.alerts,
            suggestions: costMonitoring.suggestions || []
          },
          'cost_cap_monitoring_alerts'
        );
      }

      return res.json({
        ok: true,
        generated_at: new Date().toISOString(),
        providers: {
          active: activeProviders.map((item) => item.name),
          all: providers
        },
        realtime: {
          liveDealsCount: rawDeals.length,
          latestDeal: latestDeal
            ? {
                origin: latestDeal.origin,
                destination: latestDeal.destination,
                price: latestDeal.price,
                provider: latestDeal.provider,
                deal_type: latestDeal.deal_type,
                deal_confidence: latestDeal.deal_confidence,
                detected_at: latestDeal.detected_at
              }
            : null,
          stats: realtime
        },
        cache: cacheMeta,
        affiliate,
        monitoring: costMonitoring
          ? {
              calls_per_user: costMonitoring.callsPerUser,
              cost_per_user: costMonitoring.costPerUser,
              budget_used_percent: {
                provider_daily_calls: costMonitoring?.provider?.budgetUsedPercent || 0,
                ai_monthly_tokens: costMonitoring?.ai?.budgetUsedPercent || 0
              },
              throttling: {
                search_429: costMonitoring?.search?.throttled429 || 0
              },
              ctr_percent: costMonitoring?.monetization?.ctrPercent || 0,
              alerts: costMonitoring?.alerts || [],
              suggestions: costMonitoring?.suggestions || []
            }
          : null
      });
    } catch (error) {
      logger.error({ err: error }, 'dev_funnel_health_failed');
      return res.status(500).json({ error: 'internal_error' });
    }
  });

  router.get('/api/dev/last-telemetry', devOnlyGuard, async (req, res) => {
    try {
      const limit = Math.max(1, Math.min(100, Number(req.query.limit || 20)));
      const db = await readDb();
      const events = Array.isArray(db?.clientTelemetryEvents) ? db.clientTelemetryEvents : [];
      const latest = [...events]
        .sort((left, right) => new Date(String(right?.at || 0)).getTime() - new Date(String(left?.at || 0)).getTime())
        .slice(0, limit)
        .map((event) => ({
          at: event.at,
          eventType: event.eventType,
          dealId: event.dealId || null,
          routeSlug: event.routeSlug || null,
          price: event.price ?? null,
          sessionId: event.sessionId || null,
          userId: event.userId || null,
          source: event.source || null
        }));
      return res.json({ ok: true, count: latest.length, items: latest });
    } catch (error) {
      logger.error({ err: error }, 'dev_last_telemetry_failed');
      return res.status(500).json({ error: 'internal_error' });
    }
  });

  router.get('/api/admin/provider-coverage', adminOrDevGuard, async (req, res) => {
    try {
      const providers = getProviderStatus();
      const multiSourceOn = isMultiSourceEnabled();

      const activeProviders   = providers.filter((p) => p.enabled && p.configured && !p.circuitOpen);
      const disabledProviders = providers.filter((p) => !p.enabled);
      const circuitOpen       = providers.filter((p) => p.circuitOpen);
      const unconfigured      = providers.filter((p) => p.enabled && !p.configured);

      const windowDays = Math.min(90, Math.max(1, Number(req.query.days || 7)));
      const totalSearches = providers.reduce((s, p) => s + Number(p.totalSearches || 0), 0);
      const totalFailures = providers.reduce((s, p) => s + Number(p.failures     || 0), 0);

      return res.json({
        ok: true,
        generated_at:          new Date().toISOString(),
        window_days:           windowDays,
        multi_source_enabled:  multiSourceOn,
        summary: {
          total_providers:    providers.length,
          active:             activeProviders.length,
          disabled:           disabledProviders.length,
          circuit_open:       circuitOpen.length,
          unconfigured:       unconfigured.length,
          total_searches:     totalSearches,
          total_failures:     totalFailures,
          overall_error_rate: totalSearches > 0 ? Math.round((totalFailures / totalSearches) * 10000) / 100 : 0
        },
        providers,
        disabled_providers: disabledProviders.map((p) => ({
          name:   p.name,
          reason: !p.configured ? 'missing_api_key' : 'feature_flag_disabled'
        }))
      });
    } catch (error) {
      logger.error({ err: error }, 'provider_coverage_admin_failed');
      return res.status(500).json({ error: 'internal_error' });
    }
  });

  return router;
}
