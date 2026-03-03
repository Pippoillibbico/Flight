import express from 'express';
import { z } from 'zod';
import { ingestPriceObservation, initDealEngineStore, recomputeRouteBaselines, scoreDeal } from '../lib/deal-engine-store.js';
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

export function buildDealEngineRouter() {
  const router = express.Router();

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
