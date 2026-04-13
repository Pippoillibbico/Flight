import { Router } from 'express';
import { z } from 'zod';

const oauthLoginSchema = z.object({
  oauthSessionId: z.string().min(1),
  state: z.string().min(1),
  idToken: z.string().min(10)
});

const oauthSessionSchema = z.object({
  provider: z.enum(['google', 'apple', 'facebook'])
});

function firstCsvValue(value) {
  return String(value || '')
    .split(',')
    .map((part) => part.trim())
    .find(Boolean);
}

function redirectToFrontend(res, frontendUrl, params = {}) {
  const url = new URL(frontendUrl || 'http://localhost:5173');
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    url.searchParams.set(key, String(value));
  }
  return res.redirect(url.toString());
}

export function buildAuthOAuthRouter({
  authLimiter,
  frontendUrl,
  googleOAuthRedirectUri,
  appleOAuthRedirectUri,
  facebookOAuthRedirectUri,
  ensureOAuthBrowserBinding,
  createOAuthSession,
  clearOAuthBrowserBinding,
  resolveOAuthBindingHash,
  consumeOAuthSessionByState,
  consumeOAuthSessionById,
  exchangeGoogleCodeForTokens,
  exchangeAppleCodeForTokens,
  exchangeFacebookCodeForProfile,
  verifyGoogleIdToken,
  verifyAppleIdToken,
  completeOAuthLogin
}) {
  const router = Router();

  router.get('/api/auth/oauth/google/start', authLimiter, async (req, res) => {
    const clientId = firstCsvValue(process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_IDS);
    if (!clientId) return res.status(503).json({ error: 'Google OAuth not configured.' });
    const bindingHash = ensureOAuthBrowserBinding(req, res);
    const oauth = await createOAuthSession('google', googleOAuthRedirectUri, bindingHash);
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', oauth.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', oauth.state);
    url.searchParams.set('nonce', oauth.nonce);
    url.searchParams.set('code_challenge', oauth.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('access_type', 'offline');
    return res.redirect(url.toString());
  });

  router.get('/api/auth/oauth/google/callback', authLimiter, async (req, res) => {
    const state = String(req.query.state || '');
    const code = String(req.query.code || '');
    if (!state || !code) {
      clearOAuthBrowserBinding(req, res);
      return redirectToFrontend(res, frontendUrl, { oauth: 'error', reason: 'google_missing_code' });
    }
    const bindingHash = resolveOAuthBindingHash(req);
    if (!bindingHash) {
      clearOAuthBrowserBinding(req, res);
      return redirectToFrontend(res, frontendUrl, { oauth: 'error', reason: 'google_binding_missing' });
    }

    const oauthSession = await consumeOAuthSessionByState({ provider: 'google', state, bindingHash });
    if (!oauthSession) {
      clearOAuthBrowserBinding(req, res);
      return redirectToFrontend(res, frontendUrl, { oauth: 'error', reason: 'google_invalid_state' });
    }

    try {
      const tokenPayload = await exchangeGoogleCodeForTokens({
        code,
        codeVerifier: oauthSession.codeVerifier,
        redirectUri: oauthSession.redirectUri || googleOAuthRedirectUri
      });
      const profile = await verifyGoogleIdToken(tokenPayload.id_token);
      if (!profile.nonce || profile.nonce !== oauthSession.nonce) {
        clearOAuthBrowserBinding(req, res);
        return redirectToFrontend(res, frontendUrl, { oauth: 'error', reason: 'google_nonce_mismatch' });
      }
      await completeOAuthLogin({ req, res, profile });
      clearOAuthBrowserBinding(req, res);
      return redirectToFrontend(res, frontendUrl, { oauth: 'success', provider: 'google' });
    } catch {
      clearOAuthBrowserBinding(req, res);
      return redirectToFrontend(res, frontendUrl, { oauth: 'error', reason: 'google_exchange_failed' });
    }
  });

  router.get('/api/auth/oauth/apple/start', authLimiter, async (req, res) => {
    const clientId = firstCsvValue(process.env.APPLE_CLIENT_ID || process.env.APPLE_CLIENT_IDS);
    if (!clientId) return res.status(503).json({ error: 'Apple OAuth not configured.' });
    const bindingHash = ensureOAuthBrowserBinding(req, res);
    const oauth = await createOAuthSession('apple', appleOAuthRedirectUri, bindingHash);
    const url = new URL('https://appleid.apple.com/auth/authorize');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', oauth.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('response_mode', 'query');
    url.searchParams.set('scope', 'name email');
    url.searchParams.set('state', oauth.state);
    url.searchParams.set('nonce', oauth.nonce);
    url.searchParams.set('code_challenge', oauth.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return res.redirect(url.toString());
  });

  router.get('/api/auth/oauth/facebook/start', authLimiter, async (req, res) => {
    const clientId = firstCsvValue(process.env.FACEBOOK_CLIENT_ID || process.env.FACEBOOK_CLIENT_IDS);
    if (!clientId) return res.status(503).json({ error: 'Facebook OAuth not configured.' });
    const bindingHash = ensureOAuthBrowserBinding(req, res);
    const oauth = await createOAuthSession('facebook', facebookOAuthRedirectUri, bindingHash);
    const url = new URL('https://www.facebook.com/v20.0/dialog/oauth');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', oauth.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', oauth.state);
    url.searchParams.set('scope', 'email,public_profile');
    return res.redirect(url.toString());
  });

  async function handleAppleCallback(req, res) {
    const state = String(req.body?.state || req.query?.state || '');
    const code = String(req.body?.code || req.query?.code || '');
    if (!state || !code) {
      clearOAuthBrowserBinding(req, res);
      return redirectToFrontend(res, frontendUrl, { oauth: 'error', reason: 'apple_missing_code' });
    }
    const bindingHash = resolveOAuthBindingHash(req);
    if (!bindingHash) {
      clearOAuthBrowserBinding(req, res);
      return redirectToFrontend(res, frontendUrl, { oauth: 'error', reason: 'apple_binding_missing' });
    }

    const oauthSession = await consumeOAuthSessionByState({ provider: 'apple', state, bindingHash });
    if (!oauthSession) {
      clearOAuthBrowserBinding(req, res);
      return redirectToFrontend(res, frontendUrl, { oauth: 'error', reason: 'apple_invalid_state' });
    }

    try {
      const tokenPayload = await exchangeAppleCodeForTokens({
        code,
        codeVerifier: oauthSession.codeVerifier,
        redirectUri: oauthSession.redirectUri || appleOAuthRedirectUri
      });
      const profile = await verifyAppleIdToken(tokenPayload.id_token);
      if (!profile.nonce || profile.nonce !== oauthSession.nonce) {
        clearOAuthBrowserBinding(req, res);
        return redirectToFrontend(res, frontendUrl, { oauth: 'error', reason: 'apple_nonce_mismatch' });
      }
      await completeOAuthLogin({ req, res, profile });
      clearOAuthBrowserBinding(req, res);
      return redirectToFrontend(res, frontendUrl, { oauth: 'success', provider: 'apple' });
    } catch {
      clearOAuthBrowserBinding(req, res);
      return redirectToFrontend(res, frontendUrl, { oauth: 'error', reason: 'apple_exchange_failed' });
    }
  }

  router.get('/api/auth/oauth/apple/callback', authLimiter, handleAppleCallback);
  router.post('/api/auth/oauth/apple/callback', authLimiter, handleAppleCallback);

  router.get('/api/auth/oauth/facebook/callback', authLimiter, async (req, res) => {
    const state = String(req.query.state || '');
    const code = String(req.query.code || '');
    if (!state || !code) {
      clearOAuthBrowserBinding(req, res);
      return redirectToFrontend(res, frontendUrl, { oauth: 'error', reason: 'facebook_missing_code' });
    }
    const bindingHash = resolveOAuthBindingHash(req);
    if (!bindingHash) {
      clearOAuthBrowserBinding(req, res);
      return redirectToFrontend(res, frontendUrl, { oauth: 'error', reason: 'facebook_binding_missing' });
    }

    const oauthSession = await consumeOAuthSessionByState({ provider: 'facebook', state, bindingHash });
    if (!oauthSession) {
      clearOAuthBrowserBinding(req, res);
      return redirectToFrontend(res, frontendUrl, { oauth: 'error', reason: 'facebook_invalid_state' });
    }

    try {
      const profile = await exchangeFacebookCodeForProfile({
        code,
        redirectUri: oauthSession.redirectUri || facebookOAuthRedirectUri
      });
      await completeOAuthLogin({ req, res, profile });
      clearOAuthBrowserBinding(req, res);
      return redirectToFrontend(res, frontendUrl, { oauth: 'success', provider: 'facebook' });
    } catch {
      clearOAuthBrowserBinding(req, res);
      return redirectToFrontend(res, frontendUrl, { oauth: 'error', reason: 'facebook_exchange_failed' });
    }
  });

  router.post('/api/auth/oauth/session', authLimiter, async (req, res) => {
    const parsed = oauthSessionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid oauth session payload.' });
    const bindingHash = ensureOAuthBrowserBinding(req, res);
    const redirectUri =
      parsed.data.provider === 'google'
        ? googleOAuthRedirectUri
        : parsed.data.provider === 'apple'
        ? appleOAuthRedirectUri
        : facebookOAuthRedirectUri;
    const session = await createOAuthSession(parsed.data.provider, redirectUri, bindingHash);
    return res.json({
      oauthSessionId: session.id,
      provider: session.provider,
      state: session.state,
      nonce: session.nonce,
      expiresAt: session.expiresAt
    });
  });

  router.post('/api/auth/oauth/google', authLimiter, async (req, res) => {
    const parsed = oauthLoginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid OAuth payload.' });
    const bindingHash = resolveOAuthBindingHash(req);
    if (!bindingHash) {
      clearOAuthBrowserBinding(req, res);
      return res.status(401).json({ error: 'Missing OAuth browser binding.' });
    }

    const oauthSession = await consumeOAuthSessionById({
      id: parsed.data.oauthSessionId,
      provider: 'google',
      state: parsed.data.state,
      bindingHash
    });
    if (!oauthSession) {
      clearOAuthBrowserBinding(req, res);
      return res.status(401).json({ error: 'Invalid or expired OAuth session.' });
    }

    let profile = null;
    try {
      profile = await verifyGoogleIdToken(parsed.data.idToken);
    } catch {
      clearOAuthBrowserBinding(req, res);
      return res.status(401).json({ error: 'Google token validation failed.' });
    }
    if (!profile.nonce || profile.nonce !== oauthSession.nonce) {
      clearOAuthBrowserBinding(req, res);
      return res.status(401).json({ error: 'Google nonce mismatch.' });
    }
    const payload = await completeOAuthLogin({ req, res, profile });
    clearOAuthBrowserBinding(req, res);
    return res.json(payload);
  });

  router.post('/api/auth/oauth/apple', authLimiter, async (req, res) => {
    const parsed = oauthLoginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid OAuth payload.' });
    const bindingHash = resolveOAuthBindingHash(req);
    if (!bindingHash) {
      clearOAuthBrowserBinding(req, res);
      return res.status(401).json({ error: 'Missing OAuth browser binding.' });
    }

    const oauthSession = await consumeOAuthSessionById({
      id: parsed.data.oauthSessionId,
      provider: 'apple',
      state: parsed.data.state,
      bindingHash
    });
    if (!oauthSession) {
      clearOAuthBrowserBinding(req, res);
      return res.status(401).json({ error: 'Invalid or expired OAuth session.' });
    }

    let profile = null;
    try {
      profile = await verifyAppleIdToken(parsed.data.idToken);
    } catch {
      clearOAuthBrowserBinding(req, res);
      return res.status(401).json({ error: 'Apple token validation failed.' });
    }
    if (!profile.nonce || profile.nonce !== oauthSession.nonce) {
      clearOAuthBrowserBinding(req, res);
      return res.status(401).json({ error: 'Apple nonce mismatch.' });
    }
    const payload = await completeOAuthLogin({ req, res, profile });
    clearOAuthBrowserBinding(req, res);
    return res.json(payload);
  });

  return router;
}
