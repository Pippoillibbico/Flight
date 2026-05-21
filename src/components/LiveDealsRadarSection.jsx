import { useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { api } from '../api';
import { isKnownIataAirportCode, resolveAirportCityName } from '../utils/localizePlace';
import { validateProps } from '../utils/validateProps';

const RETURN_STATE_KEY = 'live_deals_last_redirect_v1';
const SAVED_ROUTES_KEY = 'live_deals_saved_routes_v1';
const RETURN_STATE_TTL_MS = 24 * 60 * 60 * 1000;
const DETAIL_VIEWS_KEY = 'live_deals_detail_views_v1';
const DETAIL_VIEWS_LOGIN_TRIGGER = 2;

const LiveDealsRadarSectionPropsSchema = z
  .object({
    t: z.function().optional(),
    language: z.string().optional().default('it'),
    token: z.string().nullable().optional().default(null),
    isAuthenticated: z.boolean().default(false),
    requireSectionLogin: z.function(),
    onUpgradePro: z.function().optional(),
    onUpgradeElite: z.function().optional(),
    sendAdminTelemetryEvent: z.function().optional(),
    canUseRadarPlan: z.boolean().optional().default(false),
    preferredOrigin: z.string().optional().default('')
  })
  .passthrough();

function safeJsonParse(value) {
  try {
    return JSON.parse(String(value || ''));
  } catch {
    return null;
  }
}

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatPrice(value, currency = 'EUR') {
  const amount = toFiniteNumber(value);
  if (amount === null) return '-';
  const normalizedCurrency = String(currency || 'EUR').toUpperCase();
  const rounded = Math.round(amount);
  return normalizedCurrency === 'EUR' ? `€${rounded}` : `${rounded} ${normalizedCurrency}`;
}

function dealBadgeKey(type) {
  const normalized = String(type || '').trim().toLowerCase();
  if (normalized === 'error_fare') return 'liveDealsBadgeErrorFare';
  if (normalized === 'hidden_deal') return 'liveDealsBadgeHiddenDeal';
  if (normalized === 'flash_sale') return 'liveDealsBadgeJustDropped';
  return 'liveDealsBadgeLiveDeal';
}

function toRouteSlug(origin, destination) {
  return `${String(origin || '').trim().toUpperCase()}-${String(destination || '').trim().toUpperCase()}`;
}

function normalizeSmartDeparture(raw, fallbackCurrency = 'EUR') {
  if (!raw || typeof raw !== 'object') return { alternatives: [], best: null, summary: null };
  const alternativesRaw = Array.isArray(raw.alternatives) ? raw.alternatives : [];
  const bestRaw = raw.bestAlternative && typeof raw.bestAlternative === 'object' ? raw.bestAlternative : null;
  const alternatives = alternativesRaw
    .map((item) => {
      const origin = String(item?.originIata || item?.origin || '').trim().toUpperCase();
      const destination = String(item?.destinationIata || item?.destination || '').trim().toUpperCase();
      const price = toFiniteNumber(item?.price);
      const savingAbs = toFiniteNumber(item?.savingAbs);
      const savingPct = toFiniteNumber(item?.savingPct);
      if (!origin || !destination || price === null || savingAbs === null || savingAbs <= 0) return null;
      if (!isKnownIataAirportCode(origin) || !isKnownIataAirportCode(destination)) return null;
      return {
        originIata: origin,
        destinationIata: destination,
        origin,
        destination,
        price,
        savingAbs,
        savingPct: savingPct || 0,
        label: String(item?.label || 'Smart departure').trim(),
        currency: String(item?.currency || fallbackCurrency || 'EUR').trim().toUpperCase()
      };
    })
    .filter(Boolean)
    .slice(0, 3);
  const bestFromPayload = bestRaw
    ? {
        origin: String(bestRaw.originIata || bestRaw.origin || '').trim().toUpperCase(),
        destination: String(bestRaw.destinationIata || bestRaw.destination || '').trim().toUpperCase(),
        price: toFiniteNumber(bestRaw.price),
        savingAbs: toFiniteNumber(bestRaw.savingAbs),
        savingPct: toFiniteNumber(bestRaw.savingPct) || 0
      }
    : null;
  const best = alternatives[0] || (bestFromPayload?.origin && bestFromPayload?.price != null ? bestFromPayload : null);
  return {
    alternatives,
    best,
    summary:
      String(raw.summaryMessage || raw.summary || '').trim() ||
      (best ? `Da ${best.origin} risparmi ~${Math.round(best.savingAbs)}€` : null)
  };
}

function relativeDetectedAt(value, language = 'it') {
  const now = Date.now();
  const ts = new Date(String(value || '')).getTime();
  if (!Number.isFinite(ts)) return language.startsWith('en') ? 'Detected recently' : 'Rilevato di recente';
  const diffSec = Math.max(0, Math.round((now - ts) / 1000));
  if (diffSec < 60) return language.startsWith('en') ? 'Detected now' : 'Rilevato ora';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return language.startsWith('en') ? `Detected ${diffMin} min ago` : `Rilevato ${diffMin} min fa`;
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return language.startsWith('en') ? `Detected ${diffHours} h ago` : `Rilevato ${diffHours} h fa`;
  const diffDays = Math.round(diffHours / 24);
  return language.startsWith('en') ? `Detected ${diffDays} d ago` : `Rilevato ${diffDays} g fa`;
}

function readSavedRoutes() {
  if (typeof window === 'undefined') return new Set();
  const raw = window.localStorage.getItem(SAVED_ROUTES_KEY);
  const parsed = safeJsonParse(raw);
  if (!Array.isArray(parsed)) return new Set();
  return new Set(
    parsed
      .map((entry) => String(entry || '').trim().toUpperCase())
      .filter((entry) => /^[A-Z]{3}-[A-Z]{3}$/.test(entry))
  );
}

function persistSavedRoutes(routes) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SAVED_ROUTES_KEY, JSON.stringify(Array.from(routes)));
}

