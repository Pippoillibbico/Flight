import express from 'express';
import { triangulationIntakeSchema, triangulationSearchSchema } from './triangulation.schema.js';
import { createTriangulationService } from './triangulation.service.js';

function isFeatureEnabled() {
  return String(process.env.TRIANGULATION_ENABLED || 'true').trim().toLowerCase() !== 'false';
}

function createProviderSearchAdapter({ providerSearch, liveFlightService } = {}) {
  if (typeof providerSearch === 'function') return providerSearch;
  if (!liveFlightService?.searchLiveFlights) return null;
  return async ({ origin, destination, departureDate, travellers, cabinClass }) => {
    const result = await liveFlightService.searchLiveFlights({
      originIata: origin,
      destinations: [destination],
      departureDate,
      returnDate: null,
      adults: travellers,
      cabinClass,
      cacheOnly: false
    });
    const offer = result?.offersByDest?.[destination] || null;
    return offer ? { offers: [offer] } : { offers: [] };
  };
}

export function buildTriangulationRouter({
  authGuard,
  csrfGuard,
  requireApiScope,
  quotaGuard,
  providerSearch,
  liveFlightService,
  aiRunner,
  liveEnabled,
  limits
} = {}) {
  const router = express.Router();
  const service = createTriangulationService({
    providerSearch: createProviderSearchAdapter({ providerSearch, liveFlightService }),
    aiRunner,
    liveEnabled,
    limits
  });
  const maybeAuth = authGuard || ((_req, _res, next) => next());
  const maybeCsrf = csrfGuard || ((_req, _res, next) => next());
  const scope = typeof requireApiScope === 'function' ? requireApiScope('search') : (_req, _res, next) => next();
  const quota = typeof quotaGuard === 'function' ? quotaGuard({ counter: 'search', amount: 1 }) : (_req, _res, next) => next();

  router.post('/intake', maybeAuth, maybeCsrf, scope, quota, async (req, res, next) => {
    if (!isFeatureEnabled()) return res.status(503).json({ error: 'triangulation_disabled' });
    const parsed = triangulationIntakeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_payload', message: parsed.error.issues[0]?.message || 'Invalid payload.' });
    try {
      const payload = await service.intake(req, parsed.data);
      return res.json(payload);
    } catch (error) {
      next(error);
    }
  });

  router.post('/search', maybeAuth, maybeCsrf, scope, quota, async (req, res, next) => {
    if (!isFeatureEnabled()) return res.status(503).json({ error: 'triangulation_disabled' });
    const parsed = triangulationSearchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_payload', message: parsed.error.issues[0]?.message || 'Invalid payload.' });
    try {
      const payload = await service.search(req, parsed.data);
      return res.json(payload);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
