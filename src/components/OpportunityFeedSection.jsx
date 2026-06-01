import { useEffect, useState } from 'react';
import { z } from 'zod';
import { validateProps } from '../utils/validateProps';
import {
  formatRouteDisplayName,
  hasReadableOfferRouteDisplayName,
  localizeClusterDisplayName
} from '../utils/localizePlace';
import {
  readTrackedRouteSlugs,
  subscribeToPersonalHubStorage,
  writeTrackedRouteSlugs
} from '../features/personal-hub/storage';
import {
  buildActivitySignal,
  clusterSignal,
  extractSavingValue,
  formatAirlineLabel,
  formatBaggage,
  formatPeriod,
  formatPrice,
  formatTripType,
  getRadarState,
  levelBadge,
  localizeOpportunityDescription,
  pickTopDeal,
  sanitizeBadgeText,
  toFiniteNumber,
  topDealBadge
} from './opportunity-feed-helpers';
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
    // Drives copy transparency for cached vs provider-backed inventory.
    dataSource: z.enum(['live', 'synthetic', 'internal', 'cached']).optional().default('synthetic')
  })
  .passthrough();

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
    isAuthenticated,
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
  const isFreePlan = planType === 'free';
  const labels = {
    eyebrow: isFreePlan
      ? tt('opportunityFeedEyebrowFree', 'Public cached deals')
      : isLiveData
      ? tt('opportunityFeedEyebrow', 'Provider-validated opportunities')
      : tt('opportunityFeedEyebrowSynthetic', 'Radar intelligence'),
    heroTitle: tt('opportunityFeedHeroTitle', 'Your travel opportunity radar'),
    heroSub: isFreePlan
      ? tt('opportunityFeedHeroSubFree', 'Public cached deals, basic route insights, cached radar preview, and price trend preview.')
      : isLiveData
      ? tt('opportunityFeedHeroSub', 'Our radar scans millions of routes in real time to surface hidden travel opportunities before they disappear.')
      : tt('opportunityFeedHeroSubSynthetic', 'We rank pricing signals, route patterns, and timing windows so you can inspect the best opportunities first.'),
    liveSignalActive: isFreePlan
      ? tt('opportunityFeedCachedRadarActive', 'Cached radar preview active')
      : isLiveData
      ? tt('opportunityFeedLiveSignalActive', 'Provider checks active when configured')
      : tt('opportunityFeedSignalActive', 'Radar active - analysing routes'),
    liveSignalCount: isFreePlan
      ? (count) => tt('opportunityFeedCachedDealCount', `${count} public cached deals`).replace('{count}', count)
      : isLiveData
      ? (count) => tt('opportunityFeedLiveSignalCount', `${count} real fares detected in this scan`).replace('{count}', count)
      : (count) => tt('opportunityFeedSignalCount', `${count} opportunities in current analysis`).replace('{count}', count),
    updatedRecently: tt('opportunityFeedUpdatedRecently', 'Updated recently'),
    discoverCta: isFreePlan
      ? tt('opportunityFeedDiscoverCtaFree', isEnglish ? 'Explore free previews' : 'Esplora anteprime gratuite')
      : isLiveData
      ? tt('opportunityFeedDiscoverCta', 'Explore live deals')
      : tt('opportunityFeedDiscoverCtaSynthetic', 'Explore opportunities'),
    activateRadarCta: isFreePlan ? tt('opportunityFeedCachedRadarCta', 'Cached radar preview') : tt('opportunityFeedActivateRadarCta', 'Activate radar'),
    refreshCta: isFreePlan ? tt('opportunityFeedUpgradeForLiveRefresh', 'Upgrade for live refresh') : tt('opportunityFeedRefreshCta', 'Refresh feed'),
    topDealTitle: isLiveData
      ? tt('opportunityFeedTopDealTitle', '\ud83d\udd25 Best deal live now')
      : tt('opportunityFeedTopDealTitleSynthetic', 'Top opportunity'),
    topDealSubtitle: isLiveData
      ? tt('opportunityFeedTopDealSubtitle', 'Real fare identified in the latest radar sweep. Prices may move quickly.')
      : tt('opportunityFeedTopDealSubtitleSynthetic', 'Strong pricing signal. Verify current availability before booking.'),
    topDealCta: tt('opportunityFeedTopDealCta', isEnglish ? 'View details' : 'Vedi dettagli'),
    topDealHot: 'Hot',
    topDealEmpty: tt('opportunityFeedTopDealEmpty', 'No high-priority signal right now; the radar is still scanning.'),
    topDealSavingLabel: tt('opportunityFeedTopDealSavingLabel', 'Saving vs average'),
    topDealSignalLabel: isLiveData
      ? tt('opportunityFeedTopDealSignalLabel', isEnglish ? 'Live fare verified' : 'Tariffa live verificata')
      : tt('opportunityFeedTopDealSignalLabelSynthetic', isEnglish ? 'Historical pricing signal' : 'Dato storico'),
    hotStateLive: tt('opportunityFeedHotStateLive', isEnglish ? 'Live opportunities detected' : 'Opportunità live rilevate'),
    hotStateSynthetic: tt('opportunityFeedHotStateSynthetic', isEnglish ? 'High-signal opportunities detected' : 'Opportunità ad alto segnale rilevate'),
    urgencyLabel: tt('opportunityFeedUrgencyLabel', 'Likely to disappear soon'),
    urgencyNoteSynthetic: tt(
      'opportunityFeedUrgencyNoteSynthetic',
      isEnglish ? 'Cached signal: check the current fare before booking.' : 'Dato non live: verifica la tariffa aggiornata prima di prenotare.'
    ),
    topRailTitle: isFreePlan ? tt('opportunityFeedMoreCachedDeals', 'More public cached deals') : tt('opportunityFeedTopRailTitle', 'Also moving now'),
    topRailCta: tt('opportunityFeedTopRailCta', 'Open deal'),
    todayTitle: isFreePlan
      ? tt('opportunityFeedTodayTitleFree', 'Public cached deals')
      : isLiveData
      ? tt('opportunityFeedTodayTitle', 'Live opportunity feed')
      : tt('opportunityFeedTodayTitleSynthetic', 'Opportunity feed'),
    todaySub: isFreePlan
      ? tt('opportunityFeedTodaySubFree', 'Cached public scans with deterministic price signals. Upgrade for live scans, AI tools, and route alerts when delivery is enabled.')
      : isLiveData
      ? tt('opportunityFeedTodaySub', 'Real fares from the latest radar scans, prioritized by value.')
      : tt('opportunityFeedTodaySubSynthetic', 'Ranked opportunities from pricing history and route signals. Confirm the live fare before booking.'),
    clusterTitle: tt('opportunityFeedClusterTitle', 'Opportunity clusters'),
    clusterSub: tt('opportunityFeedClusterSub', 'Focus on destinations with the strongest active pricing signals.'),
    trackingEmpty: tt('opportunityFeedTrackingEmpty', isEnglish ? 'Track routes to build your personal radar' : 'Segui le rotte per creare il tuo radar personale'),
    trackingActive: (count) => tt(
      'opportunityFeedTrackingActive',
      isEnglish ? `Tracking ${count} routes - radar is watching for you` : `${count} rotte seguite - il radar le monitora per te`
    ).replace('{count}', count),
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
    activateAlertCta: isFreePlan ? tt('opportunityFeedUpgradeForAlerts', 'Upgrade for alerts') : tt('opportunityFeedActivateAlertCta', isEnglish ? 'Activate alert' : 'Monitora'),
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
    softGateEyebrow: tt('softLoginGateEyebrow', isEnglish ? 'Unlock full feed' : 'Sblocca il feed completo'),
    softGateNote: tt('softLoginGateNote', isEnglish ? 'Fast signup, no payment required for the Free plan.' : 'Registrazione rapida, nessun pagamento richiesto per il piano Free.'),
    trackingLimitTitle: tt('opportunityFeedTrackingLimitTitle', isEnglish ? 'Tracking limit reached' : 'Limite elementi seguiti raggiunto'),
    trackingLimitFreeMessage: tt('opportunityFeedTrackingLimitFreeMessage', isEnglish ? 'You are tracking {count}/{limit} routes. Upgrade to track more routes and avoid missing drops.' : 'Stai seguendo {count}/{limit} rotte. Passa a PRO per seguire piu rotte e non perdere i cali prezzo.'),
    trackingLimitPaidMessage: tt('opportunityFeedTrackingLimitPaidMessage', isEnglish ? 'You are tracking {count}/{limit} routes. Go ELITE to unlock unlimited route tracking and priority deals.' : 'Stai seguendo {count}/{limit} rotte. Passa a ELITE per tracking illimitato e deal prioritari.'),
    trackingLimitProCta: tt('opportunityFeedTrackingLimitProCta', isEnglish ? 'Upgrade to PRO' : 'Passa a PRO'),
    trackingLimitCompareCta: tt('opportunityFeedTrackingLimitCompareCta', isEnglish ? 'Compare PRO value' : 'Confronta PRO'),
    trackingLimitEliteCta: tt('opportunityFeedTrackingLimitEliteCta', isEnglish ? 'Go ELITE' : 'Passa a ELITE'),
    trackingLimitNote: tt('opportunityFeedTrackingLimitNote', isEnglish ? 'This route is still visible. Upgrade to track it instantly.' : 'Questa rotta resta visibile. Fai upgrade per seguirla subito.'),
    upgradeTitle: tt('opportunityFeedUpgradeTitle', 'Vuoi vedere tutte le opportunit\u00e0?'),
    upgradeMessage: upgradeMessage || tt('upgradePromptUnlockAll', 'Sblocca tutte le opportunit\u00e0 con PRO'),
    upgradePrimary: tt('opportunityFeedUpgradePrimaryCta', 'Upgrade a PRO'),
    upgradeSecondary: tt('opportunityFeedUpgradeSecondaryCta', 'Scopri ELITE')
  };
  const errorMessages = Array.from(new Set([clustersError, error].map((value) => String(value || '').trim()).filter(Boolean)));
  const visibleItems = (isAuthenticated ? items : items.slice(0, 5)).filter((item) => {
    const airline = String(item?.airline || '').trim().toLowerCase();
    if (airline.includes('unit_test')) return false;
    return hasReadableOfferRouteDisplayName(item, language);
  });
  const visibleClusters = clusters.filter((cluster) => {
    const displayName = localizeClusterDisplayName(cluster, language);
    if (!displayName) return false;
    const opportunitiesCount = Number(cluster?.opportunities_count || 0);
    const minPrice = Number(cluster?.min_price);
    return opportunitiesCount >= 2 || (Number.isFinite(minPrice) && minPrice < 180);
  });
  const shouldShowClusters = Boolean(selectedCluster || clustersLoading || clustersError) || visibleClusters.length >= 2;
  const [trackedClusterSlugs, setTrackedClusterSlugs] = useState(() => new Set(readTrackedRouteSlugs()));
  const [showTrackedLimitPrompt, setShowTrackedLimitPrompt] = useState(false);
  const topDeal = pickTopDeal(visibleItems);
  const topDealSaving = toFiniteNumber(extractSavingValue(topDeal));
  const hasHotDeals = visibleItems.some((item) => getRadarState(item) === 'radar_hot');
  const topRailItems = isLiveData ? visibleItems.filter((item) => item?.id !== topDeal?.id).slice(0, 3) : [];
  const trackedRoutesCount = trackedClusterSlugs.size;
  const hasTrackedRoutesLimit = Number.isFinite(Number(trackedRoutesLimit)) && Number(trackedRoutesLimit) > 0;
  const normalizedTrackedRoutesLimit = hasTrackedRoutesLimit ? Math.round(Number(trackedRoutesLimit)) : null;
  const trackedRoutesLimitReached = normalizedTrackedRoutesLimit !== null && trackedRoutesCount >= normalizedTrackedRoutesLimit;
  const trackedRoutesLimitMessage =
    normalizedTrackedRoutesLimit === null
      ? ''
      : planType === 'free'
        ? labels.trackingLimitFreeMessage.replace('{count}', trackedRoutesCount).replace('{limit}', normalizedTrackedRoutesLimit)
        : labels.trackingLimitPaidMessage.replace('{count}', trackedRoutesCount).replace('{limit}', normalizedTrackedRoutesLimit);

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
      <section className="opportunity-section opportunity-top-deal-section" data-testid="opportunity-top-deal-section">
        <div className="panel-head">
          <h3>{labels.topDealTitle}</h3>
        </div>
        {hasHotDeals ? (
          <p className="opportunity-hot-state" data-testid="opportunity-hot-state">{isLiveData ? labels.hotStateLive : labels.hotStateSynthetic}</p>
        ) : (
          <p className="opportunity-hot-empty" data-testid="opportunity-hot-empty">
            {labels.topDealEmpty}
          </p>
        )}
        <p className="muted">{labels.topDealSubtitle}</p>
        {topDeal ? (
          <>
            <article className="opportunity-top-deal-card" data-testid="opportunity-top-deal">
              <div className="opportunity-top-deal-main">
                <div className="opportunity-top-deal-head">
                  <strong className="opportunity-top-deal-route">{formatRouteDisplayName(topDeal, language)}</strong>
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
                <div className="opportunity-top-deal-badges">
                  {getRadarState(topDeal) === 'radar_hot' ? (
                    <span className="opportunity-urgency-pill" data-testid="opportunity-urgency-pill-top-deal">
                      {labels.urgencyLabel}
                    </span>
                  ) : null}
                  <span className="opportunity-top-deal-badge">{topDealBadge(topDeal, labels)}</span>
                </div>
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
                    <div className="opportunity-live-rail-head">
                      <div className="opportunity-live-rail-route-block">
                        <strong className="opportunity-live-rail-route">{formatRouteDisplayName(item, language)}</strong>
                      </div>
                      <span className="opportunity-live-rail-mini-badge">{topDealBadge(item, labels)}</span>
                    </div>
                    <div className="opportunity-live-rail-value">
                      <p className="opportunity-live-rail-price">{formatPrice(item?.price, item?.currency)}</p>
                      <p className="opportunity-live-rail-meta">
                        {formatTripType(item, labels)} | {item?.stops === 0 ? labels.direct : `${item?.stops} ${labels.stopsSuffix}`}
                      </p>
                    </div>
                    <div className="opportunity-live-rail-footer">
                      <p className="opportunity-activity-signal">{buildActivitySignal(item?.id || item?.destination_airport, labels)}</p>
                      <button
                        type="button"
                        className="opportunity-view-itinerary-cta opportunity-live-rail-cta"
                        onClick={() => onView(item.id)}
                      >
                        {labels.topRailCta}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <p className="muted">{labels.topDealEmpty}</p>
        )}
      </section>

      {shouldShowClusters ? (
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
            {labels.trackingEmpty}
          </p>
        ) : (
          <p className="opportunity-retention-hook" data-testid="opportunity-retention-hook-returning">
            {labels.trackingActive(trackedRoutesCount)}
          </p>
        )}
        {trackedRoutesLimitReached ? (
          <article className="opportunity-inline-upgrade" data-testid="opportunity-track-limit-prompt">
            <p className="opportunity-inline-upgrade-title">{labels.trackingLimitTitle}</p>
            <p className="muted">{trackedRoutesLimitMessage}</p>
            <div className="item-actions">
              <button type="button" onClick={onUpgradePro} data-testid="opportunity-track-limit-upgrade-pro">
                {planType === 'free' ? labels.trackingLimitProCta : labels.trackingLimitCompareCta}
              </button>
              <button type="button" className="ghost" onClick={onUpgradeElite} data-testid="opportunity-track-limit-upgrade-elite">
                {labels.trackingLimitEliteCta}
              </button>
            </div>
            {showTrackedLimitPrompt ? (
              <p className="opportunity-inline-upgrade-note">{labels.trackingLimitNote}</p>
            ) : null}
          </article>
        ) : null}
        {clustersLoading ? <p className="muted">{labels.clustersLoading}</p> : null}
        {errorMessages.map((message) => (
          <p key={message} className="error">{message}</p>
        ))}
        {!clustersLoading && !clustersError && visibleClusters.length === 0 ? (
          <p className="muted">{labels.noClusters}</p>
        ) : null}
        <div className="opportunity-cluster-list">
          {visibleClusters.map((cluster) => {
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
      ) : null}

      <section className="opportunity-section opportunity-feed-results-section">
        <div className="panel-head">
          <h3>{labels.todayTitle}</h3>
        </div>
        <p className="muted">{labels.todaySub}</p>
        {loading ? <p className="muted">{labels.opportunitiesLoading}</p> : null}
        {!loading && visibleItems.length === 0 ? (
          <article className="opportunity-empty-state" data-testid="opportunity-empty-state">
            <p className="muted">{labels.noItems}</p>
            <div className="item-actions">
              <button type="button" onClick={onDiscover}>
                {labels.discoverCta}
              </button>
              {onRefresh ? (
                <button type="button" className="ghost" onClick={onRefresh}>
                  {labels.refreshCta}
                </button>
              ) : null}
            </div>
          </article>
        ) : null}

        <div className="opportunity-feed-list">
          {visibleItems.map((item) => {
            const stopsLabel = item.stops === 0 ? labels.direct : `${item.stops} ${labels.stopsSuffix}`;
            return (
              <article key={item.id} className="opportunity-card">
                <div className="opportunity-card-main">
                  <div className="opportunity-card-top">
                    <strong className="opportunity-card-route">{formatRouteDisplayName(item, language)}</strong>
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
              t={t}
              onUpgradePro={onUpgradePro}
              onUpgradeElite={onUpgradeElite}
            />
          ) : null}
          {!isAuthenticated && !loading && !error && items.length > 5 ? (
            <SoftLoginGate
              title={labels.softGateTitle}
              description={labels.softGateDesc}
              ctaLabel={labels.softGateCta}
              eyebrowLabel={labels.softGateEyebrow}
              noteLabel={labels.softGateNote}
              onCreateAccount={onCreateAccount}
            />
          ) : null}
        </div>
      </section>
    </section>
  );
}

export default OpportunityFeedSection;

