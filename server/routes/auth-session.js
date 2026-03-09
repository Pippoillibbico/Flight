import { Router } from 'express';
import { getSaasPool } from '../lib/saas-db.js';
import { resolveUserPlan, setUserPlan } from '../lib/plan-access.js';

export function buildAuthSessionRouter({
  authGuard,
  csrfGuard,
  withDb,
  readDb,
  logAuthEvent,
  userIsLocked,
  onboardingCompleteSchema,
  revokeJwt,
  getRefreshTokenFromCookie,
  verifyRefreshToken,
  revokeRefreshFamily,
  ACCESS_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  authCookieOptions,
  ACCESS_COOKIE_TTL_MS,
  REFRESH_COOKIE_TTL_MS,
  AUTH_COOKIE_DOMAIN,
  sendMachineError,
  refreshCsrfGuard,
  logger,
  rotateRefreshSession,
  signRefreshToken,
  signAccessToken,
  speakeasy,
  QRCode,
  mfaCodeSchema
}) {
  const router = Router();

  router.get('/auth/me', authGuard, async (req, res) => {
    let user = null;
    await withDb(async (db) => {
      user = db.users.find((u) => u.id === req.user.sub) ?? null;
      return null;
    });

    if (!user) return res.status(404).json({ error: 'User not found.' });
    const plan = resolveUserPlan(user);
    return res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        mfaEnabled: Boolean(user.mfaEnabled),
        isPremium: Boolean(user.isPremium),
        planType: plan.planType,
        planStatus: plan.planStatus,
        onboardingDone: Boolean(user.onboardingDone),
        authChannel: String(user.authChannel || 'direct')
      },
      session: {
        cookie: req.authSource === 'cookie',
        csrfToken: req.user?.csrf || null
      },
      security: {
        lockUntil: user.lockUntil || null,
        failedLoginCount: Number.isFinite(user.failedLoginCount) ? user.failedLoginCount : 0,
        isLocked: userIsLocked(user)
      }
    });
  });

  router.post('/user/onboarding/complete', authGuard, csrfGuard, async (req, res) => {
    const parsed = onboardingCompleteSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid onboarding payload.' });

    let updated = null;
    await withDb(async (db) => {
      const user = db.users.find((item) => item.id === req.user.sub);
      if (!user) return db;
      user.onboardingDone = true;
      user.onboardingProfile = {
        ...(user.onboardingProfile || {}),
        ...parsed.data,
        completedAt: new Date().toISOString()
      };
      updated = user;
      return db;
    });
    if (!updated) return res.status(404).json({ error: 'User not found.' });
    return res.json({ ok: true, user: { onboardingDone: true, onboardingProfile: updated.onboardingProfile } });
  });

  router.post('/billing/upgrade-demo', authGuard, csrfGuard, async (req, res) => {
    let user = null;
    await withDb(async (db) => {
      user = db.users.find((item) => item.id === req.user.sub) || null;
      if (!user) return db;
      setUserPlan(user, 'pro');
      return db;
    });
    if (!user) return res.status(404).json({ error: 'User not found.' });
    await logAuthEvent({ userId: user.id, email: user.email, type: 'billing_upgrade_demo', success: true, req });
    const plan = resolveUserPlan(user);
    return res.json({ ok: true, isPremium: true, planType: plan.planType, planStatus: plan.planStatus });
  });

  router.post('/upgrade/pro', authGuard, csrfGuard, async (req, res) => {
    let user = null;
    await withDb(async (db) => {
      user = db.users.find((item) => item.id === req.user.sub) || null;
      if (!user) return db;
      setUserPlan(user, 'pro');
      return db;
    });
    if (!user) return res.status(404).json({ error: 'User not found.' });
    const plan = resolveUserPlan(user);
    await logAuthEvent({ userId: user.id, email: user.email, type: 'billing_upgrade_pro_mock', success: true, req });
    return res.json({ ok: true, planType: plan.planType, planStatus: plan.planStatus, isPremium: true });
  });

  router.post('/upgrade/elite', authGuard, csrfGuard, async (req, res) => {
    let user = null;
    await withDb(async (db) => {
      user = db.users.find((item) => item.id === req.user.sub) || null;
      if (!user) return db;
      setUserPlan(user, 'elite');
      return db;
    });
    if (!user) return res.status(404).json({ error: 'User not found.' });
    const plan = resolveUserPlan(user);
    await logAuthEvent({ userId: user.id, email: user.email, type: 'billing_upgrade_elite_mock', success: true, req });
    return res.json({ ok: true, planType: plan.planType, planStatus: plan.planStatus, isPremium: true });
  });

  router.post('/auth/logout', authGuard, csrfGuard, async (req, res) => {
    await revokeJwt(req.user);
    const refreshCookie = getRefreshTokenFromCookie(req);
    if (refreshCookie) {
      try {
        const refreshPayload = verifyRefreshToken(refreshCookie);
        await revokeRefreshFamily(refreshPayload.family, 'logout');
      } catch {}
    }
    res.clearCookie(ACCESS_COOKIE_NAME, {
      httpOnly: true,
      sameSite: 'lax',
      secure: authCookieOptions(req, ACCESS_COOKIE_TTL_MS).secure,
      path: '/',
      ...(AUTH_COOKIE_DOMAIN ? { domain: AUTH_COOKIE_DOMAIN } : {})
    });
    res.clearCookie(REFRESH_COOKIE_NAME, {
      httpOnly: true,
      sameSite: 'lax',
      secure: authCookieOptions(req, REFRESH_COOKIE_TTL_MS).secure,
      path: '/',
      ...(AUTH_COOKIE_DOMAIN ? { domain: AUTH_COOKIE_DOMAIN } : {})
    });
    return res.status(204).send();
  });

  router.delete('/auth/account', authGuard, csrfGuard, async (req, res) => {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'Authentication required.' });

    let userEmail = '';
    await withDb(async (db) => {
      const user = (db.users || []).find((item) => item.id === userId) || null;
      userEmail = user?.email || '';

      const cleanByUser = (list, keys = ['userId', 'user_id']) =>
        (Array.isArray(list) ? list : []).filter((item) => !keys.some((key) => item?.[key] === userId));

      db.users = (db.users || []).filter((item) => item.id !== userId);
      db.watchlists = cleanByUser(db.watchlists);
      db.searches = cleanByUser(db.searches);
      db.alertSubscriptions = cleanByUser(db.alertSubscriptions);
      db.notifications = cleanByUser(db.notifications);
      db.authEvents = cleanByUser(db.authEvents);
      db.outboundClicks = cleanByUser(db.outboundClicks);
      db.outboundRedirects = cleanByUser(db.outboundRedirects);
      db.refreshSessions = cleanByUser(db.refreshSessions);
      db.mfaChallenges = cleanByUser(db.mfaChallenges);
      db.oauthSessions = cleanByUser(db.oauthSessions);
      db.apiKeys = cleanByUser(db.apiKeys);
      db.userSubscriptions = cleanByUser(db.userSubscriptions);
      db.monthlyQuotas = cleanByUser(db.monthlyQuotas);
      db.usageEvents = cleanByUser(db.usageEvents);
      db.usageCounters = cleanByUser(db.usageCounters);
      db.passwordResetTokens = cleanByUser(db.passwordResetTokens);
      db.freeAlerts = cleanByUser(db.freeAlerts);
      db.freePrecomputedRankings = cleanByUser(db.freePrecomputedRankings);
      db.freeTravelScores = cleanByUser(db.freeTravelScores);
      db.freeAlertSignals = cleanByUser(db.freeAlertSignals);
      db.alertIntelligenceDedupe = cleanByUser(db.alertIntelligenceDedupe);
      db.revokedTokens = cleanByUser(db.revokedTokens);
      return db;
    });

    const pool = getSaasPool();
    if (pool) {
      const tablesByUserId = [
        'usage_events',
        'usage_counters',
        'api_keys',
        'monthly_quotas',
        'user_subscriptions',
        'free_alerts',
        'discovery_alert_subscriptions',
        'discovery_notification_dedupe',
        'auth_events',
        'notifications',
        'watchlists',
        'search_events',
        'user_leads',
        'email_delivery_log'
      ];
      for (const tableName of tablesByUserId) {
        try {
          await pool.query(`DELETE FROM ${tableName} WHERE user_id = $1`, [userId]);
        } catch (error) {
          logger.warn(
            {
              request_id: req.id || null,
              user_id: userId,
              table: tableName,
              error: error?.message || 'delete_failed'
            },
            'account_delete_table_skip'
          );
        }
      }
    }

    await revokeJwt(req.user);
    const refreshCookie = getRefreshTokenFromCookie(req);
    if (refreshCookie) {
      try {
        const refreshPayload = verifyRefreshToken(refreshCookie);
        await revokeRefreshFamily(refreshPayload.family, 'account_deleted');
      } catch {}
    }

    res.clearCookie(ACCESS_COOKIE_NAME, {
      httpOnly: true,
      sameSite: 'lax',
      secure: authCookieOptions(req, ACCESS_COOKIE_TTL_MS).secure,
      path: '/',
      ...(AUTH_COOKIE_DOMAIN ? { domain: AUTH_COOKIE_DOMAIN } : {})
    });
    res.clearCookie(REFRESH_COOKIE_NAME, {
      httpOnly: true,
      sameSite: 'lax',
      secure: authCookieOptions(req, REFRESH_COOKIE_TTL_MS).secure,
      path: '/',
      ...(AUTH_COOKIE_DOMAIN ? { domain: AUTH_COOKIE_DOMAIN } : {})
    });

    await logAuthEvent({
      userId,
      email: userEmail,
      type: 'account_deleted',
      success: true,
      req
    });
    return res.json({ ok: true });
  });

  router.post('/auth/refresh', async (req, res) => {
    const refreshToken = getRefreshTokenFromCookie(req);
    if (!refreshToken) return res.status(401).json({ error: 'Missing refresh token.' });

    let payload = null;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      return res.status(401).json({ error: 'Invalid refresh token.' });
    }

    const csrfCheck = refreshCsrfGuard(req, payload);
    if (!csrfCheck.ok) return sendMachineError(req, res, 403, csrfCheck.code || 'csrf_failed');

    const nowSec = Math.floor(Date.now() / 1000);
    const db = await readDb();
    const session = (db.refreshSessions || []).find((item) => item.jti === payload.jti && item.userId === payload.sub);

    if (!session || session.revokedAt || (Number.isFinite(session.exp) && session.exp <= nowSec)) {
      if (payload.family) await revokeRefreshFamily(payload.family, 'reuse_or_invalid');
      logger.warn(
        {
          request_id: req.id || null,
          method: req.method,
          path: req.originalUrl || req.url,
          status: 401,
          user_id: payload.sub || null,
          family: payload.family || null
        },
        'security_refresh_reuse_or_invalid'
      );
      await logAuthEvent({
        userId: payload.sub || null,
        email: '',
        type: 'refresh_rejected',
        success: false,
        req,
        detail: 'missing/revoked/expired refresh session'
      });
      return res.status(401).json({ error: 'Refresh session invalidated.' });
    }

    let user = null;
    await withDb(async (state) => {
      user = state.users.find((item) => item.id === payload.sub) || null;
      return null;
    });
    if (!user) return res.status(401).json({ error: 'User not found.' });

    const nextRefreshToken = signRefreshToken({ sub: user.id, family: payload.family, csrf: payload.csrf });
    const nextPayload = verifyRefreshToken(nextRefreshToken);
    const rotated = await rotateRefreshSession({
      oldJti: payload.jti,
      newJti: nextPayload.jti,
      userId: user.id,
      family: payload.family,
      exp: Number(nextPayload.exp || 0)
    });
    if (!rotated) {
      await revokeRefreshFamily(payload.family, 'reuse_detected');
      logger.warn(
        {
          request_id: req.id || null,
          method: req.method,
          path: req.originalUrl || req.url,
          status: 401,
          user_id: payload.sub || null,
          family: payload.family || null
        },
        'security_refresh_reuse_detected'
      );
      return res.status(401).json({ error: 'Refresh token reuse detected. Session family revoked.' });
    }

    const authChannel = String(payload.authChannel || user.authChannel || 'direct');
    user.authChannel = authChannel;
    const accessToken = signAccessToken({
      sub: user.id,
      email: user.email,
      name: user.name,
      csrf: payload.csrf,
      amr: user.mfaEnabled ? ['pwd', 'otp'] : ['pwd'],
      authChannel
    });
    res.cookie(ACCESS_COOKIE_NAME, accessToken, authCookieOptions(req, ACCESS_COOKIE_TTL_MS));
    res.cookie(REFRESH_COOKIE_NAME, nextRefreshToken, authCookieOptions(req, REFRESH_COOKIE_TTL_MS));
    await logAuthEvent({
      userId: user.id,
      email: user.email,
      type: 'refresh_rotated',
      success: true,
      req
    });
    return res.json({
      token: accessToken,
      session: { cookie: true, csrfToken: payload.csrf },
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        mfaEnabled: Boolean(user.mfaEnabled),
        isPremium: Boolean(user.isPremium),
        planType: resolveUserPlan(user).planType,
        planStatus: resolveUserPlan(user).planStatus,
        onboardingDone: Boolean(user.onboardingDone),
        authChannel
      }
    });
  });

  router.post('/auth/mfa/setup', authGuard, csrfGuard, async (req, res) => {
    let user = null;
    const issuer = process.env.MFA_ISSUER || 'FlightSuite';
    const generated = speakeasy.generateSecret({
      name: req.user?.email || 'flight-user',
      issuer
    });
    const tempSecret = generated.base32;
    await withDb(async (db) => {
      user = db.users.find((item) => item.id === req.user.sub) || null;
      if (!user) return db;
      user.mfaTempSecret = tempSecret;
      user.mfaTempCreatedAt = new Date().toISOString();
      return db;
    });
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const otpAuthUrl = generated.otpauth_url;
    const qrDataUrl = await QRCode.toDataURL(otpAuthUrl);
    await logAuthEvent({
      userId: user.id,
      email: user.email,
      type: 'mfa_setup_started',
      success: true,
      req
    });
    return res.json({ qrDataUrl, manualKey: tempSecret });
  });

  router.post('/auth/mfa/enable', authGuard, csrfGuard, async (req, res) => {
    const parsed = mfaCodeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid MFA code payload.' });

    let user = null;
    let success = false;
    await withDb(async (db) => {
      user = db.users.find((item) => item.id === req.user.sub) || null;
      if (!user || !user.mfaTempSecret) return db;
      const valid = speakeasy.totp.verify({
        secret: user.mfaTempSecret,
        encoding: 'base32',
        token: parsed.data.code,
        window: 1
      });
      if (!valid) return db;
      user.mfaSecret = user.mfaTempSecret;
      user.mfaTempSecret = null;
      user.mfaTempCreatedAt = null;
      user.mfaEnabled = true;
      success = true;
      return db;
    });

    if (!user) return res.status(404).json({ error: 'User not found.' });
    if (!success) {
      await logAuthEvent({ userId: user.id, email: user.email, type: 'mfa_enable_failed', success: false, req });
      return res.status(400).json({ error: 'Invalid MFA code.' });
    }

    await logAuthEvent({ userId: user.id, email: user.email, type: 'mfa_enabled', success: true, req });
    return res.json({ ok: true, mfaEnabled: true });
  });

  router.post('/auth/mfa/disable', authGuard, csrfGuard, async (req, res) => {
    const parsed = mfaCodeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid MFA code payload.' });

    let user = null;
    let success = false;
    await withDb(async (db) => {
      user = db.users.find((item) => item.id === req.user.sub) || null;
      if (!user || !user.mfaEnabled || !user.mfaSecret) return db;
      const valid = speakeasy.totp.verify({
        secret: user.mfaSecret,
        encoding: 'base32',
        token: parsed.data.code,
        window: 1
      });
      if (!valid) return db;
      user.mfaEnabled = false;
      user.mfaSecret = null;
      user.mfaTempSecret = null;
      user.mfaTempCreatedAt = null;
      success = true;
      return db;
    });

    if (!user) return res.status(404).json({ error: 'User not found.' });
    if (!success) {
      await logAuthEvent({ userId: user.id, email: user.email, type: 'mfa_disable_failed', success: false, req });
      return res.status(400).json({ error: 'Invalid MFA code.' });
    }

    await logAuthEvent({ userId: user.id, email: user.email, type: 'mfa_disabled', success: true, req });
    return res.json({ ok: true, mfaEnabled: false });
  });

  return router;
}
