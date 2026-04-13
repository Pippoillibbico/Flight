import { parseCookieHeader } from './http-cookies.js';

export function getTokenFromHeader(req) {
  const raw = req?.headers?.authorization;
  if (!raw) return null;
  const [prefix, token] = raw.split(' ');
  if (prefix !== 'Bearer' || !token) return null;
  return token;
}

export function getCookies(req) {
  return parseCookieHeader(req?.headers?.cookie);
}

export function getAccessTokenFromCookie(req, accessCookieName) {
  const cookies = getCookies(req);
  return cookies[String(accessCookieName || '')] || null;
}

export function getRefreshTokenFromCookie(req, refreshCookieName) {
  const cookies = getCookies(req);
  return cookies[String(refreshCookieName || '')] || null;
}

export function getAuthToken(req, accessCookieName) {
  const headerToken = getTokenFromHeader(req);
  if (headerToken) return { token: headerToken, source: 'bearer' };
  const cookieToken = getAccessTokenFromCookie(req, accessCookieName);
  if (cookieToken) return { token: cookieToken, source: 'cookie' };
  return { token: null, source: null };
}
