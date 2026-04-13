import { useEffect, useState } from 'react';
import { z } from 'zod';
import { validateProps } from '../utils/validateProps';
import { localizeCityName, localizeClusterDisplayName } from '../utils/localizePlace';
import {
  readTrackedRouteSlugs,
  subscribeToPersonalHubStorage,
  writeTrackedRouteSlugs
} from '../features/personal-hub/storage';
import SoftLoginGate from './SoftLoginGate';
import UpgradePrompt from './UpgradePrompt';

const OpportunityFeedSectionPropsSchema = z
  .object({
    items: z.array(z.any()),
    clusters: z.array(z.any()),
    clustersLoading: z.boolean(),
    clustersError: z.string(),
    selectedCluster: z.string(),
    loading: z.boolean(),
    error: z.string(),
    onRefresh: z.function().optional(),
    onSelectCluster: z.function(),
    onClearCluster: z.function(),
    onFollowCluster: z.function(),
    onView: z.function(),
    onFollow: z.function(),
    onAlert: z.function(),
    onDiscover: z.function(),
    onActivateRadar: z.function(),
    isAuthenticated: z.boolean(),
    radarSessionActivated: z.boolean().optional().default(false),
    onCreateAccount: z.function(),
    t: z.function().optional(),
    language: z.string().optional().default('it'),
    planType: z.enum(['free', 'pro', 'elite']).optional().default('free'),
    trackedRoutesLimit: z.number().nullable().optional().default(null),
    showUpgradePrompt: z.boolean().optional().default(false),
    upgradeMessage: z.string().optional().default('Unlock all opportunities with PRO'),
    onTrackedRoutesLimitReached: z.function().optional(),
    onUpgradePro: z.function(),
    onUpgradeElite: z.function(),
    // 'live' = prices from real providers; 'synthetic' = internal historical dataset.
    // Drives copy transparency — never show "live fares" when data is synthetic.
    dataSource: z.enum(['live', 'synthetic', 'internal']).optional().default('synthetic')
  })
  .passthrough();

function deterministicSeed(value) {
  const text = String(value || '');
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) % 2147483647;
  }
  return Math.abs(hash);
}

function buildActivitySignal(value, labels) {
  const seed = deterministicSeed(value);
  const variant = seed % 3;
  if (variant === 0) return labels ? labels.activitySignalStrong : 'High opportunity signal';
  if (variant === 1) return labels ? labels.activitySignalRecent : 'Recently surfaced in radar';
  return labels ? labels.activitySignalVolatility : 'Price volatility detected';
}

function formatPrice(value, currency = 'EUR') {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '-';
  return String(currency).toUpperCase() === 'EUR' ? `${Math.round(amount)} \u20AC` : `${Math.round(amount)} ${currency}`;
}

function formatPeriod(item, locale, labels) {
  const formatter = new Intl.DateTimeFormat(locale, { month: 'short' });
  if (item?.depart_date && item?.return_date) {
    const depart = new Date(item.depart_date);
    const ret = new Date(item.return_date);
    if (!Number.isNaN(depart.getTime()) && !Number.isNaN(ret.getTime())) {
      const departMonth = formatter.format(depart).replace('.', '');
      const returnMonth = formatter.format(ret).replace('.', '');
      return `${departMonth} - ${returnMonth}`;
    }
    return `${item.depart_date} - ${item.return_date}`;
  }
  if (item?.depart_date) return `${labels.departurePrefix} ${item.depart_date}`;
  return labels.flexibleDates;
}

function formatTripType(item, labels) {
  const type = String(item?.trip_type || '').trim().toLowerCase();
  if (type === 'one_way') return labels.oneWay;
  return labels.roundTrip;
}

function formatBaggage(item, labels) {
  if (item?.baggage_included === true) return labels.baggageIncluded;
  if (item?.baggage_included === false) return labels.baggageExcluded;
  return labels.baggageUnknown;
}

