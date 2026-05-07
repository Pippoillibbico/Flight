import { Router } from 'express';
import { applyEmailPreferenceUpdate, normalizeEmailPreferences } from '../lib/email/email-preferences.js';

export function buildEmailPreferencesRouter({ authGuard, csrfGuard, withDb }) {
  const router = Router();

  router.get('/preferences/email', authGuard, async (req, res) => {
    let preferences = null;
    await withDb((db) => {
      const user = (db.users || []).find((item) => item.id === req.user?.id) || null;
      preferences = normalizeEmailPreferences(user?.emailPreferences);
      return db;
    });
    return res.json({ preferences });
  });

  router.put('/preferences/email', authGuard, csrfGuard, async (req, res) => {
    let preferences = null;
    await withDb((db) => {
      const user = (db.users || []).find((item) => item.id === req.user?.id) || null;
      if (!user) return db;
      preferences = applyEmailPreferenceUpdate(user, req.body || {}, {
        actor: req.user?.id || 'user',
        source: 'api'
      });
      return db;
    });
    if (!preferences) return res.status(404).json({ error: 'user_not_found' });
    return res.json({ preferences });
  });

  return router;
}
