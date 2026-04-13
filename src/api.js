const API_PREFIX = '/api';
const COOKIE_SESSION_TOKEN = '__cookie_session__';
let csrfToken = '';
let refreshInFlight = null;

export function setCsrfToken(nextToken) {
  csrfToken = String(nextToken || '');
}

function createRequestFailedError() {
  const error = new Error('Request failed');
  error.code = 'request_failed';
  error.requestId = null;
  return error;
}

function createApiError(response, payload) {
  const code = String(payload.error || '').trim();
  const friendlyMessage = String(payload.message || '').trim();
  const fallbackMessage =
    code === 'limit_exceeded'
      ? 'Monthly plan limit reached. Upgrade to keep discovering opportunities.'
      : code === 'auth_required'
      ? 'Sign in to continue.'
      : code === 'invalid_payload'
      ? 'Check your input and try again.'
      : code === 'internal_error'
      ? 'Si è verificato un errore interno. Riprova tra poco.'
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
    const response = await fetch(`${API_PREFIX}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {})
      }
    });
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
    response = await fetch(`${API_PREFIX}${path}`, {
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
  } catch {
    throw createRequestFailedError();
  }

  if (response.status === 401 && !options._retry && options.auth !== false) {
    try {
      await refreshAccessToken();
      return request(path, { ...options, _retry: true });
    } catch {}
  }

  if (response.status === 204) return null;

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw createApiError(response, payload);
  }
  return payload;
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
    return request('/health/security', { auth: false });
  },
  opportunityDebug(token) {
    return request('/system/opportunity-debug', { token });
  },
  config() {
    return request('/config', { auth: false });
  },
  suggestions({ q, region = 'all', country = '', limit = 8 }) {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (region) params.set('region', region);
    if (country) params.set('country', country);
    params.set('limit', String(limit));
    return request(`/suggestions?${params.toString()}`, { auth: false });
  },
  countries({ q = '', limit = 12 }) {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    params.set('limit', String(limit));
    return request(`/countries?${params.toString()}`, { auth: false });
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
    if (token) return request('/search', { method: 'POST', body, token, auth: false });
    return request('/search/public', { method: 'POST', body, auth: false });
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
  completeOnboarding(token, body) {
    return request('/user/onboarding/complete', { method: 'POST', token, body });
  },
  billingPricing() {
    return request('/billing/pricing', { auth: false });
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
  async outboundReportCsv(token) {
    const useBearer = Boolean(token && token !== COOKIE_SESSION_TOKEN);
    let response;
    try {
      response = await fetch(`${API_PREFIX}/outbound/report.csv`, {
        credentials: 'include',
        headers: {
          ...(useBearer ? { Authorization: `Bearer ${token}` } : {})
        }
      });
    } catch {
      throw createRequestFailedError();
    }
    if (response.status === 401) {
      await refreshAccessToken();
      response = await fetch(`${API_PREFIX}/outbound/report.csv`, {
        credentials: 'include',
        headers: {
          ...(useBearer ? { Authorization: `Bearer ${token}` } : {})
        }
      });
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
  opportunityFeed(token, params = {}) {
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
    return request(`/opportunities/feed${suffix}`, { token, auth: false });
  },
  opportunityClusters(token, params = {}) {
    const query = new URLSearchParams();
    if (params.region) query.set('region', String(params.region));
    if (params.limit) query.set('limit', String(params.limit));
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request(`/opportunities/clusters${suffix}`, { token, auth: false });
  },
  opportunityDetail(token, id) {
    return request(`/opportunities/${id}`, { token, auth: false });
  },
  followOpportunity(token, id) {
    return request(`/opportunities/${id}/follow`, { method: 'POST', token });
  },
  opportunityRelated(token, id) {
    return request(`/opportunities/${id}/related`, { token, auth: false });
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
  }
};

export { COOKIE_SESSION_TOKEN };