function normalizeDeal(rawDeal) {
  if (!rawDeal || typeof rawDeal !== 'object') return null;
  const origin = String(rawDeal.origin || '').trim().toUpperCase();
  const destination = String(rawDeal.destination || '').trim().toUpperCase();
  const price = toFiniteNumber(rawDeal.price);
  const baselinePrice = toFiniteNumber(rawDeal.baseline_p50);
  const dealConfidence = toFiniteNumber(rawDeal.deal_confidence) || 0;
  const savingsPct = toFiniteNumber(rawDeal.savings_pct);
  const savingsAmount = toFiniteNumber(rawDeal.savings_amount);
  const bookingUrl = String(rawDeal.booking_url || '').trim();
  if (!origin || !destination || price === null || !bookingUrl) return null;
  if (!isKnownIataAirportCode(origin) || !isKnownIataAirportCode(destination)) return null;
  const relevanceBoost = 0;
  return {
    ...rawDeal,
    origin,
    destination,
    price,
    baselinePrice,
    dealConfidence,
    savingsPct: savingsPct || 0,
    savingsAmount: savingsAmount || 0,
    bookingUrl,
    routeSlug: toRouteSlug(origin, destination),
    detectedAt: String(rawDeal.detected_at || ''),
    badgeKey: dealBadgeKey(rawDeal.deal_type),
    freshnessTs: new Date(String(rawDeal.detected_at || 0)).getTime() || 0,
    rankingScore: dealConfidence * 2 + (savingsPct || 0) + relevanceBoost,
    smartDeparture: normalizeSmartDeparture(rawDeal.smartDeparture, rawDeal.currency || 'EUR')
  };
}

