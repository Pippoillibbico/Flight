const API_PREFIX = '/api';
const COOKIE_SESSION_TOKEN = '__cookie_session__';
let csrfToken = '';
let refreshInFlight = null;
const REQUEST_TIMEOUT_MS = Math.max(3000, Number(import.meta?.env?.VITE_API_TIMEOUT_MS || 15000));
const REQUEST_RETRIES = Math.max(0, Math.min(3, Number(import.meta?.env?.VITE_API_RETRIES || 1)));
const GET_CACHE = new Map();
const GET_CACHE_MAX_ENTRIES = Math.max(50, Number(import.meta?.env?.VITE_GET_CACHE_MAX_ENTRIES || 300));

function sweepExpiredCacheEntries(now = Date.now()) {
  for (const [key, value] of GET_CACHE.entries()) {
    if (!value || Number(value.expiresAt || 0) <= now) GET_CACHE.delete(key);
  }
}

function evictLeastRecentlyUsed() {
  let oldestKey = null;
  let oldestSeenAt = Number.POSITIVE_INFINITY;
  for (const [key, value] of GET_CACHE.entries()) {
    const seenAt = Number(value?.lastAccessAt || 0);
    if (seenAt < oldestSeenAt) {
      oldestSeenAt = seenAt;
      oldestKey = key;
    }
  }
  if (oldestKey) GET_CACHE.delete(oldestKey);
}

function touchCacheEntry(key, entry, now = Date.now()) {
  if (!entry) return;
  entry.lastAccessAt = now;
  GET_CACHE.set(key, entry);
}

export function setCsrfToken(nextToken) {
  csrfToken = String(nextToken || '');
}

function createRequestFailedError() {
  const error = new Error('Request failed');
  error.code = 'request_failed';
  error.requestId = null;
  return error;
}

function createTimeoutError() {
  const error = new Error('Request timed out');
  error.code = 'request_timeout';
  error.requestId = null;
  return error;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

async function fetchWithPolicy(url, init = {}, { timeoutMs = REQUEST_TIMEOUT_MS, retries = REQUEST_RETRIES } = {}) {
  const method = String(init?.method || 'GET').toUpperCase();
  const retryBudget = ['GET', 'HEAD', 'OPTIONS'].includes(method) ? retries : 0;
  for (let attempt = 0; attempt <= retryBudget; attempt += 1) {
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (attempt < retryBudget && isRetryableStatus(response.status)) {
        const backoffMs = 200 * 2 ** attempt;
        await sleep(backoffMs);
        continue;
      }
      return response;
    } catch (error) {
      const isAbort = error?.name === 'AbortError';
      if (attempt >= retryBudget) {
        if (isAbort) throw createTimeoutError();
        throw createRequestFailedError();
      }
      const backoffMs = 200 * 2 ** attempt;
      await sleep(backoffMs);
    } finally {
      globalThis.clearTimeout(timer);
    }
  }
  throw createRequestFailedError();
}

function createApiError(response, payload) {
  const code = String(payload.error || '').trim();
  const friendlyMessage = String(payload.message || '').trim();
  const fallbackMessage =
    code === 'rate_limited' || code === 'limit_exceeded'
      ? 'Monthly plan limit reached. Upgrade to keep discovering opportunities.'
      : code === 'unauthorized' || code === 'auth_required'
      ? 'Sign in to continue.'
      : code === 'forbidden'
      ? 'You do not have permission to complete this action.'
      : code === 'invalid_payload'
      ? 'Check your input and try again.'
      : code === 'internal_error'
      ? 'An internal error occurred. Please try again in a moment.'
      : 'Request not available right now. Please try again.';
  const error = new Error(friendlyMessage || fallbackMessage);
  error.status = response.status;
  error.code = code || 'request_failed';
  error.resetAt = payload.reset_at || null;
  error.requestId = payload.request_id || null;
  return error;
}

