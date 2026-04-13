import express from 'express';
import cors from 'cors';
import axios from 'axios';
import dotenv from 'dotenv';
import { randomBytes } from 'node:crypto';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 8080);

const GOOGLE_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_IDS || '')
  .split(',')
  .map((value) => value.trim())
  .find(Boolean);
const GOOGLE_CLIENT_SECRET = String(process.env.GOOGLE_CLIENT_SECRET || '').trim();
const GOOGLE_REDIRECT_URI = String(process.env.GOOGLE_REDIRECT_URI || process.env.GOOGLE_OAUTH_REDIRECT_URI || 'http://localhost:8080/auth/google/callback').trim();
const FACEBOOK_APP_ID = String(process.env.FACEBOOK_APP_ID || process.env.FACEBOOK_CLIENT_ID || process.env.FACEBOOK_CLIENT_IDS || '')
  .split(',')
  .map((value) => value.trim())
  .find(Boolean);
const FACEBOOK_APP_SECRET = String(process.env.FACEBOOK_APP_SECRET || process.env.FACEBOOK_CLIENT_SECRET || '').trim();
const FACEBOOK_REDIRECT_URI = String(process.env.FACEBOOK_REDIRECT_URI || process.env.FACEBOOK_OAUTH_REDIRECT_URI || 'http://localhost:8080/auth/facebook/callback').trim();
const FRONTEND_URL = String(process.env.FRONTEND_URL || 'http://localhost:5173').trim();
const LEGACY_OAUTH_SERVER_ENABLED = ['1', 'true', 'yes', 'on'].includes(String(process.env.ENABLE_LEGACY_OAUTH_SERVER || '').trim().toLowerCase());
const IS_PRODUCTION = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
const OAUTH_STATE_TTL_MS = Math.max(60_000, Number(process.env.OAUTH_STATE_TTL_MS || 10 * 60 * 1000));
const oauthStateStore = new Map();

if (IS_PRODUCTION && !LEGACY_OAUTH_SERVER_ENABLED) {
  throw new Error('Legacy OAuth demo server is disabled in production. Set ENABLE_LEGACY_OAUTH_SERVER=true only for emergency fallback.');
}

app.use(
  cors({
    origin: FRONTEND_URL,
    credentials: true
  })
);
app.use(express.json());

function ensureGoogleConfig(req, res, next) {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI || !FRONTEND_URL) {
    return res.status(500).json({
      error: 'Google OAuth environment variables are missing.',
      required: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'FRONTEND_URL']
    });
  }
  return next();
}

function ensureFacebookConfig(req, res, next) {
  if (!FACEBOOK_APP_ID || !FACEBOOK_APP_SECRET || !FACEBOOK_REDIRECT_URI || !FRONTEND_URL) {
    return res.status(500).json({
      error: 'Facebook OAuth environment variables are missing.',
      required: ['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET', 'FACEBOOK_REDIRECT_URI', 'FRONTEND_URL']
    });
  }
  return next();
}

function buildFrontendSuccessRedirect(user) {
  const redirect = new URL('/login-success', FRONTEND_URL);
  redirect.searchParams.set('oauth', 'success');
  redirect.searchParams.set('provider', String(user?.provider || 'oauth'));
  return redirect.toString();
}

function buildFrontendErrorRedirect(provider, reason) {
  const redirect = new URL('/login-success', FRONTEND_URL);
  redirect.searchParams.set('oauth', 'error');
  redirect.searchParams.set('provider', String(provider || 'oauth'));
  redirect.searchParams.set('reason', String(reason || 'oauth_failed'));
  return redirect.toString();
}

function pruneOauthStates(now = Date.now()) {
  for (const [key, entry] of oauthStateStore.entries()) {
    if (!entry || Number(entry.expiresAt || 0) <= now) oauthStateStore.delete(key);
  }
}

function createOauthState(provider) {
  pruneOauthStates();
  const state = randomBytes(24).toString('base64url');
  oauthStateStore.set(`${String(provider || '').toLowerCase()}:${state}`, {
    expiresAt: Date.now() + OAUTH_STATE_TTL_MS
  });
  return state;
}

function consumeOauthState(provider, state) {
  pruneOauthStates();
  const key = `${String(provider || '').toLowerCase()}:${String(state || '')}`;
  const hit = oauthStateStore.get(key);
  if (!hit) return false;
  oauthStateStore.delete(key);
  return Number(hit.expiresAt || 0) > Date.now();
}