function pickSimilarDeals(items, baseDeal, max = 4) {
  if (!baseDeal) return [];
  const sameDestination = items.filter((item) => item.routeSlug !== baseDeal.routeSlug && item.destination === baseDeal.destination);
  const sameOrigin = items.filter((item) => item.routeSlug !== baseDeal.routeSlug && item.origin === baseDeal.origin);
  const combined = [...sameDestination, ...sameOrigin];
  const seen = new Set();
  const deduped = [];
  for (const item of combined) {
    const key = String(item.routeSlug || '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
    if (deduped.length >= max) break;
  }
  return deduped;
}

function saveReturnState(deal) {
  if (typeof window === 'undefined' || !deal) return;
  const payload = {
    routeSlug: deal.routeSlug,
    origin: deal.origin,
    destination: deal.destination,
    price: deal.price,
    currency: deal.currency || 'EUR',
    detectedAt: deal.detectedAt,
    savedAt: Date.now()
  };
  window.localStorage.setItem(RETURN_STATE_KEY, JSON.stringify(payload));
}

function readReturnState() {
  if (typeof window === 'undefined') return null;
  const parsed = safeJsonParse(window.localStorage.getItem(RETURN_STATE_KEY));
  if (!parsed || typeof parsed !== 'object') return null;
  const savedAt = Number(parsed.savedAt || 0);
  if (!Number.isFinite(savedAt) || Date.now() - savedAt > RETURN_STATE_TTL_MS) {
    window.localStorage.removeItem(RETURN_STATE_KEY);
    return null;
  }
  return parsed;
}

function getLiveDealsSessionId() {
  if (typeof window === 'undefined') return 'srv';
  const key = 'live_deals_session_id_v1';
  const existing = String(window.sessionStorage.getItem(key) || '').trim();
  if (existing) return existing;
  const next = `lds_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  window.sessionStorage.setItem(key, next);
  return next;
}

function readDetailViewsCount() {
  if (typeof window === 'undefined') return 0;
  const raw = Number(window.sessionStorage.getItem(DETAIL_VIEWS_KEY) || 0);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

function writeDetailViewsCount(next) {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(DETAIL_VIEWS_KEY, String(Math.max(0, Math.floor(Number(next) || 0))));
}

export default function LiveDealsRadarSection(props) {
  const {
    t,
    language,
    token,
    isAuthenticated,
    requireSectionLogin,
    onUpgradePro,
    onUpgradeElite,
    sendAdminTelemetryEvent,
    canUseRadarPlan,
    preferredOrigin
  } = validateProps(LiveDealsRadarSectionPropsSchema, props, 'LiveDealsRadarSection');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [deals, setDeals] = useState([]);
  const [selectedDealId, setSelectedDealId] = useState('');
  const [preRedirectDealId, setPreRedirectDealId] = useState('');
  const [returnState, setReturnState] = useState(() => readReturnState());
  const [actionMessage, setActionMessage] = useState('');
  const [savedRoutes, setSavedRoutes] = useState(() => readSavedRoutes());
  const [busyRouteSlug, setBusyRouteSlug] = useState('');
  const [feedMeta, setFeedMeta] = useState(() => ({ reason: 'ok', accessTier: 'paid' }));
  const [detailViewsCount, setDetailViewsCount] = useState(() => readDetailViewsCount());
  const sessionId = useMemo(() => getLiveDealsSessionId(), []);
  const noDealsTelemetrySentRef = useRef(false);

  const isEnglish = String(language || 'it').toLowerCase().startsWith('en');
  const tt = (key, fallback) => {
    if (typeof t !== 'function') return fallback;
    const translated = t(key);
    if (typeof translated !== 'string') return fallback;
    const normalized = translated.trim();
    return normalized && normalized !== key ? translated : fallback;
  };

  const routeLabel = (origin, destination) => {
    const formatAirport = (code) => {
      const normalizedCode = String(code || '').trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(normalizedCode)) return normalizedCode || '-';
      const city = resolveAirportCityName(normalizedCode, language);
      return city && city !== normalizedCode ? `${city} (${normalizedCode})` : normalizedCode;
    };
    return `${formatAirport(origin)} -> ${formatAirport(destination)}`;
  };

  const dealBadgeLabel = (deal) => tt(deal?.badgeKey || 'liveDealsBadgeLiveDeal', isEnglish ? 'Live Deal' : 'Deal live');

  function trackLiveDealEvent(eventType, deal = null, extra = {}) {
    if (typeof sendAdminTelemetryEvent !== 'function') return;
    const dealId = String(
      deal?.fingerprint ||
      deal?.observation_id ||
      deal?.realtime_id ||
      deal?.routeSlug ||
      ''
    ).trim();
    const routeSlug = String(deal?.routeSlug || extra?.routeSlug || '').trim();
    const priceValue = toFiniteNumber(deal?.price ?? extra?.price);
    sendAdminTelemetryEvent({
      eventType,
      at: new Date().toISOString(),
      sourceContext: 'web_app',
      source: 'live_deals_funnel',
      surface: String(extra?.surface || 'live_deals_radar'),
      action: String(extra?.action || '').trim() || undefined,
      itineraryId: dealId || undefined,
      dealId: dealId || undefined,
      routeSlug: routeSlug || undefined,
      price: priceValue || undefined,
      sessionId
    });
  }

  function trackCoreEvent(eventType, deal = null, extra = {}) {
    if (typeof sendAdminTelemetryEvent !== 'function') return;
    sendAdminTelemetryEvent({
      eventType,
      at: new Date().toISOString(),
      sourceContext: 'web_app',
      source: 'live_deals_funnel',
      surface: String(extra?.surface || 'live_deals_radar'),
      dealId: String(deal?.fingerprint || deal?.observation_id || deal?.routeSlug || '').trim() || undefined,
      routeSlug: String(deal?.routeSlug || extra?.routeSlug || '').trim() || undefined,
      price: toFiniteNumber(deal?.price ?? extra?.price) || undefined,
      sessionId
    });
  }

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const payload = await api.realtimeDeals({ limit: 60 }, { forceRefresh: true });
        if (!mounted) return;
        const normalized = Array.isArray(payload?.deals)
          ? payload.deals.map(normalizeDeal).filter(Boolean)
          : [];
        setDeals(normalized);
        setFeedMeta({
          reason: String(payload?.meta?.reason || 'ok'),
          accessTier: String(payload?.meta?.accessTier || 'paid')
        });
        trackLiveDealEvent('live_deal_feed_view', normalized[0] || null, {
          surface: 'live_deals_feed',
          action: 'feed_view',
          price: normalized[0]?.price || null
        });
        if (normalized.length > 0 && (!isAuthenticated || String(payload?.meta?.accessTier || '') !== 'paid')) {
          trackCoreEvent('teaser_deal_viewed', normalized[0], { surface: 'live_deals_feed' });
        }
      } catch (loadError) {
        if (!mounted) return;
        setDeals([]);
        setFeedMeta({ reason: 'no_data', accessTier: isAuthenticated ? 'paid' : 'anonymous_teaser' });
        setError(String(loadError?.message || 'Impossibile caricare i deal live in questo momento.'));
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    const interval = window.setInterval(load, 45 * 1000);
    const onPageShow = () => {
      setReturnState(readReturnState());
      setActionMessage('');
      load();
    };
    window.addEventListener('pageshow', onPageShow);
    return () => {
      mounted = false;
      window.clearInterval(interval);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [isAuthenticated]);

  const sortedDeals = useMemo(() => {
    const normalizedPreferredOrigin = String(preferredOrigin || '').trim().toUpperCase();
    return [...deals]
      .map((deal) => ({
        ...deal,
        rankingScore:
          deal.rankingScore +
          (normalizedPreferredOrigin && deal.origin === normalizedPreferredOrigin ? 8 : 0)
      }))
      .sort((a, b) => {
        if (b.freshnessTs !== a.freshnessTs) return b.freshnessTs - a.freshnessTs;
        if (b.dealConfidence !== a.dealConfidence) return b.dealConfidence - a.dealConfidence;
        if (b.rankingScore !== a.rankingScore) return b.rankingScore - a.rankingScore;
        return a.price - b.price;
      });
  }, [deals, preferredOrigin]);

  const selectedDeal = useMemo(
    () => sortedDeals.find((deal) => String(deal.fingerprint || deal.observation_id || deal.routeSlug) === selectedDealId) || null,
    [sortedDeals, selectedDealId]
  );

  const preRedirectDeal = useMemo(
    () =>
      sortedDeals.find((deal) => String(deal.fingerprint || deal.observation_id || deal.routeSlug) === preRedirectDealId) ||
      selectedDeal ||
      null,
    [sortedDeals, preRedirectDealId, selectedDeal]
  );

  const similarDeals = useMemo(() => pickSimilarDeals(sortedDeals, selectedDeal || preRedirectDeal), [sortedDeals, selectedDeal, preRedirectDeal]);
  const topDeals = sortedDeals.slice(0, 24);
  const isFreeLike = isAuthenticated && !canUseRadarPlan;
  const isAnonymous = !isAuthenticated;
  const detailLevel = isAnonymous ? 'teaser' : isFreeLike ? 'reduced' : 'full';

  async function saveRoute(deal, source = 'live_deals') {
    if (!deal) return;
    if (!isAuthenticated || !token) {
      trackCoreEvent('signup_started', deal, { surface: source });
      requireSectionLogin('radar');
      return;
    }
    if (isFreeLike && (source === 'detail_alert' || source === 'preredirect')) {
      trackCoreEvent('upgrade_started', deal, { surface: source });
      onUpgradePro?.('advanced_alerts');
      return;
    }
    const routeSlug = deal.routeSlug;
    if (!routeSlug) return;
    trackLiveDealEvent(
      source === 'detail_alert' || source === 'preredirect'
        ? 'live_deal_alert_click'
        : 'live_deal_save_route_click',
      deal,
      {
        surface: source,
        action: source === 'detail_alert' || source === 'preredirect' ? 'alert' : 'save_route'
      }
    );
    setBusyRouteSlug(routeSlug);
    setActionMessage('');
    try {
      await api.followEntity(token, {
        entityType: 'route',
        slug: routeSlug.toLowerCase(),
        displayName: routeLabel(deal.origin, deal.destination),
        followType: 'radar',
        metadata: {
          source,
          from: 'live_deals'
        }
      });
      const next = new Set(savedRoutes);
      next.add(routeSlug);
      setSavedRoutes(next);
      persistSavedRoutes(next);
      setActionMessage(
        isEnglish
          ? `Route ${routeLabel(deal.origin, deal.destination)} saved.`
          : `Rotta ${routeLabel(deal.origin, deal.destination)} salvata.`
      );
    } catch (saveError) {
      setActionMessage(String(saveError?.message || (isEnglish ? 'Unable to save route.' : 'Impossibile salvare la rotta.')));
    } finally {
      setBusyRouteSlug('');
    }
  }

  function openDetail(deal) {
    const identifier = String(deal?.fingerprint || deal?.observation_id || deal?.routeSlug || '');
    if (!identifier) return;
    const nextDetailViews = detailViewsCount + 1;
    if (!isAuthenticated && nextDetailViews >= DETAIL_VIEWS_LOGIN_TRIGGER) {
      trackCoreEvent('signup_started', deal, { surface: 'live_deal_detail_gate' });
      requireSectionLogin('radar');
      return;
    }
    setDetailViewsCount(nextDetailViews);
    writeDetailViewsCount(nextDetailViews);
    trackLiveDealEvent('live_deal_card_click', deal, {
      surface: 'live_deal_card',
      action: 'view_detail'
    });
    trackLiveDealEvent('live_deal_detail_open', deal, {
      surface: 'live_deal_detail',
      action: 'open'
    });
    setSelectedDealId(identifier);
    setPreRedirectDealId('');
  }

  function openPreRedirect(deal) {
    const identifier = String(deal?.fingerprint || deal?.observation_id || deal?.routeSlug || '');
    if (!identifier) return;
    trackLiveDealEvent('live_deal_card_click', deal, {
      surface: 'live_deal_card',
      action: 'pre_redirect'
    });
    trackLiveDealEvent('live_deal_pre_redirect_open', deal, {
      surface: 'live_deal_pre_redirect',
      action: 'open'
    });
    setPreRedirectDealId(identifier);
    setSelectedDealId(identifier);
  }

  async function continueToBooking() {
    if (!preRedirectDeal?.bookingUrl) return;
    const bookingUrlWithConsent = String(preRedirectDeal.bookingUrl || '').trim();
    const separator = bookingUrlWithConsent.includes('?') ? '&' : '?';
    const previewUrl = `${bookingUrlWithConsent}${separator}preview=1`;
    try {
      const previewResponse = await fetch(previewUrl, {
        method: 'GET',
        credentials: 'include'
      });
      if (previewResponse.status === 401) {
        trackCoreEvent('signup_started', preRedirectDeal, { surface: 'live_deal_pre_redirect_gate' });
        requireSectionLogin('radar');
        return;
      }
      if (previewResponse.status === 402) {
        trackCoreEvent('upgrade_started', preRedirectDeal, { surface: 'live_deal_pre_redirect_gate' });
        onUpgradePro?.('more_deals');
        return;
      }
    } catch {
      // Keep default behavior and let redirect endpoint handle tracking/redirect.
    }
    trackLiveDealEvent('live_deal_redirect_confirm', preRedirectDeal, {
      surface: 'live_deal_pre_redirect',
      action: 'confirm_redirect'
    });
    saveReturnState(preRedirectDeal);
    window.location.assign(bookingUrlWithConsent);
  }

  const returnDeal = useMemo(() => {
    if (!returnState) return null;
    return sortedDeals.find((deal) => deal.routeSlug === returnState.routeSlug) || null;
  }, [returnState, sortedDeals]);

  const returnSimilarDeals = useMemo(() => pickSimilarDeals(sortedDeals, returnDeal, 3), [sortedDeals, returnDeal]);

  useEffect(() => {
    if (!returnState) return;
    trackLiveDealEvent('live_deal_return_view', returnDeal || null, {
      surface: 'live_deal_return_state',
      action: 'return_view',
      routeSlug: String(returnState?.routeSlug || '').trim(),
      price: toFiniteNumber(returnState?.price)
    });
  }, [returnState, returnDeal]);

  useEffect(() => {
    if (loading || error) return;
    if (topDeals.length > 0) {
      noDealsTelemetrySentRef.current = false;
      return;
    }
    if (noDealsTelemetrySentRef.current) return;
    noDealsTelemetrySentRef.current = true;
    trackCoreEvent('no_deals_viewed', null, {
      surface: 'live_deals_feed',
      action: String(feedMeta?.reason || 'no_data')
    });
  }, [loading, error, topDeals.length, feedMeta?.reason]);

  useEffect(() => {
    if (loading || error || topDeals.length === 0) return;
    const firstWithAlternative = topDeals.find((deal) => deal?.smartDeparture?.alternatives?.length > 0) || null;
    if (!firstWithAlternative) return;
    trackLiveDealEvent('alternative_departure_viewed', firstWithAlternative, {
      surface: 'live_deals_feed',
      action: 'smart_departure_view'
    });
    trackLiveDealEvent('savings_hint_viewed', firstWithAlternative, {
      surface: 'live_deals_feed',
      action: 'smart_departure_savings_hint'
    });
  }, [loading, error, topDeals]);

  useEffect(() => {
    if (!selectedDeal || !selectedDeal?.smartDeparture?.alternatives?.length) return;
    trackLiveDealEvent('alternative_departure_expanded', selectedDeal, {
      surface: 'live_deal_detail',
      action: 'smart_departure_expanded'
    });
  }, [selectedDeal]);

  function onSmartDepartureClick(parentDeal, alternative, surface = 'live_deal_detail') {
    if (!parentDeal || !alternative) return;
    trackLiveDealEvent('alternative_departure_clicked', parentDeal, {
      surface,
      action: `smart_departure_click_${String(alternative.origin || '').toUpperCase()}`,
      price: alternative.price
    });
  }

  return (
    <section className="panel live-deals-panel" data-testid="live-deals-panel">
      <div className="live-deals-hero">
        <p className="live-deals-eyebrow">Radar Live</p>
        <h2>{tt('liveDealsHeroTitle', isEnglish ? 'Flights you should not be able to find' : 'Voli che non dovresti riuscire a trovare')}</h2>
        <p className="live-deals-subtitle">
          {tt(
            'liveDealsHeroSubtitle',
            isEnglish
              ? 'Anomalous fares, real drops and opportunities detected almost in real time.'
              : 'Prezzi anomali, ribassi reali e opportunita rilevate in tempo quasi reale.'
          )}
        </p>
        <div className="item-actions live-deals-hero-actions">
          <button type="button" className="live-deals-primary-cta" onClick={() => setSelectedDealId('')} data-testid="live-deals-hero-cta">
            {tt('liveDealsHeroCta', isEnglish ? 'View live deals' : 'Guarda i deal live')}
          </button>
          {!canUseRadarPlan ? (
            <button type="button" className="ghost" onClick={() => onUpgradePro?.('live_deals_hero')}>
              {tt('liveDealsUpgradeCta', isEnglish ? 'Unlock early PRO access' : 'Sblocca accesso anticipato Pro')}
            </button>
          ) : null}
        </div>
      </div>

      {returnState ? (
        <article className="live-deals-return-state" data-testid="live-deals-return-state">
          <p className="live-deals-return-title">
            {isEnglish
              ? `You were checking ${returnState.origin} -> ${returnState.destination} at ${formatPrice(returnState.price, returnState.currency)}`
              : `Stavi guardando ${returnState.origin} -> ${returnState.destination} a ${formatPrice(returnState.price, returnState.currency)}`}
          </p>
          <p className="live-deals-return-sub">
            {isEnglish
              ? 'Want to be alerted if we detect a better opportunity on this route?'
              : 'Vuoi essere avvisato se rileviamo un prezzo ancora migliore su questa rotta?'}
          </p>
          <div className="item-actions">
            <button
              type="button"
              className="live-deals-secondary-cta"
              onClick={() => (returnDeal ? saveRoute(returnDeal, 'return_state') : requireSectionLogin('radar'))}
              disabled={busyRouteSlug === returnDeal?.routeSlug}
            >
              {tt('liveDealsReturnAlertCta', isEnglish ? 'Activate route alert' : 'Attiva alert sulla rotta')}
            </button>
            {!canUseRadarPlan ? (
              <button type="button" className="ghost" onClick={() => onUpgradeElite?.('live_deals_return_state')}>
                {tt('liveDealsReturnUpgradeCta', isEnglish ? 'Upgrade to ELITE for priority signals' : 'Passa a ELITE per segnali prioritari')}
              </button>
            ) : null}
          </div>
          {returnSimilarDeals.length > 0 ? (
            <div className="live-deals-return-similar">
              <strong>{tt('liveDealsReturnSimilarTitle', isEnglish ? 'You may also like these similar deals' : 'Potrebbero interessarti anche questi deal simili')}</strong>
              <div className="live-deals-similar-list">
                {returnSimilarDeals.map((item) => (
                  <button
                    type="button"
                    key={`return_similar_${item.routeSlug}_${item.detectedAt}`}
                    className="live-deals-similar-card"
                    onClick={() => openDetail(item)}
                  >
                    <span>{routeLabel(item.origin, item.destination)}</span>
                    <span>{formatPrice(item.price, item.currency)}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </article>
      ) : null}

      {actionMessage ? <p className="live-deals-message">{actionMessage}</p> : null}
      {loading ? <p className="muted">{isEnglish ? 'Loading live deals...' : 'Caricamento deal live...'}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      {!loading && !error && topDeals.length === 0 ? (
        <p className="muted">
          {String(feedMeta?.reason || '') === 'provider_unavailable'
            ? (isEnglish
              ? 'Live feed is currently unavailable. Please try again shortly.'
              : 'Il feed live non e disponibile in questo momento. Riprova tra poco.')
            : (isEnglish
              ? 'No strong opportunities right now. Come back later or enable an alert.'
              : 'Nessuna opportunita forte ora. Torna piu tardi o attiva un alert.')}
        </p>
      ) : null}

      <div className="live-deals-feed" data-testid="live-deals-feed">
        {topDeals.map((deal) => {
          const identifier = String(deal.fingerprint || deal.observation_id || deal.routeSlug);
          const saved = savedRoutes.has(deal.routeSlug);
          const referenceLabel = deal.baselinePrice ? formatPrice(deal.baselinePrice, deal.currency) : '-';
          const savingLabel =
            deal.savingsPct > 0
              ? `${Math.round(deal.savingsPct)}%`
              : deal.savingsAmount > 0
                ? formatPrice(deal.savingsAmount, deal.currency)
                : '-';
          return (
            <article key={`live_deal_${identifier}`} className="live-deal-card" data-testid={`live-deal-card-${identifier}`}>
              <div className="live-deal-card-top">
                <span className="live-deal-badge">{dealBadgeLabel(deal)}</span>
                <span className="live-deal-detected">{relativeDetectedAt(deal.detectedAt, language)}</span>
              </div>
              {deal?.smartDeparture?.best ? (
                <div className="live-deal-smart-departure-badge" data-testid={`smart-departure-badge-${identifier}`}>
                  <span className="live-deal-badge live-deal-badge--secondary">{tt('liveDealsSmartDeparture', isEnglish ? 'Smart departure' : 'Partenza intelligente')}</span>
                  <span className="live-deal-smart-departure-hint">
                    {isEnglish
                      ? `From ${routeLabel(deal.smartDeparture.best.origin, deal.destination).split(' -> ')[0]} save ~${formatPrice(deal.smartDeparture.best.savingAbs, deal.currency)}`
                      : `Da ${routeLabel(deal.smartDeparture.best.origin, deal.destination).split(' -> ')[0]} risparmi ~${formatPrice(deal.smartDeparture.best.savingAbs, deal.currency)}`}
                  </span>
                </div>
              ) : null}
              <h3 className="live-deal-route">{routeLabel(deal.origin, deal.destination)}</h3>
              <p className="live-deal-price">{formatPrice(deal.price, deal.currency)}</p>
              <div className="live-deal-metrics">
                <p>
                  <span>{tt('liveDealsNormalPrice', isEnglish ? 'Typical price' : 'Prezzo normale')}</span>
                  <strong>{referenceLabel}</strong>
                </p>
                <p>
                  <span>{tt('liveDealsSaving', isEnglish ? 'Saving' : 'Risparmio')}</span>
                  <strong>{savingLabel}</strong>
                </p>
              </div>
              <div className="item-actions live-deal-actions">
                <button type="button" className="live-deals-primary-cta" onClick={() => openPreRedirect(deal)}>
                  {tt('liveDealsBookCta', isEnglish ? 'Go to deal' : 'Vai al deal')}
                </button>
                <button type="button" className="ghost" onClick={() => openDetail(deal)}>
                  {tt('liveDealsDetailCta', isEnglish ? 'View details' : 'Vedi dettagli')}
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => saveRoute(deal, 'detail_alert')}
                  disabled={busyRouteSlug === deal.routeSlug}
                >
                  {saved
                    ? tt('liveDealsSavedRouteCta', isEnglish ? 'Alert active' : 'Alert attivo')
                    : tt('liveDealsSaveRouteCta', isEnglish ? 'Activate alert' : 'Attiva alert')}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {selectedDeal ? (
        <section className="live-deal-detail" data-testid="live-deal-detail">
          <div className="panel-head">
            <h3>{tt('liveDealsDetailTitle', isEnglish ? 'Deal details' : 'Dettaglio deal')}</h3>
            <button type="button" className="ghost" onClick={() => setSelectedDealId('')}>
              {tt('close', isEnglish ? 'Close' : 'Chiudi')}
            </button>
          </div>
          <div className="live-deal-detail-grid">
            <p><strong>{tt('liveDealsDetailRoute', isEnglish ? 'Route' : 'Tratta')}</strong><span>{routeLabel(selectedDeal.origin, selectedDeal.destination)}</span></p>
            <p><strong>{tt('liveDealsDetailCurrentPrice', isEnglish ? 'Current price' : 'Prezzo attuale')}</strong><span>{formatPrice(selectedDeal.price, selectedDeal.currency)}</span></p>
            <p><strong>{tt('liveDealsDetailSaving', isEnglish ? 'Saving' : 'Risparmio')}</strong><span>{selectedDeal.savingsPct > 0 ? `${Math.round(selectedDeal.savingsPct)}%` : formatPrice(selectedDeal.savingsAmount, selectedDeal.currency)}</span></p>
            <p><strong>{tt('liveDealsDetailType', isEnglish ? 'Deal type' : 'Tipo deal')}</strong><span>{dealBadgeLabel(selectedDeal)}</span></p>
            <p><strong>{tt('liveDealsDetailDetectedAt', isEnglish ? 'Last detected' : 'Ultimo rilevamento')}</strong><span>{relativeDetectedAt(selectedDeal.detectedAt, language)}</span></p>
            {detailLevel !== 'teaser' ? (
              <p><strong>{tt('liveDealsDetailNormalPrice', isEnglish ? 'Typical price' : 'Prezzo normale')}</strong><span>{selectedDeal.baselinePrice ? formatPrice(selectedDeal.baselinePrice, selectedDeal.currency) : '-'}</span></p>
            ) : null}
            {detailLevel === 'full' ? (
              <>
                <p><strong>{tt('liveDealsDetailDates', 'Date')}</strong><span>{selectedDeal.departure_date || '-'} {selectedDeal.return_date ? `- ${selectedDeal.return_date}` : ''}</span></p>
                <p><strong>{tt('liveDealsDetailCabin', isEnglish ? 'Cabin' : 'Cabina')}</strong><span>{String(selectedDeal.cabin_class || 'economy')}</span></p>
              </>
            ) : null}
          </div>
          <div className="live-deal-trust-box">
            {tt(
              'liveDealsTrustCopy',
              isEnglish
                ? 'This fare was detected by comparing it with the historical price pattern for this route.'
                : 'Questo prezzo e stato rilevato dal nostro motore confrontandolo con lo storico della tratta.'
            )}
          </div>
          {selectedDeal?.smartDeparture?.alternatives?.length > 0 ? (
            <section className="live-deal-smart-departure" data-testid="live-deal-smart-departure">
              <h4>{tt('liveDealsSmartDeparture', isEnglish ? 'Smart departure' : 'Partenza intelligente')}</h4>
              <p className="muted">
                {isEnglish
                  ? 'Same destination, better starting airport when convenient.'
                  : 'Stessa destinazione, aeroporto di partenza migliore quando conviene.'}
              </p>
              <div className="live-deal-smart-departure-list">
                {selectedDeal.smartDeparture.alternatives.map((alt) => (
                  <button
                    type="button"
                    key={`smart_departure_${selectedDeal.routeSlug}_${alt.origin}`}
                    className="live-deal-smart-departure-item"
                    onClick={() => onSmartDepartureClick(selectedDeal, alt)}
                  >
                    <span>{routeLabel(alt.origin, selectedDeal.destination)}</span>
                    <span>{formatPrice(alt.price, selectedDeal.currency)}</span>
                    <span>
                      {isEnglish
                        ? `Save ${formatPrice(alt.savingAbs, selectedDeal.currency)}`
                        : `Risparmi ${formatPrice(alt.savingAbs, selectedDeal.currency)}`}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
          <div className="item-actions">
            <button type="button" className="live-deals-primary-cta" onClick={() => openPreRedirect(selectedDeal)}>
              {tt('liveDealsGoBookingCta', isEnglish ? 'Go to booking' : 'Vai alla prenotazione')}
            </button>
            <button type="button" className="ghost" onClick={() => saveRoute(selectedDeal, 'detail_alert')}>
              {tt('liveDealsAlertCta', isEnglish ? 'Activate alert' : 'Attiva alert')}
            </button>
            {detailLevel === 'full' ? (
              <button type="button" className="ghost" onClick={() => saveRoute(selectedDeal, 'detail_save_route')}>
                {tt('liveDealsSaveRouteCta', isEnglish ? 'Save this route' : 'Salva questa rotta')}
              </button>
            ) : null}
            {detailLevel !== 'full' ? (
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  trackCoreEvent('upgrade_started', selectedDeal, { surface: 'live_deal_detail' });
                  onUpgradePro?.('more_deals');
                }}
              >
                {tt('liveDealsUpgradeCta', isEnglish ? 'Unlock more deals' : 'Sblocca piu deal')}
              </button>
            ) : null}
          </div>
          {similarDeals.length > 0 ? (
            <div className="live-deals-similar-wrap">
              <strong>{tt('liveDealsSimilarTitle', isEnglish ? 'Nearby alternatives' : 'Alternative vicine')}</strong>
              <div className="live-deals-similar-list">
                {similarDeals.map((item) => (
                  <button
                    type="button"
                    key={`similar_${item.routeSlug}_${item.detectedAt}`}
                    className="live-deals-similar-card"
                    onClick={() => openDetail(item)}
                  >
                    <span>{routeLabel(item.origin, item.destination)}</span>
                    <span>{formatPrice(item.price, item.currency)}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {preRedirectDeal ? (
        <div className="live-deals-preredirect-backdrop" role="dialog" aria-modal="true" data-testid="live-deals-preredirect">
          <div className="live-deals-preredirect">
            <h4>{tt('liveDealsPreRedirectTitle', isEnglish ? 'Before you continue to booking' : 'Prima di andare alla prenotazione')}</h4>
            <p className="live-deals-preredirect-route">{routeLabel(preRedirectDeal.origin, preRedirectDeal.destination)}</p>
            <p className="live-deals-preredirect-price">{formatPrice(preRedirectDeal.price, preRedirectDeal.currency)}</p>
            <p className="live-deals-preredirect-time">{relativeDetectedAt(preRedirectDeal.detectedAt, language)}</p>
            <p className="live-deals-preredirect-warning">
              {tt(
                'liveDealsPreRedirectWarning',
                isEnglish
                  ? 'We are sending you to the booking page. This fare can change quickly.'
                  : 'Ti stiamo portando alla prenotazione. Questo prezzo potrebbe cambiare rapidamente.'
              )}
            </p>
            <div className="item-actions">
              <button type="button" className="live-deals-primary-cta" onClick={continueToBooking} data-testid="live-deals-continue-booking">
                {tt('liveDealsPreRedirectContinue', isEnglish ? 'Continue to booking' : 'Continua alla prenotazione')}
              </button>
              <button type="button" className="ghost" onClick={() => saveRoute(preRedirectDeal, 'preredirect')}>
                {tt('liveDealsPreRedirectAlert', isEnglish ? 'Alert me if it drops again' : 'Avvisami se scende ancora')}
              </button>
              <button type="button" className="ghost" onClick={() => setPreRedirectDealId('')}>
                {tt('cancel', isEnglish ? 'Cancel' : 'Annulla')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
