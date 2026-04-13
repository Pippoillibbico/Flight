import { z } from 'zod';
import { validateProps } from '../utils/validateProps';
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
    onCreateAccount: z.function(),
    t: z.function().optional(),
    language: z.string().optional().default('it'),
    showUpgradePrompt: z.boolean().optional().default(false),
    upgradeMessage: z.string().optional().default('Unlock all opportunities with PRO'),
    onUpgradePro: z.function(),
    onUpgradeElite: z.function()
  })
  .passthrough();

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

function levelBadge(level, labels) {
  if (level === 'Rare opportunity') return labels.rareBadge;
  if (level === 'Exceptional price') return labels.exceptionalBadge;
  if (level === 'Good deal' || level === 'Great deal') return labels.greatBadge;
  return labels.interestingBadge;
}

function localizeOpportunityDescription(item, language, labels) {
  const raw = String(item?.ai_description || '').trim();
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
    onCreateAccount,
    t,
    language,
    showUpgradePrompt,
    upgradeMessage,
    onUpgradePro,
    onUpgradeElite
  } = validateProps(
    OpportunityFeedSectionPropsSchema,
    props,
    'OpportunityFeedSection'
  );
  const tt = (key, fallback) => (typeof t === 'function' ? t(key) : fallback) || fallback;
  const locale = String(language || 'it').toLowerCase().startsWith('en') ? 'en-US' : 'it-IT';
  const labels = {
    eyebrow: tt('opportunityFeedEyebrow', 'Radar opportunita live'),
    heroTitle: tt('opportunityFeedHeroTitle', 'Scopri voli incredibilmente economici prima degli altri.'),
    heroSub: tt(
      'opportunityFeedHeroSub',
      'Il nostro radar analizza milioni di rotte e combinazioni tra compagnie aeree per individuare opportunita di viaggio che i normali motori di ricerca spesso non mettono in evidenza.'
    ),
    discoverCta: tt('opportunityFeedDiscoverCta', 'Scopri opportunita'),
    activateRadarCta: tt('opportunityFeedActivateRadarCta', 'Attiva il radar'),
    refreshCta: tt('opportunityFeedRefreshCta', 'Aggiorna feed'),
    todayTitle: tt('opportunityFeedTodayTitle', 'Le opportunita di oggi'),
    todaySub: tt('opportunityFeedTodaySubtitle', 'Voli particolarmente interessanti trovati dal nostro radar.'),
    clusterTitle: tt('opportunityFeedClusterTitle', 'Scopri per cluster'),
    showAll: tt('opportunityFeedShowAll', 'Mostra tutto'),
    clustersLoading: tt('opportunityFeedClustersLoading', 'Caricamento cluster...'),
    noClusters: tt('opportunityFeedNoClusters', 'Nessun cluster disponibile al momento.'),
    from: tt('opportunityFeedFromLabel', 'da'),
    variablePrice: tt('opportunityFeedVariablePrice', 'Prezzo variabile'),
    opportunitiesWord: tt('opportunityFeedOpportunitiesWord', 'opportunita'),
    followClusterCta: tt('opportunityFeedFollowClusterCta', 'Segui cluster'),
    opportunitiesLoading: tt('opportunityFeedLoading', 'Caricamento opportunita in corso...'),
    noItems: tt('noResults', 'Al momento non ci sono nuove opportunita per i tuoi filtri. Stiamo continuando ad analizzare nuove rotte.'),
    direct: tt('opportunityFeedDirect', 'Diretto'),
    oneWay: tt('opportunityFeedOneWay', 'Solo andata'),
    roundTrip: tt('opportunityFeedRoundTrip', 'Andata e ritorno'),
    airlineLabel: tt('opportunityFeedAirline', 'Compagnia'),
    baggageIncluded: tt('opportunityFeedBaggageIncluded', 'Bagaglio incluso'),
    baggageExcluded: tt('opportunityFeedBaggageExcluded', 'Bagaglio non incluso'),
    baggageUnknown: tt('opportunityFeedBaggageUnknown', 'Bagaglio da verificare'),
    stopsSuffix: tt('opportunityFeedStopsSuffix', 'scali'),
    viewItineraryCta: tt('opportunityFeedViewItineraryCta', 'Vedi itinerario'),
    activateAlertCta: tt('opportunityFeedActivateAlertCta', 'Attiva alert'),
    followDestinationCta: tt('opportunityFeedFollowDestinationCta', 'Segui destinazione'),
    departurePrefix: tt('opportunityFeedDeparturePrefix', 'Partenza'),
    flexibleDates: tt('opportunityFeedFlexibleDates', 'Date flessibili'),
    rareBadge: tt('opportunityFeedBadgeRare', '\u26A1 Opportunita rara'),
    exceptionalBadge: tt('opportunityFeedBadgeExceptional', '\uD83D\uDD25 Prezzo eccezionale'),
    greatBadge: tt('opportunityFeedBadgeGreat', '\uD83D\uDCB0 Ottimo affare'),
    interestingBadge: tt('opportunityFeedBadgeInteresting', '\uD83C\uDF0D Occasione interessante'),
    softGateTitle: tt('opportunityFeedSoftGateTitle', 'Vuoi vedere tutte le opportunita?'),
    softGateDesc: tt(
      'opportunityFeedSoftGateDescription',
      'Crea un account gratuito per sbloccare il feed completo e attivare il tuo radar.'
    ),
    softGateCta: tt('opportunityFeedSoftGateCta', 'Crea account gratis'),
    upgradeTitle: tt('opportunityFeedUpgradeTitle', 'Vuoi vedere tutte le opportunita?'),
    upgradeMessage: upgradeMessage || tt('upgradePromptUnlockAll', 'Sblocca tutte le opportunita con PRO'),
    upgradePrimary: tt('opportunityFeedUpgradePrimaryCta', 'Upgrade a PRO'),
    upgradeSecondary: tt('opportunityFeedUpgradeSecondaryCta', 'Scopri ELITE')
  };
  const errorMessages = Array.from(new Set([clustersError, error].map((value) => String(value || '').trim()).filter(Boolean)));
  const visibleItems = isAuthenticated ? items : items.slice(0, 5);

  return (
    <section className="panel opportunity-feed-panel">
      <div className="opportunity-hero">
        <p className="eyebrow">{labels.eyebrow}</p>
        <h2>{labels.heroTitle}</h2>
        <p className="hero-sub">{labels.heroSub}</p>
        <div className="item-actions">
          <button type="button" className="opportunity-discover-cta" onClick={onDiscover}>
            {labels.discoverCta}
          </button>
          <button type="button" className="ghost opportunity-activate-radar-cta" onClick={onActivateRadar}>
            {labels.activateRadarCta}
          </button>
          {onRefresh ? (
            <button type="button" className="ghost" onClick={onRefresh} disabled={loading}>
              {labels.refreshCta}
            </button>
          ) : null}
        </div>
      </div>

      <div className="panel-head">
        <h3>{labels.todayTitle}</h3>
      </div>
      <p className="muted">{labels.todaySub}</p>
      <div className="panel-head">
        <h3>{labels.clusterTitle}</h3>
        {selectedCluster ? (
          <button type="button" className="ghost" onClick={onClearCluster}>
            {labels.showAll}
          </button>
        ) : null}
      </div>
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
          return (
            <article key={cluster.slug} className={`opportunity-cluster-card${isActive ? ' active' : ''}`}>
              <button type="button" className="ghost opportunity-cluster-trigger" onClick={() => onSelectCluster(cluster.slug)}>
                <strong>{cluster.cluster_name}</strong>
                <p>
                  {cluster.min_price ? `${labels.from} ${Math.round(cluster.min_price)} EUR` : labels.variablePrice} | {Number(cluster.opportunities_count || 0)} {labels.opportunitiesWord}
                </p>
              </button>
              <button type="button" className="ghost" onClick={() => onFollowCluster(cluster)}>
                {labels.followClusterCta}
              </button>
            </article>
          );
        })}
      </div>
      {loading ? <p className="muted">{labels.opportunitiesLoading}</p> : null}
      {!loading && items.length === 0 ? (
        <p className="muted">{labels.noItems}</p>
      ) : null}

      <div className="opportunity-feed-list">
        {visibleItems.map((item) => (
          <article key={item.id} className="opportunity-card">
            <div>
              <div className="opportunity-card-top">
                <strong>
                  {item.origin_city} {'->'} {item.destination_city}
                </strong>
                <span className="opportunity-badge">{item.short_badge_text || levelBadge(item.opportunity_level, labels)}</span>
              </div>
              <p>
                {formatPrice(item.price, item.currency)} | {formatTripType(item, labels)} | {formatPeriod(item, locale, labels)} |{' '}
                {item.stops === 0 ? labels.direct : `${item.stops} ${labels.stopsSuffix}`}
              </p>
              <p>
                {labels.airlineLabel}: {item.airline || 'unknown'} | {formatBaggage(item, labels)}
              </p>
              {item.ai_description ? <p>{localizeOpportunityDescription(item, language, labels)}</p> : null}
            </div>
            <div className="item-actions">
              <button type="button" onClick={() => onView(item.id)}>
                {labels.viewItineraryCta}
              </button>
              <button type="button" className="ghost" onClick={() => onAlert(item.id)}>
                {labels.activateAlertCta}
              </button>
              <button type="button" className="ghost" onClick={() => onFollow(item.id)}>
                {labels.followDestinationCta}
              </button>
            </div>
          </article>
        ))}
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
  );
}

export default OpportunityFeedSection;

