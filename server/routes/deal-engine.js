import express from 'express';
import { z } from 'zod';
import { ingestPriceObservation, initDealEngineStore, recomputeRouteBaselines, scoreDeal } from '../lib/deal-engine-store.js';
import { findCheapestWindows } from '../lib/window-finder-engine.js';
import { detectDealV2 } from '../lib/deal-detector.js';
import { evaluateObservationForAlerts } from '../lib/alert-intelligence.js';
import { getPriceDatasetStatus } from '../lib/price-history-store.js';
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
  metadata: z.record(z.string(), z.any()).optional()
});

const dealScoreSchema = z.object({
  origin: z.string().trim().length(3),
  destination: z.string().trim().length(3),
  departure_date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  price: z.coerce.number().positive()
});

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
});

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
});

const alertSimSchema = z.object({
  origin: z.string().trim().length(3),
  destination: z.string().trim().length(3),
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  price: z.coerce.number().positive(),
  targetPrice: z.coerce.number().positive().optional()
});

function extractToken(req) {
  const auth = String(req.headers.authorization || '').trim();
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return String(req.headers['x-internal-ingest-token'] || '').trim();
}

function internalIngestGuard(req, res, next) {
  const expected = String(process.env.INTERNAL_INGEST_TOKEN || '').trim();
  if (!expected) return res.status(503).json({ error: 'ingest_token_not_configured' });
  const provided = extractToken(req);
  if (!provided || provided !== expected) return res.status(401).json({ error: 'unauthorized' });
  return next();
}

function adminOrDevGuard(req, res, next) {
  if (process.env.NODE_ENV !== 'production') return next();
  const adminKey = String(process.env.ENGINE_ADMIN_KEY || '').trim();
  const provided = String(req.headers['x-engine-admin-key'] || '').trim();
  if (adminKey && provided && adminKey === provided) return next();
  return res.status(403).json({ error: 'request_forbidden' });
}

export function buildDealEngineRouter() {
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
          proprietaryLocalDefault: true
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

  router.post('/api/engine/windows', async (req, res) => {
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

  router.post('/api/engine/deals', async (req, res) => {
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
        deals.push({ ...item, ...evaluated });
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

  return router;
}
