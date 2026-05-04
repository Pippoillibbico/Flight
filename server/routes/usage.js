/**
 * routes/usage.js
 *
 * Usage dashboard endpoints.
 *
 * GET /api/usage/summary    — credits used/remaining/total + plan info
 * GET /api/usage/history    — paginated recent usage events
 * GET /api/plans            — public list of all plans (no auth required)
 */

import { Router } from 'express';
import { z } from 'zod';
import { getUsageSnapshot, getUsageSummary, getUserUsageHistory, PLANS } from '../lib/saas-db.js';

const usageHistoryQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).optional().default(50)
  })
  .strict();

export function buildUsageRouter({ authGuard }) {
  const router = Router();
  const hasReadScope = (req) => !req.apiKeyId || (Array.isArray(req.apiScopes) && req.apiScopes.includes('read'));

  // Public plans list
  router.get('/plans', async (_req, res) => {
    const plans = Object.values(PLANS).map((p) => ({
      id: p.id,
      name: p.name,
      monthlyCredits: p.monthlyCredits,
      priceEur: p.priceEur,
      aiEnabled: p.aiEnabled,
      apiKeysMax: p.apiKeysMax,
      quotas: p.quotas,
      note: p.id === 'free' ? 'AI not included in free.' : undefined
    }));
    return res.json({ plans });
  });

  // Authenticated usage snapshot for current actor (session or API key)
  router.get('/me', authGuard, async (req, res, next) => {
    try {
      if (!hasReadScope(req)) {
        return res.status(403).json({ error: 'insufficient_scope', message: 'This API key is missing scope "read".' });
      }
      const userId = req.user?.id || req.user?.sub;
      const usage = await getUsageSnapshot(userId, { apiKeyId: req.apiKeyId || null });
      return res.json(usage);
    } catch (err) {
      next(err);
    }
  });

  // Usage summary (requires auth)
  router.get('/summary', authGuard, async (req, res, next) => {
    try {
      if (!hasReadScope(req)) {
        return res.status(403).json({ error: 'insufficient_scope', message: 'This API key is missing scope "read".' });
      }
      const summary = await getUsageSummary(req.user.id || req.user.sub);
      return res.json(summary);
    } catch (err) {
      next(err);
    }
  });

  // Usage history (requires auth)
  router.get('/history', authGuard, async (req, res, next) => {
    try {
      if (!hasReadScope(req)) {
        return res.status(403).json({ error: 'insufficient_scope', message: 'This API key is missing scope "read".' });
      }
      const parsed = usageHistoryQuerySchema.safeParse(req.query || {});
      if (!parsed.success) return res.status(400).json({ error: 'invalid_query', message: parsed.error.issues[0]?.message || 'Invalid query.' });
      const { limit } = parsed.data;
      const events = await getUserUsageHistory(req.user.id || req.user.sub, limit);
      return res.json({ events });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