app.get('/auth/google', ensureGoogleConfig, async (_req, res) => {
  try {
    const state = createOauthState('google');
    const googleDialogUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    googleDialogUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
    googleDialogUrl.searchParams.set('redirect_uri', GOOGLE_REDIRECT_URI);
    googleDialogUrl.searchParams.set('response_type', 'code');
    googleDialogUrl.searchParams.set('scope', 'openid email profile');
    googleDialogUrl.searchParams.set('state', state);
    console.log('[oauth] google_auth_url', googleDialogUrl.toString());

    return res.redirect(googleDialogUrl.toString());
  } catch {
    return res.status(500).json({
      error: 'Failed to initialize Google login.'
    });
  }
});

app.get('/auth/google/callback', ensureGoogleConfig, async (req, res) => {
  const { code, state, error: googleError } = req.query;

  if (googleError) {
    return res.redirect(buildFrontendErrorRedirect('google', 'google_denied'));
  }

  if (!code || !state) {
    return res.redirect(buildFrontendErrorRedirect('google', 'google_missing_code'));
  }

  if (!consumeOauthState('google', state)) {
    return res.redirect(buildFrontendErrorRedirect('google', 'google_invalid_state'));
  }

  try {
    const params = new URLSearchParams();
    params.set('client_id', GOOGLE_CLIENT_ID);
    params.set('client_secret', GOOGLE_CLIENT_SECRET);
    params.set('redirect_uri', GOOGLE_REDIRECT_URI);
    params.set('grant_type', 'authorization_code');
    params.set('code', String(code));

    const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000
    });

    const accessToken = tokenResponse?.data?.access_token;
    if (!accessToken) {
      return res.status(502).json({
        error: 'Token exchange succeeded but no access_token was returned.',
        response: tokenResponse?.data || null
      });
    }

    const profileResponse = await axios.get('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 10000
    });

    const profile = profileResponse?.data || null;
    if (!profile) {
      return res.status(502).json({ error: 'Failed to fetch Google profile.' });
    }

    const user = {
      id: profile.sub,
      name: profile.name,
      email: profile.email || null,
      picture: profile.picture || null,
      provider: 'google'
    };

    return res.redirect(buildFrontendSuccessRedirect(user));
  } catch {
    return res.redirect(buildFrontendErrorRedirect('google', 'google_exchange_failed'));
  }
});

app.get('/auth/facebook', ensureFacebookConfig, async (_req, res) => {
  try {
    const state = createOauthState('facebook');
    const facebookDialogUrl = new URL('https://www.facebook.com/v19.0/dialog/oauth');
    facebookDialogUrl.searchParams.set('client_id', FACEBOOK_APP_ID);
    facebookDialogUrl.searchParams.set('redirect_uri', FACEBOOK_REDIRECT_URI);
    facebookDialogUrl.searchParams.set('scope', 'email,public_profile');
    facebookDialogUrl.searchParams.set('response_type', 'code');
    facebookDialogUrl.searchParams.set('state', state);
    console.log('[oauth] facebook_auth_url', facebookDialogUrl.toString());

    return res.redirect(facebookDialogUrl.toString());
  } catch {
    return res.status(500).json({
      error: 'Failed to initialize Facebook login.'
    });
  }
});

app.get('/auth/facebook/callback', ensureFacebookConfig, async (req, res) => {
  const { code, state, error: fbError } = req.query;

  if (fbError) {
    return res.redirect(buildFrontendErrorRedirect('facebook', 'facebook_denied'));
  }

  if (!code || !state) {
    return res.redirect(buildFrontendErrorRedirect('facebook', 'facebook_missing_code'));
  }

  if (!consumeOauthState('facebook', state)) {
    return res.redirect(buildFrontendErrorRedirect('facebook', 'facebook_invalid_state'));
  }

  try {
    const tokenResponse = await axios.get('https://graph.facebook.com/v19.0/oauth/access_token', {
      params: {
        client_id: FACEBOOK_APP_ID,
        client_secret: FACEBOOK_APP_SECRET,
        redirect_uri: FACEBOOK_REDIRECT_URI,
        code: String(code)
      },
      timeout: 10000
    });

    const accessToken = tokenResponse?.data?.access_token;
    if (!accessToken) {
      return res.status(502).json({
        error: 'Token exchange succeeded but no access_token was returned.',
        response: tokenResponse?.data || null
      });
    }

    const profileResponse = await axios.get('https://graph.facebook.com/me', {
      params: {
        fields: 'id,name,email,picture',
        access_token: accessToken
      },
      timeout: 10000
    });

    const profile = profileResponse?.data || null;
    if (!profile) {
      return res.status(502).json({ error: 'Failed to fetch Facebook profile.' });
    }

    return res.redirect(buildFrontendSuccessRedirect(profile));
  } catch {
    return res.redirect(buildFrontendErrorRedirect('facebook', 'facebook_exchange_failed'));
  }
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`OAuth server (Google + Facebook) listening on http://localhost:${PORT}`);
});
