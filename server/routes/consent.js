import { Router } from 'express';
import { z } from 'zod';

const consentUpdateSchema = z
  .object({
    categories: z
      .object({
        analytics: z.coerce.boolean().optional().default(false),
        marketing: z.coerce.boolean().optional().default(false),
        personalization: z.coerce.boolean().optional().default(false)
      })
      .strict()
  })
  .strict();

export function buildConsentRouter({
  consentService,
  appendImmutableAudit,
  sendMachineError,
  isTrustedOrigin,
  resolveRequestAuthToken,
  accessCookieName,
  csrfGuard
}) {
  const router = Router();

  function attachOptionalAuthSource(req, _res, next) {
    try {
      if (req?.user && !req.authSource && typeof resolveRequestAuthToken === 'function') {
        const resolved = resolveRequestAuthToken(req, accessCookieName);
        req.authSource = resolved?.source || req.authSource || null;
      }
    } catch {}
    return next();
  }

  function enforceTrustedOrigin(req, res, next) {
    if (typeof isTrustedOrigin !== 'function') return next();
    if (isTrustedOrigin(req)) return next();
    return sendMachineError(req, res, 403, 'request_forbidden');
  }

  function enforceCsrfForAuthenticatedCookieSession(req, res, next) {
    if (!req?.user) return next();
    if (typeof csrfGuard !== 'function') return next();
    return csrfGuard(req, res, next);
  }

  router.get('/api/consent', async (req, res, next) => {
    try {
      const { consent } = await consentService.getConsentForRequest(req, res, { ensureAnonymousId: true });
      const categories = consent?.categories || consentService.normalizeCategories(null);
      return res.json({
        ok: true,
        consent: {
          categories,
          version: consent?.version || consentService.policyVersion,
          timestamp: consent?.timestamp || null
        }
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/api/consent', attachOptionalAuthSource, enforceTrustedOrigin, enforceCsrfForAuthenticatedCookieSession, async (req, res, next) => {
    try {
      const parsed = consentUpdateSchema.safeParse(req.body || {});
      if (!parsed.success) return sendMachineError(req, res, 400, 'invalid_payload');

      const saved = await consentService.saveConsentForRequest(req, res, parsed.data.categories);
      if (!saved) return sendMachineError(req, res, 400, 'invalid_payload');

      if (typeof appendImmutableAudit === 'function') {
        await appendImmutableAudit({
          actorId: saved.userId || saved.anonymousId || null,
          action: 'consent_updated',
          categories: saved.categories,
          version: saved.version,
          timestamp: saved.timestamp,
          ipHash: saved.ipHash || null
        }).catch(() => {});
      }

      return res.status(200).json({
        ok: true,
        consent: {
          categories: saved.categories,
          version: saved.version,
          timestamp: saved.timestamp
        }
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
