export function createAuthRuntime({
  constants,
  deps
}) {
  const {
    ACCESS_COOKIE_NAME,
    REFRESH_COOKIE_NAME,
    OAUTH_BINDING_COOKIE_NAME,
    ACCESS_COOKIE_TTL_MS,
    REFRESH_COOKIE_TTL_MS,
    AUTH_COOKIE_DOMAIN,
    AUTH_RETURN_ACCESS_TOKEN,
    NODE_ENV,
    OAUTH_SESSION_TTL_SECONDS,
    FRONTEND_URL,
    LOGIN_MAX_FAILURES,
    LOGIN_LOCK_MINUTES,
    CORS_ALLOWLIST,
    ADMIN_ALLOWLIST_EMAILS,
    ADMIN_DASHBOARD_ENABLED
  } = constants;

  const {
    withDb,
    readDb,
    nanoid,
    randomBytes,
    createHash,
    getCookies,
    readAccessTokenFromCookie,
    readRefreshTokenFromCookie,
    resolveRequestAuthToken,
    verifyAccessToken,
    verifyRefreshToken,
    signAccessToken,
    signRefreshToken,
    appendImmutableAudit,
    hashValueForLogs,
    anonymizeIpForLogs,
    redactUrlForLogs,
    logger,
    sendMachineError,
    upsertUserLead,
    getOrCreateSubscription,
    resolveUserPlan,
    canUseAITravel,
    getUpgradeContext
  } = deps;

  function getAccessTokenFromCookie(req) {
    return readAccessTokenFromCookie(req, ACCESS_COOKIE_NAME);
  }

  function getRefreshTokenFromCookie(req) {
    return readRefreshTokenFromCookie(req, REFRESH_COOKIE_NAME);
  }

  function getAuthToken(req) {
    return resolveRequestAuthToken(req, ACCESS_COOKIE_NAME);
  }

  function isSecureRequest(req) {
    return Boolean(req.secure);
  }

  function authCookieOptions(req, maxAgeMs) {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: Boolean(isSecureRequest(req) || NODE_ENV === 'production'),
      path: '/',
      maxAge: maxAgeMs,
      ...(AUTH_COOKIE_DOMAIN ? { domain: AUTH_COOKIE_DOMAIN } : {})
    };
  }

  async function isRevokedJti(jti) {
    if (!jti) return false;
    const db = await readDb();
    const nowSec = Math.floor(Date.now() / 1000);
    return (db.revokedTokens || []).some((entry) => entry.jti === jti && (!Number.isFinite(entry.exp) || entry.exp > nowSec));
  }

  async function revokeJwt(payload) {
    if (!payload?.jti) return;
    await withDb(async (db) => {
      const nowSec = Math.floor(Date.now() / 1000);
      db.revokedTokens = (db.revokedTokens || []).filter((entry) => !Number.isFinite(entry.exp) || entry.exp > nowSec);
      db.revokedTokens.push({
        id: nanoid(10),
        jti: payload.jti,
        exp: Number.isFinite(payload.exp) ? payload.exp : nowSec + 7 * 24 * 60 * 60,
        revokedAt: new Date().toISOString()
      });
      db.revokedTokens = db.revokedTokens.slice(-5000);
      return db;
    });
  }

  async function createRefreshSession({ userId, family, jti, exp }) {
    await withDb(async (db) => {
      db.refreshSessions = (db.refreshSessions || []).filter((s) => !s.exp || s.exp > Math.floor(Date.now() / 1000));
      db.refreshSessions.push({
        id: nanoid(10),
        userId,
        family,
        jti,
        exp,
        issuedAt: new Date().toISOString(),
        revokedAt: null,
        rotatedTo: null
      });
      db.refreshSessions = db.refreshSessions.slice(-10000);
      return db;
    });
  }

  async function revokeRefreshFamily(family, reason = 'manual') {
    await withDb(async (db) => {
      for (const session of db.refreshSessions || []) {
        if (session.family === family && !session.revokedAt) {
          session.revokedAt = new Date().toISOString();
          session.revokeReason = reason;
        }
      }
      return db;
    });
  }

  async function rotateRefreshSession({ oldJti, newJti, userId, family, exp }) {
    const nowSec = Math.floor(Date.now() / 1000);
    let result = { ok: false, reason: 'not_found' };
    await withDb(async (db) => {
      const oldSession = (db.refreshSessions || []).find((session) => session.jti === oldJti) || null;
      if (!oldSession || oldSession.userId !== userId || oldSession.family !== family) {
        result = { ok: false, reason: 'not_found' };
        return db;
      }
      if (oldSession.revokedAt) {
        result = { ok: false, reason: 'reused' };
        return db;
      }
      if (Number.isFinite(oldSession.exp) && oldSession.exp <= nowSec) {
        result = { ok: false, reason: 'expired' };
        return db;
      }
      oldSession.revokedAt = new Date().toISOString();
      oldSession.rotatedTo = newJti;
      db.refreshSessions.push({
        id: nanoid(10),
        userId,
        family,
        jti: newJti,
        exp,
        issuedAt: new Date().toISOString(),
        revokedAt: null,
        rotatedTo: null
      });
      db.refreshSessions = db.refreshSessions.slice(-10000);
      result = { ok: true, reason: null };
      return db;
    });
    return result;
  }

  function optionalAuth(req) {
    try {
      const { token } = getAuthToken(req);
      if (!token) return null;
      return verifyAccessToken(token);
    } catch {
      return null;
    }
  }

  function isTrustedOrigin(req) {
    const origin = String(req.headers.origin || '').trim();
    if (origin) return CORS_ALLOWLIST.has(origin);
    const referer = String(req.headers.referer || '').trim();
    if (!referer) return false;
    try {
      const refererOrigin = new URL(referer).origin;
      return CORS_ALLOWLIST.has(refererOrigin);
    } catch {
      return false;
    }
  }

  function userIsLocked(user) {
    if (!user?.lockUntil) return false;
    const lockTs = new Date(user.lockUntil).getTime();
    return Number.isFinite(lockTs) && lockTs > Date.now();
  }

  function resetUserLoginFailures(user) {
    user.failedLoginCount = 0;
    user.lockUntil = null;
  }

  function registerFailedLogin(user) {
    const nextCount = Number.isFinite(user.failedLoginCount) ? user.failedLoginCount + 1 : 1;
    user.failedLoginCount = nextCount;
    if (nextCount >= LOGIN_MAX_FAILURES) {
      const lockUntil = new Date();
      lockUntil.setMinutes(lockUntil.getMinutes() + LOGIN_LOCK_MINUTES);
      user.lockUntil = lockUntil.toISOString();
      user.failedLoginCount = 0;
    }
  }

  function getClientIp(req) {
    const ip = String(req.ip || req.socket?.remoteAddress || '').trim();
    return ip || 'unknown';
  }

  function hashPasswordResetToken(token) {
    return createHash('sha256').update(String(token || '')).digest('hex');
  }

  function buildPasswordResetUrl(rawToken) {
    const base = process.env.PASSWORD_RESET_URL || `${FRONTEND_URL}/`;
    const url = new URL(base);
    url.searchParams.set('reset_token', rawToken);
    return url.toString();
  }

  function hashEmailVerifyToken(token) {
    return createHash('sha256').update(`email_verify:${String(token || '')}`).digest('hex');
  }

  function buildEmailVerifyUrl(rawToken) {
    const base = process.env.EMAIL_VERIFY_URL || `${FRONTEND_URL}/`;
    const url = new URL(base);
    url.searchParams.set('verify_token', rawToken);
    return url.toString();
  }

  async function logAuthEvent({ userId = null, email = '', type, success, req, detail = '' }) {
    const normalizedEmail = String(email || '').toLowerCase().trim();
    const event = {
      id: nanoid(10),
      at: new Date().toISOString(),
      userId,
      emailHash: normalizedEmail ? hashValueForLogs(normalizedEmail, { label: 'email', length: 24 }) : null,
      type,
      success: Boolean(success),
      ipHash: anonymizeIpForLogs(getClientIp(req)),
      userAgent: String(req.headers['user-agent'] || '').slice(0, 220),
      detail
    };

    await withDb(async (db) => {
      db.authEvents.push(event);
      db.authEvents = db.authEvents.slice(-3000);
      return db;
    });
    appendImmutableAudit({
      category: 'auth_event',
      userId,
      emailHash: event.emailHash,
      type,
      success: Boolean(success),
      ipHash: event.ipHash,
      detail
    }).catch(() => {});
  }

  async function ensureAiPremiumAccess(req, aiProvider) {
    const provider = String(aiProvider || 'none').toLowerCase();
    if (provider === 'none') return { allowed: true };
    const userId = req.user?.id || req.user?.sub;
    if (!userId) return { allowed: false, status: 401, error: 'auth_required' };
    const sub = await getOrCreateSubscription(userId);
    const planId = String(sub?.planId || 'free').toLowerCase();
    if (planId !== 'creator') {
      return {
        allowed: false,
        status: 402,
        error: 'premium_required',
        extra: {
          message: 'AI decision workflows are available on the Elite plan.',
          upgrade_context: 'ai_travel_limit'
        }
      };
    }
    return { allowed: true };
  }

  async function authGuard(req, res, next) {
    try {
      if (req.user?.id || req.user?.sub) {
        if (!req.authSource) req.authSource = req.apiKeyId ? 'api_key' : 'bearer';
        return next();
      }
      const { token, source } = getAuthToken(req);
      if (!token) return sendMachineError(req, res, 401, 'auth_required');

      const payload = verifyAccessToken(token);
      if (await isRevokedJti(payload.jti)) {
        logger.warn(
          {
            request_id: req.id || null,
            method: req.method,
            path: redactUrlForLogs(req.originalUrl || req.url, { maxLength: 220 }),
            status: 401,
            user_id: payload.sub || null
          },
          'security_token_revoked'
        );
        return sendMachineError(req, res, 401, 'token_revoked');
      }
      req.user = payload;
      req.authToken = token;
      req.authSource = source;
      return next();
    } catch {
      return sendMachineError(req, res, 401, 'auth_invalid');
    }
  }

  function isAdminEmail(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return false;
    return ADMIN_ALLOWLIST_EMAILS.has(normalized);
  }

  function adminGuard(req, res, next) {
    if (!ADMIN_DASHBOARD_ENABLED) return sendMachineError(req, res, 404, 'admin_not_enabled');
    if (isAdminEmail(req.user?.email)) return next();
    return sendMachineError(req, res, 403, 'admin_access_denied');
  }

  function requireSessionAuth(req, res, next) {
    if (req.authSource === 'cookie') return next();
    return sendMachineError(req, res, 403, 'session_auth_required');
  }

  function csrfGuard(req, res, next) {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    if (req.authSource !== 'cookie') return next();
    if (!isTrustedOrigin(req)) return sendMachineError(req, res, 403, 'request_forbidden');

    const csrfHeader = String(req.headers['x-csrf-token'] || '').trim();
    const csrfClaim = String(req.user?.csrf || '').trim();
    if (!csrfHeader || !csrfClaim || csrfHeader !== csrfClaim) {
      return sendMachineError(req, res, 403, 'csrf_failed');
    }
    return next();
  }

  async function fetchCurrentUser(userId) {
    let user = null;
    await withDb(async (db) => {
      user = db.users.find((item) => item.id === userId) || null;
      return null;
    });
    return user;
  }

  async function premiumGuard(req, res, next) {
    const user = await fetchCurrentUser(req.user.sub);
    if (!user) return sendMachineError(req, res, 404, 'user_not_found');
    if (!canUseAITravel(user)) {
      return sendMachineError(req, res, 402, 'premium_required', {
        message: 'AI travel insights are available on the Elite plan.',
        upgrade_context: getUpgradeContext(user, 'ai_travel')
      });
    }
    req.currentUser = user;
    return next();
  }

  async function issueSessionTokens({ req, res, user, csrfToken, family }) {
    const authChannel = String(user.authChannel || 'direct');
    const accessToken = signAccessToken({
      sub: user.id,
      email: user.email,
      name: user.name,
      csrf: csrfToken,
      amr: user.mfaEnabled ? ['pwd', 'otp'] : ['pwd'],
      authChannel
    });
    const decodedAccess = verifyAccessToken(accessToken);
    const refreshToken = signRefreshToken({ sub: user.id, family, csrf: csrfToken, authChannel });
    const decodedRefresh = verifyRefreshToken(refreshToken);

    await createRefreshSession({
      userId: user.id,
      family,
      jti: decodedRefresh.jti,
      exp: Number(decodedRefresh.exp || 0)
    });

    res.cookie(ACCESS_COOKIE_NAME, accessToken, authCookieOptions(req, ACCESS_COOKIE_TTL_MS));
    res.cookie(REFRESH_COOKIE_NAME, refreshToken, authCookieOptions(req, REFRESH_COOKIE_TTL_MS));
    return {
      accessToken,
      refreshToken,
      decodedAccess,
      decodedRefresh
    };
  }

  function buildSessionResponsePayload(accessToken, payload) {
    if (AUTH_RETURN_ACCESS_TOKEN) return { token: accessToken, ...payload };
    return payload;
  }

  function refreshCsrfGuard(req, payload) {
    const origin = String(req.headers.origin || '').trim();
    if (!origin || !isTrustedOrigin(req)) return { ok: false, code: 'request_forbidden' };
    const csrfHeader = String(req.headers['x-csrf-token'] || '').trim();
    if (!csrfHeader || csrfHeader !== String(payload?.csrf || '')) return { ok: false, code: 'csrf_failed' };
    return { ok: true };
  }

  function toBase64Url(input) {
    return Buffer.from(input)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }

  function hashOAuthBindingToken(rawToken) {
    return createHash('sha256').update(String(rawToken || '')).digest('hex');
  }

  function getOAuthBindingToken(req) {
    const cookies = getCookies(req);
    return String(cookies[OAUTH_BINDING_COOKIE_NAME] || '').trim();
  }

  function oauthBindingCookieOptions(req, maxAgeMs) {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: Boolean(isSecureRequest(req) || NODE_ENV === 'production'),
      path: '/api/auth/oauth',
      maxAge: maxAgeMs,
      ...(AUTH_COOKIE_DOMAIN ? { domain: AUTH_COOKIE_DOMAIN } : {})
    };
  }

  function ensureOAuthBrowserBinding(req, res) {
    const safeTtlMs = Math.max(60, Math.min(900, OAUTH_SESSION_TTL_SECONDS)) * 1000;
    let bindingToken = getOAuthBindingToken(req);
    if (!bindingToken || bindingToken.length < 24) {
      bindingToken = toBase64Url(randomBytes(32));
    }
    res.cookie(OAUTH_BINDING_COOKIE_NAME, bindingToken, oauthBindingCookieOptions(req, safeTtlMs));
    return hashOAuthBindingToken(bindingToken);
  }

  function resolveOAuthBindingHash(req) {
    const bindingToken = getOAuthBindingToken(req);
    if (!bindingToken || bindingToken.length < 24) return null;
    return hashOAuthBindingToken(bindingToken);
  }

  function clearOAuthBrowserBinding(req, res) {
    res.clearCookie(OAUTH_BINDING_COOKIE_NAME, {
      httpOnly: true,
      sameSite: 'lax',
      secure: oauthBindingCookieOptions(req, 1).secure,
      path: '/api/auth/oauth',
      ...(AUTH_COOKIE_DOMAIN ? { domain: AUTH_COOKIE_DOMAIN } : {})
    });
  }

  function buildPkcePair() {
    const verifier = toBase64Url(randomBytes(32));
    const challenge = createHash('sha256')
      .update(verifier)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
    return { verifier, challenge };
  }

  async function createOAuthSession(provider, redirectUri, bindingHash) {
    const ttlMs = Math.max(60, Math.min(900, OAUTH_SESSION_TTL_SECONDS)) * 1000;
    const pkce = buildPkcePair();
    const session = {
      id: nanoid(24),
      provider,
      state: nanoid(32),
      nonce: nanoid(32),
      codeVerifier: pkce.verifier,
      codeChallenge: pkce.challenge,
      redirectUri,
      bindingHash: String(bindingHash || ''),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
      consumedAt: null
    };
    await withDb(async (db) => {
      db.oauthSessions = (db.oauthSessions || [])
        .filter((item) => new Date(item.expiresAt).getTime() > Date.now())
        .slice(-4000);
      db.oauthSessions.push(session);
      return db;
    });
    return session;
  }

  async function consumeOAuthSessionById({ id, provider, state, bindingHash }) {
    let session = null;
    await withDb(async (db) => {
      session = (db.oauthSessions || []).find((item) => item.id === id && item.provider === provider && !item.consumedAt) || null;
      if (!session) return db;
      if (new Date(session.expiresAt).getTime() <= Date.now()) return db;
      if (state && session.state !== state) return db;
      if (String(session.bindingHash || '') !== String(bindingHash || '')) return db;
      session.consumedAt = new Date().toISOString();
      return db;
    });
    if (!session) return null;
    if (new Date(session.expiresAt).getTime() <= Date.now()) return null;
    if (state && session.state !== state) return null;
    if (String(session.bindingHash || '') !== String(bindingHash || '')) return null;
    return session;
  }

  async function consumeOAuthSessionByState({ provider, state, bindingHash }) {
    let session = null;
    await withDb(async (db) => {
      session = (db.oauthSessions || []).find((item) => item.provider === provider && item.state === state && !item.consumedAt) || null;
      if (!session) return db;
      if (new Date(session.expiresAt).getTime() <= Date.now()) return db;
      if (String(session.bindingHash || '') !== String(bindingHash || '')) return db;
      session.consumedAt = new Date().toISOString();
      return db;
    });
    if (!session) return null;
    if (new Date(session.expiresAt).getTime() <= Date.now()) return null;
    if (String(session.bindingHash || '') !== String(bindingHash || '')) return null;
    return session;
  }

  async function findOrCreateOAuthUser(profile) {
    const oauthChannel =
      profile.provider === 'google'
        ? 'oauth_google'
        : profile.provider === 'apple'
        ? 'oauth_apple'
        : profile.provider === 'facebook'
        ? 'oauth_facebook'
        : 'direct';
    let user = null;
    await withDb(async (db) => {
      const byEmail = db.users.find((item) => item.email === profile.email) || null;
      if (byEmail) {
        byEmail.name = byEmail.name || profile.name;
        byEmail.isPremium = Boolean(byEmail.isPremium);
        byEmail.planType = resolveUserPlan(byEmail).planType;
        byEmail.planStatus = resolveUserPlan(byEmail).planStatus;
        byEmail.onboardingDone = Boolean(byEmail.onboardingDone);
        byEmail.authChannel = oauthChannel;
        byEmail.oauthProviders = byEmail.oauthProviders || [];
        const alreadyLinked = byEmail.oauthProviders.some((p) => p.provider === profile.provider && p.subject === profile.providerSubject);
        if (!alreadyLinked) {
          byEmail.oauthProviders.push({
            provider: profile.provider,
            subject: profile.providerSubject,
            linkedAt: new Date().toISOString()
          });
        }
        user = byEmail;
        return db;
      }

      const created = {
        id: nanoid(10),
        name: profile.name,
        email: profile.email,
        passwordHash: null,
        isPremium: false,
        planType: 'free',
        planStatus: 'active',
        onboardingDone: false,
        mfaEnabled: false,
        mfaSecret: null,
        mfaTempSecret: null,
        failedLoginCount: 0,
        lockUntil: null,
        authChannel: oauthChannel,
        oauthProviders: [
          {
            provider: profile.provider,
            subject: profile.providerSubject,
            linkedAt: new Date().toISOString()
          }
        ],
        createdAt: new Date().toISOString()
      };
      db.users.push(created);
      user = created;
      return db;
    });
    return user;
  }

  async function completeOAuthLogin({ req, res, profile }) {
    const user = await findOrCreateOAuthUser(profile);
    const csrfToken = nanoid(24);
    const family = nanoid(16);
    const { accessToken } = await issueSessionTokens({ req, res, user, csrfToken, family });
    const channel = profile.provider === 'google' ? 'oauth_google' : profile.provider === 'apple' ? 'oauth_apple' : 'oauth_facebook';
    await upsertUserLead({ userId: user.id, email: user.email, name: user.name, source: channel, channel });
    await logAuthEvent({
      userId: user.id,
      email: user.email,
      type: `${channel}_login_success`,
      success: true,
      req
    });
    return buildSessionResponsePayload(accessToken, {
      session: { cookie: true, expiresInDays: 7, csrfToken },
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        mfaEnabled: Boolean(user.mfaEnabled),
        isPremium: Boolean(user.isPremium),
        planType: resolveUserPlan(user).planType,
        planStatus: resolveUserPlan(user).planStatus,
        onboardingDone: Boolean(user.onboardingDone)
      }
    });
  }

  return {
    adminGuard,
    authCookieOptions,
    authGuard,
    buildEmailVerifyUrl,
    buildPasswordResetUrl,
    buildSessionResponsePayload,
    clearOAuthBrowserBinding,
    completeOAuthLogin,
    consumeOAuthSessionById,
    consumeOAuthSessionByState,
    createOAuthSession,
    csrfGuard,
    ensureAiPremiumAccess,
    ensureOAuthBrowserBinding,
    fetchCurrentUser,
    getAccessTokenFromCookie,
    getRefreshTokenFromCookie,
    hashEmailVerifyToken,
    hashPasswordResetToken,
    isTrustedOrigin,
    issueSessionTokens,
    logAuthEvent,
    optionalAuth,
    premiumGuard,
    refreshCsrfGuard,
    registerFailedLogin,
    requireSessionAuth,
    resetUserLoginFailures,
    resolveOAuthBindingHash,
    revokeJwt,
    revokeRefreshFamily,
    rotateRefreshSession,
    userIsLocked
  };
}