async function refreshAccessToken() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const response = await fetchWithPolicy(`${API_PREFIX}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {})
      }
    }, { retries: 0 });
    if (!response.ok) throw new Error('Session expired. Please sign in again.');
    const payload = await response.json().catch(() => ({}));
    setCsrfToken(payload.session?.csrfToken || '');
    return payload;
  })();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

async function request(path, options = {}) {
  const useBearer = Boolean(options.token && options.token !== COOKIE_SESSION_TOKEN);
  const method = (options.method || 'GET').toUpperCase();
  const shouldSendCsrf = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
  const hasBody = options.body !== undefined && options.body !== null;
  let response;
  try {
    response = await fetchWithPolicy(`${API_PREFIX}${path}`, {
      headers: {
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        ...(useBearer ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(shouldSendCsrf && csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        ...(options.headers || {})
      },
      credentials: 'include',
      method: options.method || 'GET',
      body: hasBody ? JSON.stringify(options.body) : undefined
    });
  } catch (error) {
    throw error?.code ? error : createRequestFailedError();
  }

  if (response.status === 401 && !options._retry && options.auth !== false) {
    let refreshed = false;
    try {
      await refreshAccessToken();
      refreshed = true;
    } catch {
      // Refresh failed — fall through to surface the original 401 error.
    }
    if (refreshed) return request(path, { ...options, _retry: true });
  }

  if (response.status === 204) return null;

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw createApiError(response, payload);
  }
  return payload;
}

async function requestCached(path, options = {}, ttlMs = 0) {
  const safeTtl = Math.max(0, Number(ttlMs) || 0);
  if (safeTtl <= 0) return request(path, options);
  const key = `${String(options?.token || '')}|${path}`;
  const now = Date.now();
  sweepExpiredCacheEntries(now);
  const hit = GET_CACHE.get(key);
  if (hit && hit.expiresAt > now) {
    touchCacheEntry(key, hit, now);
    return hit.value;
  }
  const value = await request(path, options);
  GET_CACHE.set(key, { value, expiresAt: now + safeTtl, lastAccessAt: now });
  while (GET_CACHE.size > GET_CACHE_MAX_ENTRIES) evictLeastRecentlyUsed();
  return value;
}

export const api = {
  health() {
    return request('/health', { auth: false });
  },
  healthFeatures() {
    return request('/health/features', { auth: false });
  },
  healthCompliance() {
    return request('/health/compliance', { auth: false });
  },
  healthSecurity() {
    return request('/health/security');
  },
  opportunityDebug(token) {
    return request('/system/data-status', { token });
  },
  config() {
    return requestCached('/config', { auth: false }, 5 * 60 * 1000);
  },
  suggestions({ q, region = 'all', country = '', limit = 8 }) {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (region) params.set('region', region);
    if (country) params.set('country', country);
    params.set('limit', String(limit));
    return requestCached(`/suggestions?${params.toString()}`, { auth: false }, 30 * 1000);
  },
  countries({ q = '', limit = 12 }) {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    params.set('limit', String(limit));
    return requestCached(`/countries?${params.toString()}`, { auth: false }, 60 * 1000);
  },
  register(body) {
    return request('/auth/register', { method: 'POST', body, auth: false });
  },
  login(body) {
    return request('/auth/login', { method: 'POST', body, auth: false });
  },
  loginMfa(body) {
    return request('/auth/login/mfa', { method: 'POST', body, auth: false });
  },
  refresh() {
    return refreshAccessToken();
  },
  me(token) {
    return request('/auth/me', { token });
  },
  mfaSetup(token) {
    return request('/auth/mfa/setup', { method: 'POST', token });
  },
  mfaEnable(token, body) {
    return request('/auth/mfa/enable', { method: 'POST', token, body });
  },
  mfaDisable(token, body) {
    return request('/auth/mfa/disable', { method: 'POST', token, body });
  },
  securityActivity(token) {
    return request('/security/activity', { token });
  },
  search(body, token) {
    return request('/search', { method: 'POST', body, token, auth: false });
  },
  justGoDecision(body, token) {
    return request('/decision/just-go', { method: 'POST', body, token, auth: false });
  },
  decisionIntake(body, token) {
    return request('/decision/intake', { method: 'POST', body, token, auth: false });
  },
  searchHistory(token) {
    return request('/search/history', { token });
  },
  destinationInsights(body, token) {
    return request('/insights/destination', { method: 'POST', body, token });
  },
  outboundClick(body) {
    return request('/outbound/click', { method: 'POST', body, auth: false });
  },
  outboundReport(token) {
    return request('/outbound/report', { token });
  },
  monetizationReport(token) {
    return request('/monetization/report', { token });
  },
  funnelAnalytics(token) {
    return request('/analytics/funnel', { token });
  },
  adminBackofficeReport(token) {
    return request('/admin/backoffice/report', { token });
  },
  adminTelemetry(token, body) {
    return request('/admin/telemetry', { method: 'POST', token, body });
  },
  completeOnboarding(token, body) {
    return request('/user/onboarding/complete', { method: 'POST', token, body });
  },
  billingPricing({ forceRefresh = false } = {}) {
    if (forceRefresh) return request('/billing/pricing', { auth: false });
    return requestCached('/billing/pricing', { auth: false }, 60 * 1000);
  },
  upgradeDemo(token) {
    return request('/billing/upgrade-demo', { method: 'POST', token });
  },
  upgradePro(token) {
    return request('/upgrade/pro', { method: 'POST', token });
  },
  upgradeElite(token) {
    return request('/upgrade/elite', { method: 'POST', token });
  },
  // Aliases used by useUpgradeFlowController when billing_mock_mode is active.
  mockUpgradePro(token) {
    return request('/upgrade/pro', { method: 'POST', token });
  },
  mockUpgradeElite(token) {
    return request('/upgrade/elite', { method: 'POST', token });
  },
  async outboundReportCsv(token) {
    const useBearer = Boolean(token && token !== COOKIE_SESSION_TOKEN);
    let response;
    try {
      response = await fetchWithPolicy(`${API_PREFIX}/outbound/report.csv`, {
        credentials: 'include',
        headers: {
          ...(useBearer ? { Authorization: `Bearer ${token}` } : {})
        }
      });
    } catch (error) {
      throw error?.code ? error : createRequestFailedError();
    }
    if (response.status === 401) {
      await refreshAccessToken();
      response = await fetchWithPolicy(`${API_PREFIX}/outbound/report.csv`, {
        credentials: 'include',
        headers: {
          ...(useBearer ? { Authorization: `Bearer ${token}` } : {})
        }
      }, { retries: 0 });
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw createApiError(response, payload);
    }
    return response.text();
  },
  logout(token) {
    return request('/auth/logout', { method: 'POST', token });
  },
  deleteAccount(token) {
    return request('/auth/account', { method: 'DELETE', token });
  },
  watchlist(token) {
    return request('/watchlist', { token });
  },
  addWatchlist(token, body) {
    return request('/watchlist', { method: 'POST', token, body });
  },
  removeWatchlist(token, id) {
    return request(`/watchlist/${id}`, { method: 'DELETE', token });
  },
  listAlertSubscriptions(token) {
    return request('/alerts/subscriptions', { token });
  },
  createAlertSubscription(token, body) {
    return request('/alerts/subscriptions', { method: 'POST', token, body });
  },
  updateAlertSubscription(token, id, body) {
    return request(`/alerts/subscriptions/${id}`, { method: 'PATCH', token, body });
  },
  deleteAlertSubscription(token, id) {
    return request(`/alerts/subscriptions/${id}`, { method: 'DELETE', token });
  },
  listNotifications(token) {
    return request('/notifications', { token });
  },
  markNotificationRead(token, id) {
    return request(`/notifications/${id}/read`, { method: 'POST', token });
  },
  markAllNotificationsRead(token) {
    return request('/notifications/read-all', { method: 'POST', token });
  },
  runNotificationScan(token) {
    return request('/notifications/scan', { method: 'POST', token });
  },
  // ── Browser push (VAPID) ───────────────────────────────────
  getVapidPublicKey() {
    return request('/push/vapid-public-key');
  },
  registerPushSubscription(token, subscription) {
    return request('/push/subscribe', { method: 'POST', token, body: subscription });
  },
  unregisterPushSubscription(token, endpoint) {
    return request('/push/subscribe', { method: 'DELETE', token, body: { endpoint } });
  },
  listPushSubscriptions(token) {
    return request('/push/subscriptions', { token });
  },
  // ── SaaS API keys ──────────────────────────────────────────
  listApiKeys(token) {
    return request('/keys', { token });
  },
  issueApiKey(token, body) {
    return request('/keys', { method: 'POST', token, body });
  },
  revokeApiKey(token, id) {
    return request(`/keys/${id}`, { method: 'DELETE', token });
  },
  // ── Usage & billing ───────────────────────────────────────
  usageSummary(token) {
    return request('/usage/summary', { token });
  },
  usageHistory(token, limit = 50) {
    return request(`/usage/history?limit=${limit}`, { token });
  },
  plans() {
    return request('/usage/plans', { auth: false });
  },
  subscription(token) {
    return request('/billing/subscription', { token });
  },
  billingClientToken(token) {
    return request('/billing/client-token', { token });
  },
  billingCheckout(token, body) {
    return request('/billing/checkout', { method: 'POST', token, body });
  },
  opportunityFeed(token, params = {}, options = {}) {
    const query = new URLSearchParams();
    if (params.origin) query.set('origin', String(params.origin).toUpperCase());
    if (params.budgetMax) query.set('budget_max', String(params.budgetMax));
    if (params.travelMonth) query.set('travel_month', String(params.travelMonth));
    if (params.country) query.set('country', String(params.country));
    if (params.region) query.set('region', String(params.region));
    if (params.cluster) query.set('cluster', String(params.cluster));
    if (params.budgetBucket) query.set('budget_bucket', String(params.budgetBucket));
    if (params.entity) query.set('entity', String(params.entity));
    if (params.limit) query.set('limit', String(params.limit));
    const suffix = query.toString() ? `?${query.toString()}` : '';
    if (options?.forceRefresh) return request(`/opportunities/feed${suffix}`, { token, auth: false });
    return requestCached(`/opportunities/feed${suffix}`, { token, auth: false }, 30 * 1000);
  },
  opportunityClusters(token, params = {}, options = {}) {
    const query = new URLSearchParams();
    if (params.region) query.set('region', String(params.region));
    if (params.limit) query.set('limit', String(params.limit));
    const suffix = query.toString() ? `?${query.toString()}` : '';
    if (options?.forceRefresh) return request(`/opportunities/clusters${suffix}`, { token, auth: false });
    return requestCached(`/opportunities/clusters${suffix}`, { token, auth: false }, 45 * 1000);
  },
  opportunityExploreBudget(token, params = {}) {
    const query = new URLSearchParams();
    if (params.origin) query.set('origin', String(params.origin).toUpperCase());
    if (params.budgetMax) query.set('budget_max', String(params.budgetMax));
    if (params.limit) query.set('limit', String(params.limit));
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request(`/opportunities/explore/budget${suffix}`, { token, auth: false });
  },
  opportunityExploreMap(token, params = {}) {
    const query = new URLSearchParams();
    if (params.origin) query.set('origin', String(params.origin).toUpperCase());
    if (params.budgetMax) query.set('budget_max', String(params.budgetMax));
    if (params.limit) query.set('limit', String(params.limit));
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request(`/opportunities/explore/map${suffix}`, { token, auth: false });
  },
  opportunityDetail(token, id, options = {}) {
    if (options?.forceRefresh) return request(`/opportunities/${id}`, { token, auth: false });
    return requestCached(`/opportunities/${id}`, { token, auth: false }, 60 * 1000);
  },
  followOpportunity(token, id) {
    return request(`/opportunities/${id}/follow`, { method: 'POST', token });
  },
  opportunityRelated(token, id, options = {}) {
    if (options?.forceRefresh) return request(`/opportunities/${id}/related`, { token, auth: false });
    return requestCached(`/opportunities/${id}/related`, { token, auth: false }, 60 * 1000);
  },
  listFollows(token) {
    return request('/opportunities/me/follows', { token });
  },
  followEntity(token, body) {
    return request('/opportunities/follows', { method: 'POST', token, body });
  },
  unfollowEntity(token, id) {
    return request(`/opportunities/follows/${id}`, { method: 'DELETE', token });
  },
  getRadarPreferences(token) {
    return request('/opportunities/radar/preferences', { token });
  },
  updateRadarPreferences(token, body) {
    return request('/opportunities/radar/preferences', { method: 'PUT', token, body });
  },
  radarMatches(token) {
    return request('/opportunities/radar/matches', { token });
  },
  myRadar(token) {
    return request('/opportunities/me/radar', { token });
  },
  queryAiTravel(token, body) {
    return request('/opportunities/ai/query', { method: 'POST', token, body });
  },
  opportunityPipelineStatus(token) {
    return request('/opportunities/pipeline/status', { token });
  },
  opportunityPipelineRun(token) {
    return request('/opportunities/pipeline/run', { method: 'POST', token });
  },
  /**
   * Public endpoint — no auth required.
   * Returns the runtime capability matrix so the UI can gate features correctly.
   * Cached for 5 minutes to avoid hammering on every render.
   */
  systemCapabilities() {
    return requestCached('/system/capabilities', { auth: false }, 5 * 60 * 1000);
  }
};

export { COOKIE_SESSION_TOKEN };
