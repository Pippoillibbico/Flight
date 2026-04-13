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
    showUpgradePrompt: z.boolean().optional().default(false),
    upgradeMessage: z.string().optional().default('Sblocca tutte le opportunita con PRO'),
    onUpgradePro: z.function(),
    onUpgradeElite: z.function()
  })
  .passthrough();

function formatPrice(value, currency = 'EUR') {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '-';
  return String(currency).toUpperCase() === 'EUR' ? `${Math.round(amount)} \u20AC` : `${Math.round(amount)} ${currency}`;
}

function formatPeriod(item) {
  const formatter = new Intl.DateTimeFormat('it-IT', { month: 'short' });
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
  if (item?.depart_date) return `Partenza ${item.depart_date}`;
  return 'Date flessibili';
}

function levelBadge(level) {
  if (level === 'Rare opportunity') return '\u26A1 Opportunita rara';
  if (level === 'Exceptional price') return '\uD83D\uDD25 Prezzo eccezionale';
  if (level === 'Good deal' || level === 'Great deal') return '\uD83D\uDCB0 Ottimo affare';
  return '\uD83C\uDF0D Occasione interessante';
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
    showUpgradePrompt,
    upgradeMessage,
    onUpgradePro,
    onUpgradeElite
  } = validateProps(
    OpportunityFeedSectionPropsSchema,
    props,
    'OpportunityFeedSection'
  );
  const visibleItems = isAuthenticated ? items : items.slice(0, 5);

  return (
    <section className="panel opportunity-feed-panel">
      <div className="opportunity-hero">
        <p className="eyebrow">Radar opportunita live</p>
        <h2>Scopri voli incredibilmente economici prima degli altri.</h2>
        <p className="hero-sub">
          Il nostro radar analizza milioni di rotte e combinazioni tra compagnie aeree per individuare opportunita di viaggio che i normali motori di ricerca spesso non mettono in evidenza.
        </p>
        <div className="item-actions">
          <button type="button" onClick={onDiscover}>
            Scopri opportunita
          </button>
          <button type="button" className="ghost" onClick={onActivateRadar}>
            Attiva il radar
          </button>
          {onRefresh ? (
            <button type="button" className="ghost" onClick={onRefresh} disabled={loading}>
              Aggiorna feed
            </button>
          ) : null}
        </div>
      </div>

      <div className="panel-head">
        <h3>Le opportunita di oggi</h3>
      </div>
      <p className="muted">Voli particolarmente interessanti trovati dal nostro radar.</p>
      <div className="panel-head">
        <h3>Scopri per cluster</h3>
        {selectedCluster ? (
          <button type="button" className="ghost" onClick={onClearCluster}>
            Mostra tutto
          </button>
        ) : null}
      </div>
      {clustersLoading ? <p className="muted">Caricamento cluster...</p> : null}
      {clustersError ? <p className="error">{clustersError}</p> : null}
      {!clustersLoading && !clustersError && clusters.length === 0 ? (
        <p className="muted">Nessun cluster disponibile al momento.</p>
      ) : null}
      <div className="opportunity-cluster-list">
        {clusters.map((cluster) => {
          const isActive = selectedCluster === cluster.slug;
          return (
            <article key={cluster.slug} className={`opportunity-cluster-card${isActive ? ' active' : ''}`}>
              <button type="button" className="ghost opportunity-cluster-trigger" onClick={() => onSelectCluster(cluster.slug)}>
                <strong>{cluster.cluster_name}</strong>
                <p>
                  {cluster.min_price ? `da ${Math.round(cluster.min_price)} EUR` : 'Prezzo variabile'} | {Number(cluster.opportunities_count || 0)} opportunita
                </p>
              </button>
              <button type="button" className="ghost" onClick={() => onFollowCluster(cluster)}>
                Segui cluster
              </button>
            </article>
          );
        })}
      </div>
      {loading ? <p className="muted">Caricamento opportunita in corso...</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {!loading && items.length === 0 ? (
        <p className="muted">
          Al momento non ci sono nuove opportunita per i tuoi filtri. Stiamo continuando ad analizzare nuove rotte.
        </p>
      ) : null}

      <div className="opportunity-feed-list">
        {visibleItems.map((item) => (
          <article key={item.id} className="opportunity-card">
            <div>
              <div className="opportunity-card-top">
                <strong>
                  {item.origin_city} {'->'} {item.destination_city}
                </strong>
                <span className="opportunity-badge">{item.short_badge_text || levelBadge(item.opportunity_level)}</span>
              </div>
              <p>
                {formatPrice(item.price, item.currency)} | {formatPeriod(item)} | {item.stops === 0 ? 'Diretto' : `${item.stops} scali`}
              </p>
              {item.ai_description ? <p>{item.ai_description}</p> : null}
            </div>
            <div className="item-actions">
              <button type="button" onClick={() => onView(item.id)}>
                Vedi itinerario
              </button>
              <button type="button" className="ghost" onClick={() => onAlert(item.id)}>
                Attiva alert
              </button>
              <button type="button" className="ghost" onClick={() => onFollow(item.id)}>
                Segui destinazione
              </button>
            </div>
          </article>
        ))}
        {isAuthenticated && showUpgradePrompt ? (
          <UpgradePrompt
            message={upgradeMessage}
            onUpgradePro={onUpgradePro}
            onUpgradeElite={onUpgradeElite}
          />
        ) : null}
        {!isAuthenticated && !loading && !error && items.length > 5 ? <SoftLoginGate onCreateAccount={onCreateAccount} /> : null}
      </div>
    </section>
  );
}

export default OpportunityFeedSection;