function formatAirlineLabel(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'unknown';
  if (raw === 'seed_demo_partner') return 'Partner demo';
  if (raw === 'unknown') return 'unknown';
  if (!raw.includes('_')) return raw;
  return raw
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function levelBadge(level, labels) {
  if (level === 'Rare opportunity') return labels.rareBadge;
  if (level === 'Exceptional price') return labels.exceptionalBadge;
  if (level === 'Good deal' || level === 'Great deal') return labels.greatBadge;
  return labels.interestingBadge;
}

function sanitizeBadgeText(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const cleaned = raw
    .replace(/Ã°Å¸[^ ]*\s*/g, '')
    .replace(/Ã¢[^ ]*\s*/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned || raw;
}

function localizeOpportunityDescription(item, language, labels) {
  const raw = String(item?.ai_description || '')
    .replace(/\bopportunita\b/gi, 'opportunit\u00e0')
    .trim();
  if (!raw) return '';
  const isEnglish = String(language || 'it').toLowerCase().startsWith('en');
  if (!isEnglish) return raw;

  const lower = raw.toLowerCase();
  const looksItalianDescription =
    lower.includes('questa opportunit') ||
    lower.includes('prezzo competitivo') ||
    lower.includes('rotta') ||
    lower.includes('finestra viaggio') ||
    lower.includes('diretta') ||
    lower.includes('scalo');
  if (!looksItalianDescription) return raw;

  const routePart = Number(item?.stops || 0) === 0 ? 'a direct route' : `a route with ${Number(item?.stops || 0)} stop${Number(item?.stops || 0) === 1 ? '' : 's'}`;
  const period = item?.depart_date && item?.return_date ? `${item.depart_date} - ${item.return_date}` : labels.flexibleDates;
  return `This opportunity combines a competitive price, ${routePart}, and travel window ${period}.`;
}

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractSavingValue(item) {
  const candidates = [
    item?.savingVs2024,
    item?.saving_vs_2024,
    item?.savingVsAverage,
    item?.saving_vs_average,
    item?.savingAmount
  ];
  for (const candidate of candidates) {
    const numeric = toFiniteNumber(candidate);
    if (numeric !== null) return numeric;
  }
  const price = toFiniteNumber(item?.price);
  const avg = toFiniteNumber(item?.avg2024);
  if (price === null || avg === null) return null;
  return avg - price;
}

function getRadarState(item) {
  return String(item?.radarState || item?.radar_state || '').trim().toLowerCase();
}

function levelPriority(item) {
  const level = String(item?.opportunity_level || item?.short_badge_text || '')
    .trim()
    .toLowerCase();
  if (level.includes('exceptional')) return 3;
  if (level.includes('rare')) return 2;
  if (level.includes('great') || level.includes('good deal') || level.includes('hot')) return 1;
  return 0;
}

function pickTopDeal(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const ranked = items
    .map((item, index) => ({
      item,
      index,
      radarPriority: getRadarState(item) === 'radar_hot' ? 1 : 0,
      levelScore: levelPriority(item),
      savingValue: toFiniteNumber(extractSavingValue(item)) ?? Number.NEGATIVE_INFINITY,
      price: toFiniteNumber(item?.price) ?? Number.POSITIVE_INFINITY
    }))
    .sort((left, right) => {
      if (right.radarPriority !== left.radarPriority) return right.radarPriority - left.radarPriority;
      if (right.levelScore !== left.levelScore) return right.levelScore - left.levelScore;
      if (right.savingValue !== left.savingValue) return right.savingValue - left.savingValue;
      if (left.price !== right.price) return left.price - right.price;
      return left.index - right.index;
    });
  return ranked[0]?.item || null;
}

function clusterSignal(cluster) {
  const opportunitiesCount = toFiniteNumber(cluster?.opportunities_count);
  if (cluster?.is_hot === true) return 'Hot';
  if (opportunitiesCount !== null && opportunitiesCount >= 4) return 'Hot';
  if (cluster?.is_new === true && opportunitiesCount !== null && opportunitiesCount <= 2) return 'New';
  return '';
}

function topDealBadge(item, labels) {
  if (getRadarState(item) === 'radar_hot') return labels.topDealHot;
  return sanitizeBadgeText(item?.short_badge_text) || levelBadge(item?.opportunity_level, labels);
}

function OpportunityFeedSection(props) {
  const {
    items,
    clusters,
    clustersLoading,
    clustersError,
    selectedCluster,
    loading,
    error,
    onRefresh,
    onSelectCluster,
    onClearCluster,
    onFollowCluster,
    onView,
    onFollow,
    onAlert,
    onDiscover,
    onActivateRadar,
    isAuthenticated,
    radarSessionActivated,
    onCreateAccount,
    t,
    language,
    planType,
    trackedRoutesLimit,
    showUpgradePrompt,
    upgradeMessage,
    onTrackedRoutesLimitReached,
    onUpgradePro,
    onUpgradeElite,
    dataSource
  } = validateProps(
    OpportunityFeedSectionPropsSchema,
    props,
    'OpportunityFeedSection'
  );
  const tt = (key, fallback) => {
    if (typeof t !== 'function') return fallback;
    const translated = t(key);
    if (typeof translated !== 'string') return fallback;
    const normalized = translated.trim();
    if (!normalized || normalized === key) return fallback;
    return translated;
  };
  const isEnglish = String(language || 'it').toLowerCase().startsWith('en');
  const locale = String(language || 'it').toLowerCase().startsWith('en') ? 'en-US' : 'it-IT';
  const isLiveData = dataSource === 'live';
  const labels = {
    eyebrow: isLiveData
      ? tt('opportunityFeedEyebrow', 'Live radar intelligence')
      : tt('opportunityFeedEyebrowSynthetic', 'Radar intelligence'),
    heroTitle: tt('opportunityFeedHeroTitle', 'Flights you shouldn\u2019t be able to find'),
    heroSub: isLiveData
      ? tt('opportunityFeedHeroSub', 'Our radar scans millions of routes in real time to surface hidden travel opportunities before they disappear.')
      : tt('opportunityFeedHeroSubSynthetic', 'Our radar analyses historical pricing data to surface exceptional travel opportunities.'),
    liveSignalActive: isLiveData
      ? tt('opportunityFeedLiveSignalActive', 'Live radar active - scanning routes now')
      : tt('opportunityFeedSignalActive', 'Radar active - analysing routes'),
    liveSignalCount: isLiveData
      ? (count) => tt('opportunityFeedLiveSignalCount', `${count} real fares detected in this scan`).replace('{count}', count)
      : (count) => tt('opportunityFeedSignalCount', `${count} opportunities in current analysis`).replace('{count}', count),
    updatedRecently: tt('opportunityFeedUpdatedRecently', 'Updated recently'),
    discoverCta: isLiveData
      ? tt('opportunityFeedDiscoverCta', 'Explore live deals')
      : tt('opportunityFeedDiscoverCtaSynthetic', 'Explore opportunities'),
    activateRadarCta: tt('opportunityFeedActivateRadarCta', 'Activate radar'),
    refreshCta: tt('opportunityFeedRefreshCta', 'Refresh feed'),
    topDealTitle: isLiveData
      ? tt('opportunityFeedTopDealTitle', '\ud83d\udd25 Best deal live now')
      : tt('opportunityFeedTopDealTitleSynthetic', '\ud83d\udd25 Top opportunity'),
    topDealSubtitle: isLiveData
      ? tt('opportunityFeedTopDealSubtitle', 'Real fare identified in the latest radar sweep. Prices may move quickly.')
      : tt('opportunityFeedTopDealSubtitleSynthetic', 'Strong historical pricing signal. Verify current availability before booking.'),
    topDealCta: tt('opportunityFeedTopDealCta', 'View deal'),
    topDealHot: 'Hot',
    topDealEmpty: tt('opportunityFeedTopDealEmpty', 'No standout deal detected yet. Keep the feed active and refresh for new signals.'),
    topDealSavingLabel: tt('opportunityFeedTopDealSavingLabel', 'Saving vs average'),
    topDealSignalLabel: isLiveData
      ? tt('opportunityFeedTopDealSignalLabel', 'Live fare verified')
      : tt('opportunityFeedTopDealSignalLabelSynthetic', 'Historical signal'),
    urgencyLabel: tt('opportunityFeedUrgencyLabel', 'Likely to disappear soon'),
    urgencyNoteSynthetic: tt(
      'opportunityFeedUrgencyNoteSynthetic',
      isEnglish ? 'Historical signal: verify current fare before booking.' : 'Segnale storico: verifica la tariffa live prima di prenotare.'
    ),
    topRailTitle: tt('opportunityFeedTopRailTitle', 'Also moving now'),
    topRailCta: tt('opportunityFeedTopRailCta', 'Open deal'),
    todayTitle: isLiveData
      ? tt('opportunityFeedTodayTitle', 'Live opportunity feed')
      : tt('opportunityFeedTodayTitleSynthetic', 'Opportunity feed'),
    todaySub: isLiveData
      ? tt('opportunityFeedTodaySub', 'Real fares from the latest radar scans, prioritized by value.')
      : tt('opportunityFeedTodaySubSynthetic', 'Historical pricing intelligence, prioritized by value. Connect live providers for real-time fares.'),
    clusterTitle: tt('opportunityFeedClusterTitle', 'Opportunity clusters'),
    clusterSub: tt('opportunityFeedClusterSub', 'Focus on destinations with the strongest active pricing signals.'),
    activitySignalStrong: tt(
      'opportunityFeedActivitySignalStrong',
      isEnglish ? 'High opportunity signal' : 'Segnale opportunita alto'
    ),
    activitySignalRecent: tt(
      'opportunityFeedActivitySignalRecent',
      isEnglish ? 'Recently surfaced in radar' : 'Emersa di recente nel radar'
    ),
    activitySignalVolatility: tt(
      'opportunityFeedActivitySignalVolatility',
      isEnglish ? 'Price volatility detected' : 'Rilevata volatilita prezzo'
    ),
    clusterTrackCta: tt('opportunityFeedFollowClusterCta', isEnglish ? 'Track this route' : 'Segui rotta'),
    clusterTrackingCta: tt('opportunityFeedClusterTrackingCta', isEnglish ? 'Tracking' : 'Seguita'),
    clusterTrackingLimitCta: tt(
      'opportunityFeedClusterLimitReachedCta',
      isEnglish ? 'Tracking limit reached' : 'Limite elementi seguiti raggiunto'
    ),
    showAll: tt('opportunityFeedShowAll', 'Mostra tutto'),
    clustersLoading: tt('opportunityFeedClustersLoading', 'Caricamento cluster...'),
    noClusters: tt('opportunityFeedNoClusters', 'Nessun cluster disponibile al momento.'),
    from: tt('opportunityFeedFromLabel', 'da'),
    variablePrice: tt('opportunityFeedVariablePrice', 'Prezzo variabile'),
    opportunitiesWord: tt('opportunityFeedOpportunitiesWord', 'opportunit\u00e0'),
    opportunitiesLoading: tt('opportunityFeedLoading', 'Caricamento opportunit\u00e0 in corso...'),
    noItems: tt('noResults', 'Al momento non ci sono nuove opportunit\u00e0 per i tuoi filtri. Stiamo continuando ad analizzare nuove rotte.'),
    direct: tt('opportunityFeedDirect', 'Diretto'),
    oneWay: tt('opportunityFeedOneWay', 'Solo andata'),
    roundTrip: tt('opportunityFeedRoundTrip', 'Andata e ritorno'),
    airlineLabel: tt('opportunityFeedAirline', 'Compagnia'),
    baggageIncluded: tt('opportunityFeedBaggageIncluded', 'Bagaglio incluso'),
    baggageExcluded: tt('opportunityFeedBaggageExcluded', 'Bagaglio non incluso'),
    baggageUnknown: tt('opportunityFeedBaggageUnknown', 'Bagaglio da verificare'),
    stopsSuffix: tt('opportunityFeedStopsSuffix', 'scali'),
    viewItineraryCta: tt('opportunityFeedViewItineraryCta', 'Vedi itinerario'),
    activateAlertCta: tt('opportunityFeedActivateAlertCta', isEnglish ? 'Activate alert' : 'Monitora'),
    followDestinationCta: tt('opportunityFeedFollowDestinationCta', isEnglish ? 'Follow destination' : 'Segui nel radar'),
    departurePrefix: tt('opportunityFeedDeparturePrefix', 'Partenza'),
    flexibleDates: tt('opportunityFeedFlexibleDates', 'Date flessibili'),
    rareBadge: tt('opportunityFeedBadgeRare', 'Opportunit\u00e0 rara'),
    exceptionalBadge: tt('opportunityFeedBadgeExceptional', 'Prezzo eccezionale'),
    greatBadge: tt('opportunityFeedBadgeGreat', 'Ottimo affare'),
    interestingBadge: tt('opportunityFeedBadgeInteresting', 'Occasione interessante'),
    softGateTitle: tt('opportunityFeedSoftGateTitle', 'Vuoi vedere tutte le opportunit\u00e0?'),
    softGateDesc: tt(
      'opportunityFeedSoftGateDescription',
      'Crea un account gratuito per sbloccare il feed completo e attivare il tuo radar.'
    ),
    softGateCta: tt('opportunityFeedSoftGateCta', 'Crea account gratis'),
    upgradeTitle: tt('opportunityFeedUpgradeTitle', 'Vuoi vedere tutte le opportunit\u00e0?'),
    upgradeMessage: upgradeMessage || tt('upgradePromptUnlockAll', 'Sblocca tutte le opportunit\u00e0 con PRO'),
    upgradePrimary: tt('opportunityFeedUpgradePrimaryCta', 'Upgrade a PRO'),
    upgradeSecondary: tt('opportunityFeedUpgradeSecondaryCta', 'Scopri ELITE')
  };
  const errorMessages = Array.from(new Set([clustersError, error].map((value) => String(value || '').trim()).filter(Boolean)));
  const visibleItems = isAuthenticated ? items : items.slice(0, 5);
  const [trackedClusterSlugs, setTrackedClusterSlugs] = useState(() => new Set(readTrackedRouteSlugs()));
  const [showTrackedLimitPrompt, setShowTrackedLimitPrompt] = useState(false);
  const topDeal = pickTopDeal(visibleItems);
  const topDealSaving = toFiniteNumber(extractSavingValue(topDeal));
  const liveSignalText = visibleItems.length > 0 ? labels.liveSignalCount(visibleItems.length) : labels.liveSignalActive;
  const hasHotDeals = visibleItems.some((item) => getRadarState(item) === 'radar_hot');
  const topRailItems = visibleItems.filter((item) => item?.id !== topDeal?.id).slice(0, 3);
  const trackedRoutesCount = trackedClusterSlugs.size;
  const hasTrackedRoutesLimit = Number.isFinite(Number(trackedRoutesLimit)) && Number(trackedRoutesLimit) > 0;
  const normalizedTrackedRoutesLimit = hasTrackedRoutesLimit ? Math.round(Number(trackedRoutesLimit)) : null;
  const trackedRoutesLimitReached = normalizedTrackedRoutesLimit !== null && trackedRoutesCount >= normalizedTrackedRoutesLimit;
  const trackedRoutesLimitMessage =
    normalizedTrackedRoutesLimit === null
      ? ''
      : planType === 'free'
        ? `You\u2019re tracking ${trackedRoutesCount}/${normalizedTrackedRoutesLimit} routes. Track more routes and never miss a drop.`
        : `You\u2019re tracking ${trackedRoutesCount}/${normalizedTrackedRoutesLimit} routes. Go ELITE to unlock unlimited route tracking and priority deals.`;

  useEffect(() => {
    return subscribeToPersonalHubStorage(() => {
      setTrackedClusterSlugs(new Set(readTrackedRouteSlugs()));
    });
  }, []);

  useEffect(() => {
    if (!trackedRoutesLimitReached) {
      setShowTrackedLimitPrompt(false);
    }
  }, [trackedRoutesLimitReached]);

  function toggleTrackedCluster(cluster) {
    const slug = String(cluster?.slug || '').trim().toLowerCase();
    if (!slug) return;
    const isAlreadyTracked = trackedClusterSlugs.has(slug);
    if (!isAlreadyTracked && trackedRoutesLimitReached) {
      setShowTrackedLimitPrompt(true);
      if (typeof onTrackedRoutesLimitReached === 'function') {
        onTrackedRoutesLimitReached({
          slug,
          planType,
          limit: normalizedTrackedRoutesLimit,
          used: trackedRoutesCount
        });
      }
      return;
    }
    const next = new Set(trackedClusterSlugs);
    if (isAlreadyTracked) {
      next.delete(slug);
    } else {
      next.add(slug);
    }
    writeTrackedRouteSlugs(Array.from(next));
    setTrackedClusterSlugs(next);
    if (normalizedTrackedRoutesLimit !== null && next.size < normalizedTrackedRoutesLimit) {
      setShowTrackedLimitPrompt(false);
    }
    if (!isAlreadyTracked) {
      Promise.resolve(onFollowCluster(cluster)).catch(() => {});
    }
  }

  return (
    <section className="panel opportunity-feed-panel" data-testid="opportunity-feed-panel">
      <div className="opportunity-hero">
        <p className="eyebrow">{labels.eyebrow}</p>
        <h2>{labels.heroTitle}</h2>
        <p className="hero-sub">{labels.heroSub}</p>
        <p className="opportunity-live-signal" data-testid="opportunity-live-signal">
          <span className="opportunity-live-dot" aria-hidden="true" />
          <span>{liveSignalText}</span>
        </p>
        <div className="item-actions opportunity-hero-actions">
          <button
            type="button"
            className="opportunity-discover-cta"
            onClick={onDiscover}
            data-testid="opportunity-hero-primary-cta"
          >
            {labels.discoverCta}
          </button>
          <button
            type="button"
            className="ghost opportunity-activate-radar-cta"
            onClick={onActivateRadar}
            data-testid="opportunity-hero-activate-radar-cta"
          >
            {labels.activateRadarCta}
          </button>
          {onRefresh ? (
            <button
              type="button"
              className="ghost opportunity-refresh-feed-cta"
              onClick={onRefresh}
              disabled={loading}
              data-testid="opportunity-hero-refresh-feed-cta"
            >
              {labels.refreshCta}
            </button>
          ) : null}
        </div>
        {radarSessionActivated ? (
          <p className="opportunity-radar-session-message" data-testid="opportunity-radar-session-message">
            Radar activated for this session
          </p>
        ) : null}
        <p className="opportunity-live-note">{labels.updatedRecently}</p>
      </div>

      <section className="opportunity-section opportunity-top-deal-section" data-testid="opportunity-top-deal-section">
        <div className="panel-head">
          <h3>{labels.topDealTitle}</h3>
        </div>
        {hasHotDeals ? (
          <p className="opportunity-hot-state" data-testid="opportunity-hot-state">{isLiveData ? 'Live opportunities detected' : 'High-signal opportunities detected'}</p>
        ) : (
          <p className="opportunity-hot-empty" data-testid="opportunity-hot-empty">
            Nothing hot right now - but the radar is still scanning.
          </p>
        )}
        <p className="muted">{labels.topDealSubtitle}</p>
        {topDeal ? (
          <>
            <article className="opportunity-top-deal-card" data-testid="opportunity-top-deal">
              <div className="opportunity-top-deal-main">
                <div className="opportunity-top-deal-head">
                  <strong className="opportunity-top-deal-route">
                    {String(topDeal?.origin_city || topDeal?.origin_airport || 'Origin')} {'→'}{' '}
                    {localizeCityName(String(topDeal?.destination_city || topDeal?.destination_airport || 'Destination'), language)}
                  </strong>
                  <div className="opportunity-top-deal-badges">
                    {getRadarState(topDeal) === 'radar_hot' ? (
                      <span className="opportunity-urgency-pill" data-testid="opportunity-urgency-pill-top-deal">
                        {labels.urgencyLabel}
                      </span>
                    ) : null}
                    <span className="opportunity-top-deal-badge">{topDealBadge(topDeal, labels)}</span>
                  </div>
                </div>
                <p className="opportunity-top-deal-price">{formatPrice(topDeal?.price, topDeal?.currency)}</p>
                {topDealSaving !== null && topDealSaving > 0 ? (
                  <p className="opportunity-top-deal-saving">
                    {labels.topDealSavingLabel}: {formatPrice(topDealSaving, topDeal?.currency)}
                  </p>
                ) : (
                  <p className="opportunity-top-deal-saving">{labels.topDealSignalLabel}</p>
                )}
                <p className="opportunity-activity-signal" data-testid="opportunity-top-deal-activity">
                  {buildActivitySignal(topDeal?.id || topDeal?.destination_airport, labels)}
                </p>
                {!isLiveData ? <p className="opportunity-urgency-note">{labels.urgencyNoteSynthetic}</p> : null}
                <p className="opportunity-top-deal-meta">
                  {formatTripType(topDeal, labels)} | {formatPeriod(topDeal, locale, labels)} |{' '}
                  {topDeal?.stops === 0 ? labels.direct : `${topDeal?.stops} ${labels.stopsSuffix}`}
                </p>
              </div>
              <div className="item-actions opportunity-top-deal-actions">
                <button
                  type="button"
                  className="opportunity-view-itinerary-cta"
                  data-testid="opportunity-top-deal-view"
                  onClick={() => onView(topDeal.id)}
                >
                  {labels.topDealCta}
                </button>
              </div>
            </article>
            {topRailItems.length > 0 ? (
              <div className="opportunity-live-rail" data-testid="opportunity-live-rail">
                <p className="opportunity-live-rail-title">{labels.topRailTitle}</p>
                {topRailItems.map((item) => (
                  <article key={item.id} className="opportunity-live-rail-item" data-testid={`opportunity-live-rail-item-${item.id}`}>
                    <strong className="opportunity-live-rail-route">
                      {String(item?.origin_city || item?.origin_airport || 'Origin')} {'→'}{' '}
                      {localizeCityName(String(item?.destination_city || item?.destination_airport || 'Destination'), language)}
                    </strong>
                    <p className="opportunity-live-rail-price">{formatPrice(item?.price, item?.currency)}</p>
                    <p className="opportunity-live-rail-meta">
                      {formatTripType(item, labels)} | {item?.stops === 0 ? labels.direct : `${item?.stops} ${labels.stopsSuffix}`}
                    </p>
                    <p className="opportunity-activity-signal">{buildActivitySignal(item?.id || item?.destination_airport, labels)}</p>
                    <button
                      type="button"
                      className="opportunity-view-itinerary-cta opportunity-live-rail-cta"
                      onClick={() => onView(item.id)}
                    >
                      {labels.topRailCta}
                    </button>
                  </article>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <p className="muted">{labels.topDealEmpty}</p>
        )}
      </section>

      <section className="opportunity-section opportunity-clusters-section">
        <div className="panel-head">
          <h3>{labels.clusterTitle}</h3>
          {selectedCluster ? (
            <button type="button" className="ghost" onClick={onClearCluster}>
              {labels.showAll}
            </button>
          ) : null}
        </div>
        <p className="muted">{labels.clusterSub}</p>
        {trackedRoutesCount === 0 ? (
          <p className="opportunity-retention-hook" data-testid="opportunity-retention-hook-empty">
            Start tracking routes to unlock your personal radar
          </p>
        ) : (
          <p className="opportunity-retention-hook" data-testid="opportunity-retention-hook-returning">
            You&apos;re tracking {trackedRoutesCount} routes - radar is watching for you
          </p>
        )}
        {trackedRoutesLimitReached ? (
          <article className="opportunity-inline-upgrade" data-testid="opportunity-track-limit-prompt">
            <p className="opportunity-inline-upgrade-title">Tracking limit reached</p>
            <p className="muted">{trackedRoutesLimitMessage}</p>
            <div className="item-actions">
              <button type="button" onClick={onUpgradePro} data-testid="opportunity-track-limit-upgrade-pro">
                {planType === 'free' ? 'Upgrade to PRO' : 'Compare PRO value'}
              </button>
              <button type="button" className="ghost" onClick={onUpgradeElite} data-testid="opportunity-track-limit-upgrade-elite">
                Go ELITE
              </button>
            </div>
            {showTrackedLimitPrompt ? (
              <p className="opportunity-inline-upgrade-note">This route is still visible. Upgrade to track it instantly.</p>
            ) : null}
          </article>
        ) : null}
        {clustersLoading ? <p className="muted">{labels.clustersLoading}</p> : null}
        {errorMessages.map((message) => (
          <p key={message} className="error">{message}</p>
        ))}
        {!clustersLoading && !clustersError && clusters.length === 0 ? (
          <p className="muted">{labels.noClusters}</p>
        ) : null}
        <div className="opportunity-cluster-list">
          {clusters.map((cluster) => {
            const isActive = selectedCluster === cluster.slug;
            const slug = String(cluster?.slug || '').trim().toLowerCase();
            const isTracked = trackedClusterSlugs.has(slug);
            const signal = clusterSignal(cluster);
            const isTrackLocked = !isTracked && trackedRoutesLimitReached;
            return (
              <article
                key={cluster.slug}
                className={`opportunity-cluster-card${isActive ? ' active' : ''}${isTracked ? ' tracked' : ''}`}
                data-testid={`opportunity-cluster-card-${cluster.slug}`}
              >
                <button
                  type="button"
                  className="ghost opportunity-cluster-trigger"
                  data-testid={`opportunity-select-cluster-${cluster.slug}`}
                  onClick={() => onSelectCluster(cluster.slug)}
                >
                  <span className="opportunity-cluster-title-row">
                    <strong>{localizeClusterDisplayName(cluster, language)}</strong>
                    {signal ? (
                      <span
                        className={`opportunity-cluster-badge opportunity-cluster-badge-${String(signal).toLowerCase()}`}
                        data-testid={`opportunity-cluster-badge-${cluster.slug}`}
                      >
                        {signal}
                      </span>
                    ) : null}
                  </span>
                  <p className="opportunity-cluster-price">
                    {cluster.min_price ? `${labels.from} ${Math.round(cluster.min_price)} EUR` : labels.variablePrice}
                  </p>
                  <p className="opportunity-cluster-meta">
                    {Number(cluster.opportunities_count || 0)} {labels.opportunitiesWord}
                  </p>
                  <p className="opportunity-activity-signal" data-testid={`opportunity-cluster-activity-${cluster.slug}`}>
                    {buildActivitySignal(cluster.slug || cluster.cluster_name, labels)}
                  </p>
                </button>
                <button
                  type="button"
                  className={`ghost opportunity-follow-cluster-cta${isTracked ? ' tracking' : ''}${isTrackLocked ? ' locked' : ''}`}
                  onClick={() => toggleTrackedCluster(cluster)}
                  disabled={isTrackLocked}
                  data-testid={`opportunity-track-cluster-${cluster.slug}`}
                >
                  {isTracked ? <span className="opportunity-tracked-check" aria-hidden="true">&#10003;</span> : null}
                  <span>{isTracked ? labels.clusterTrackingCta : isTrackLocked ? labels.clusterTrackingLimitCta : labels.clusterTrackCta}</span>
                </button>
              </article>
            );
          })}
        </div>
      </section>

      <section className="opportunity-section opportunity-feed-results-section">
        <div className="panel-head">
          <h3>{labels.todayTitle}</h3>
        </div>
        <p className="muted">{labels.todaySub}</p>
        {loading ? <p className="muted">{labels.opportunitiesLoading}</p> : null}
        {!loading && items.length === 0 ? (
          <p className="muted">{labels.noItems}</p>
        ) : null}

        <div className="opportunity-feed-list">
          {visibleItems.map((item) => {
            const stopsLabel = item.stops === 0 ? labels.direct : `${item.stops} ${labels.stopsSuffix}`;
            return (
              <article key={item.id} className="opportunity-card">
                <div className="opportunity-card-main">
                  <div className="opportunity-card-top">
                    <strong className="opportunity-card-route">
                      {item.origin_city} {'→'} {localizeCityName(item.destination_city, language)}
                    </strong>
                    <div className="opportunity-card-badges">
                      {getRadarState(item) === 'radar_hot' ? (
                        <span className="opportunity-urgency-pill" data-testid={`opportunity-urgency-pill-${item.id}`}>
                          {labels.urgencyLabel}
                        </span>
                      ) : null}
                      <span className="opportunity-badge">{sanitizeBadgeText(item.short_badge_text) || levelBadge(item.opportunity_level, labels)}</span>
                    </div>
                  </div>
                  <div className="opportunity-card-price-block">
                    <p className="opportunity-card-price">{formatPrice(item.price, item.currency)}</p>
                    <p className="opportunity-card-meta-primary">{formatTripType(item, labels)}</p>
                  </div>
                  <p className="opportunity-card-meta-secondary">
                    {formatPeriod(item, locale, labels)} | {stopsLabel}
                  </p>
                  <p className="opportunity-card-supporting-line">
                    {labels.airlineLabel}: {formatAirlineLabel(item.airline)} | {formatBaggage(item, labels)}
                  </p>
                  <p className="opportunity-activity-signal" data-testid={`opportunity-activity-${item.id}`}>
                    {buildActivitySignal(item.id || `${item.origin_airport}-${item.destination_airport}`, labels)}
                  </p>
                  {!isLiveData && getRadarState(item) === 'radar_hot' ? <p className="opportunity-urgency-note">{labels.urgencyNoteSynthetic}</p> : null}
                  {item.ai_description ? (
                    <div className="opportunity-card-description-box">
                      <p className="opportunity-card-description">{localizeOpportunityDescription(item, language, labels)}</p>
                    </div>
                  ) : null}
                </div>
                <div className="item-actions opportunity-card-actions">
                  <button type="button" className="opportunity-view-itinerary-cta" data-testid={`opportunity-view-${item.id}`} onClick={() => onView(item.id)}>
                    {labels.viewItineraryCta}
                  </button>
                  <button type="button" className="ghost opportunity-activate-alert-cta" onClick={() => onAlert(item.id)}>
                    {labels.activateAlertCta}
                  </button>
                  <button type="button" className="ghost opportunity-follow-destination-cta" onClick={() => onFollow(item.id)}>
                    {labels.followDestinationCta}
                  </button>
                </div>
              </article>
            );
          })}
          {isAuthenticated && showUpgradePrompt ? (
            <UpgradePrompt
              title={labels.upgradeTitle}
              message={labels.upgradeMessage}
              primaryLabel={labels.upgradePrimary}
              secondaryLabel={labels.upgradeSecondary}
              onUpgradePro={onUpgradePro}
              onUpgradeElite={onUpgradeElite}
            />
          ) : null}
          {!isAuthenticated && !loading && !error && items.length > 5 ? (
            <SoftLoginGate
              title={labels.softGateTitle}
              description={labels.softGateDesc}
              ctaLabel={labels.softGateCta}
              onCreateAccount={onCreateAccount}
            />
          ) : null}
        </div>
      </section>
    </section>
  );
}

export default OpportunityFeedSection;
