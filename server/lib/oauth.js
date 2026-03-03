import { OAuth2Client } from 'google-auth-library';
import { SignJWT, createRemoteJWKSet, importPKCS8, jwtVerify } from 'jose';
import { createHmac } from 'node:crypto';

const googleClient = new OAuth2Client();
const appleJwks = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
const OAUTH_FETCH_TIMEOUT_MS = Math.max(1000, Number(process.env.OAUTH_FETCH_TIMEOUT_MS || 8000));

function parseCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = OAUTH_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    return { response, payload };
  } finally {
    clearTimeout(timer);
  }
}

export async function verifyGoogleIdToken(idToken) {
  const audiences = parseCsv(process.env.GOOGLE_CLIENT_IDS || process.env.GOOGLE_CLIENT_ID);
  if (!audiences.length) {
    throw new Error('Google OAuth not configured.');
  }
  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience: audiences
  });
  const payload = ticket.getPayload();
  if (!payload?.email || !payload.email_verified) {
    throw new Error('Google account email not verified.');
  }
  return {
    provider: 'google',
    email: String(payload.email).toLowerCase(),
    name: String(payload.name || payload.given_name || payload.email.split('@')[0] || 'Google User'),
    providerSubject: String(payload.sub || ''),
    picture: payload.picture || null,
    nonce: payload.nonce ? String(payload.nonce) : null
  };
}

export async function verifyAppleIdToken(idToken) {
  const audiences = parseCsv(process.env.APPLE_CLIENT_IDS || process.env.APPLE_CLIENT_ID);
  if (!audiences.length) {
    throw new Error('Apple OAuth not configured.');
  }
  const { payload } = await jwtVerify(idToken, appleJwks, {
    issuer: 'https://appleid.apple.com',
    audience: audiences
  });
  if (!payload?.email) {
    throw new Error('Apple token has no email.');
  }
  return {
    provider: 'apple',
    email: String(payload.email).toLowerCase(),
    name: String(payload.email).split('@')[0] || 'Apple User',
    providerSubject: String(payload.sub || ''),
    picture: null,
    nonce: payload.nonce ? String(payload.nonce) : null
  };
}

export async function exchangeGoogleCodeForTokens({ code, codeVerifier, redirectUri }) {
  const clientId = String(process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_IDS || '')
    .split(',')
    .map((x) => x.trim())
    .find(Boolean);
  const clientSecret = String(process.env.GOOGLE_CLIENT_SECRET || '');
  if (!clientId) throw new Error('Google OAuth not configured.');

  const params = new URLSearchParams();
  params.set('grant_type', 'authorization_code');
  params.set('code', code);
  params.set('client_id', clientId);
  if (clientSecret) params.set('client_secret', clientSecret);
  params.set('redirect_uri', redirectUri);
  params.set('code_verifier', codeVerifier);

  const { response, payload } = await fetchJsonWithTimeout('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  if (!response.ok || !payload.id_token) {
    throw new Error(payload.error_description || payload.error || 'Google code exchange failed.');
  }
  return payload;
}

async function buildAppleClientSecret() {
  const teamId = String(process.env.APPLE_TEAM_ID || '').trim();
  const keyId = String(process.env.APPLE_KEY_ID || '').trim();
  const clientId = String(process.env.APPLE_CLIENT_ID || process.env.APPLE_CLIENT_IDS || '')
    .split(',')
    .map((x) => x.trim())
    .find(Boolean);
  const privateKeyRaw = String(process.env.APPLE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();

  if (!teamId || !keyId || !clientId || !privateKeyRaw) {
    throw new Error('Apple OAuth server credentials missing.');
  }
  const privateKey = await importPKCS8(privateKeyRaw, 'ES256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: keyId })
    .setIssuer(teamId)
    .setAudience('https://appleid.apple.com')
    .setSubject(clientId)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(privateKey);
}

export async function exchangeAppleCodeForTokens({ code, redirectUri, codeVerifier }) {
  const clientId = String(process.env.APPLE_CLIENT_ID || process.env.APPLE_CLIENT_IDS || '')
    .split(',')
    .map((x) => x.trim())
    .find(Boolean);
  if (!clientId) throw new Error('Apple OAuth not configured.');
  const clientSecret = await buildAppleClientSecret();

  const params = new URLSearchParams();
  params.set('grant_type', 'authorization_code');
  params.set('code', code);
  params.set('client_id', clientId);
  params.set('client_secret', clientSecret);
  params.set('redirect_uri', redirectUri);
  if (codeVerifier) params.set('code_verifier', codeVerifier);

  const { response, payload } = await fetchJsonWithTimeout('https://appleid.apple.com/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  if (!response.ok || !payload.id_token) {
    throw new Error(payload.error_description || payload.error || 'Apple code exchange failed.');
  }
  return payload;
}

export async function exchangeFacebookCodeForProfile({ code, redirectUri }) {
  const clientId = String(process.env.FACEBOOK_CLIENT_ID || process.env.FACEBOOK_CLIENT_IDS || '')
    .split(',')
    .map((x) => x.trim())
    .find(Boolean);
  const clientSecret = String(process.env.FACEBOOK_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) throw new Error('Facebook OAuth not configured.');

  const tokenParams = new URLSearchParams();
  tokenParams.set('client_id', clientId);
  tokenParams.set('client_secret', clientSecret);
  tokenParams.set('redirect_uri', redirectUri);
  tokenParams.set('code', code);

  const { response: tokenResp, payload: tokenPayload } = await fetchJsonWithTimeout(
    `https://graph.facebook.com/oauth/access_token?${tokenParams.toString()}`,
    { method: 'GET' }
  );
  const accessToken = String(tokenPayload?.access_token || '');
  if (!tokenResp.ok || !accessToken) {
    throw new Error(tokenPayload.error?.message || 'Facebook code exchange failed.');
  }

  const appSecretProof = createHmac('sha256', clientSecret).update(accessToken).digest('hex');
  const profileParams = new URLSearchParams();
  profileParams.set('fields', 'id,name,email,picture.type(square)');
  profileParams.set('access_token', accessToken);
  profileParams.set('appsecret_proof', appSecretProof);

  const { response: profileResp, payload: profilePayload } = await fetchJsonWithTimeout(
    `https://graph.facebook.com/me?${profileParams.toString()}`,
    { method: 'GET' }
  );
  if (!profileResp.ok) {
    throw new Error(profilePayload.error?.message || 'Facebook profile fetch failed.');
  }
  if (!profilePayload?.email) {
    throw new Error('Facebook account email permission required.');
  }

  return {
    provider: 'facebook',
    email: String(profilePayload.email).toLowerCase(),
    name: String(profilePayload.name || profilePayload.email.split('@')[0] || 'Facebook User'),
    providerSubject: String(profilePayload.id || ''),
    picture: profilePayload?.picture?.data?.url || null,
    nonce: null
  };
}
