/**
 * routes/apikeys.js
 *
 * API key management: issue, list, revoke.
 * All endpoints require cookie-based auth (authGuard + csrfGuard).
 *
 * POST   /api/keys            — issue new key
 * GET    /api/keys            — list keys (no hashes)
 * DELETE /api/keys/:id        — revoke key
 */

import { Router } from 'express';
import { z } from 'zod';
import { getOrCreateSubscription, getUserApiKeys, issueApiKey, PLANS, revokeApiKey, rotateApiKey } from '../lib/saas-db.js';
import { appendImmutableAudit } from '../lib/audit-log.js';
import { anonymizeIpForLogs } from '../lib/log-redaction.js';

export function buildApiKeysRouter({ authGuard, csrfGuard }) {
  const router = Router();
  const requireSessionAuth = (req, res, next) => {
    if (req.apiKeyId) {
      return res.status(403).json({ error: 'auth_invalid', message: 'API keys cannot manage API keys.' });
    }
    return next();
  };

  const issueSchema = z.object({
    name: z.string().min(1).max(80).default('Default key'),
    scopes: z.array(z.enum(['read', 'search', 'alerts', 'export'])).min(1).default(['read', 'search'])
  }).strict();

  // POST /api/keys — issue a new key
  router.post('/', authGuard, requireSessionAuth, csrfGuard, async (req, res, next) => {
    try {
      const { name, scopes } = issueSchema.parse(req.body ?? {});
      const userId = req.user.id || req.user.sub;
      const sub = await getOrCreateSubscription(userId);
      const plan = PLANS[sub.planId] ?? PLANS.free;
      if (plan.apiKeysMax <= 0) {
        return res.status(403).json({ error: 'upgrade_required', message: 'API keys are available only on Creator/Pro plans.' });
      }

      let result;
      try {
        result = await issueApiKey(userId, { name, scopes, maxKeys: plan.apiKeysMax });
      } catch (issueErr) {
        if (issueErr.code === 'key_limit_reached') {
          return res.status(422).json({ error: `Maximum of ${plan.apiKeysMax} active API keys for current plan.` });
        }
        throw issueErr;
      }

      await appendImmutableAudit({
        actor: userId,
        action: 'api_key.issued',
        target: result.id,
        metadata: { name, scopes },
        ipHash: anonymizeIpForLogs(req.ip)
      }).catch(() => {});

      // rawKey is only returned once — never stored
      return res.status(201).json({
        id: result.id,
        name: result.name,
        prefix: result.key_prefix,
        scopes: result.scopes,
        quotaLimits: result.quota_limits || {},
        createdAt: result.created_at,
        // IMPORTANT: return the raw key only on creation — show it once
        rawKey: result.rawKey
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/keys — list keys (no raw keys or hashes)
  router.get('/', authGuard, requireSessionAuth, async (req, res, next) => {
    try {
      const keys = await getUserApiKeys(req.user.id || req.user.sub);
      return res.json({ keys });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/keys/:id — revoke
  router.delete('/:id', authGuard, requireSessionAuth, csrfGuard, async (req, res, next) => {
    try {
      const { id } = req.params;
      const revoked = await revokeApiKey(req.user.id || req.user.sub, id);
      if (!revoked) return res.status(404).json({ error: 'Key not found or already revoked.' });

      await appendImmutableAudit({
        actor: req.user.id || req.user.sub,
        action: 'api_key.revoked',
        target: id,
        ipHash: anonymizeIpForLogs(req.ip)
      }).catch(() => {});

      return res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/keys/:id/rotate — revoke old key and issue a new one with same scopes
  router.post('/:id/rotate', authGuard, requireSessionAuth, csrfGuard, async (req, res, next) => {
    try {
      const { id } = req.params;
      const rotated = await rotateApiKey(req.user.id || req.user.sub, id);
      if (!rotated) return res.status(404).json({ error: 'Key not found or already revoked.' });

      await appendImmutableAudit({
        actor: req.user.id || req.user.sub,
        action: 'api_key.rotated',
        target: id,
        ipHash: anonymizeIpForLogs(req.ip)
      }).catch(() => {});

      return res.status(201).json({
        id: rotated.id,
        name: rotated.name,
        prefix: rotated.key_prefix,
        scopes: rotated.scopes,
        quotaLimits: rotated.quota_limits || {},
        createdAt: rotated.created_at,
        rawKey: rotated.rawKey
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
