import express from 'express';
import cors from 'cors';
import axios from 'axios';
import dotenv from 'dotenv';

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
  // Demo-friendly transport. In production prefer short-lived server session or JWT.
  redirect.searchParams.set('user', encodeURIComponent(JSON.stringify(user)));
  return redirect.toString();
}

app.get('/auth/google', ensureGoogleConfig, async (_req, res) => {
  try {
    const googleDialogUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    googleDialogUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
    googleDialogUrl.searchParams.set('redirect_uri', GOOGLE_REDIRECT_URI);
    googleDialogUrl.searchParams.set('response_type', 'code');
    googleDialogUrl.searchParams.set('scope', 'openid email profile');
    console.log('[oauth] google_auth_url', googleDialogUrl.toString());

    return res.redirect(googleDialogUrl.toString());
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to initialize Google login.',
      detail: error instanceof Error ? error.message : 'unknown_error'
    });
  }
});

app.get('/auth/google/callback', ensureGoogleConfig, async (req, res) => {
  const { code, error: googleError, error_description: googleErrorDescription } = req.query;

  if (googleError) {
    return res.status(400).json({
      error: 'Google login was denied or failed.',
      providerError: String(googleError),
      providerDescription: String(googleErrorDescription || '')
    });
  }

  if (!code) {
    return res.status(400).json({ error: 'Missing OAuth code from Google callback.' });
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
  } catch (error) {
    const status = error?.response?.status || 500;
    const providerData = error?.response?.data || null;
    return res.status(status).json({
      error: 'Google OAuth callback failed.',
      detail: error instanceof Error ? error.message : 'unknown_error',
      providerData
    });
  }
});

app.get('/auth/facebook', ensureFacebookConfig, async (_req, res) => {
  try {
    const facebookDialogUrl = new URL('https://www.facebook.com/v19.0/dialog/oauth');
    facebookDialogUrl.searchParams.set('client_id', FACEBOOK_APP_ID);
    facebookDialogUrl.searchParams.set('redirect_uri', FACEBOOK_REDIRECT_URI);
    facebookDialogUrl.searchParams.set('scope', 'email,public_profile');
    facebookDialogUrl.searchParams.set('response_type', 'code');
    console.log('[oauth] facebook_auth_url', facebookDialogUrl.toString());

    return res.redirect(facebookDialogUrl.toString());
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to initialize Facebook login.',
      detail: error instanceof Error ? error.message : 'unknown_error'
    });
  }
});

app.get('/auth/facebook/callback', ensureFacebookConfig, async (req, res) => {
  const { code, error: fbError, error_description: fbErrorDescription } = req.query;

  if (fbError) {
    return res.status(400).json({
      error: 'Facebook login was denied or failed.',
      providerError: String(fbError),
      providerDescription: String(fbErrorDescription || '')
    });
  }

  if (!code) {
    return res.status(400).json({ error: 'Missing OAuth code from Facebook callback.' });
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
  } catch (error) {
    const status = error?.response?.status || 500;
    const providerData = error?.response?.data || null;
    return res.status(status).json({
      error: 'Facebook OAuth callback failed.',
      detail: error instanceof Error ? error.message : 'unknown_error',
      providerData
    });
  }
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`OAuth server (Google + Facebook) listening on http://localhost:${PORT}`);
});
