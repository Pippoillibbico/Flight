import { z } from 'zod';
import { validateProps } from '../utils/validateProps';
import UpgradePrompt from './UpgradePrompt';

const RadarSectionPropsSchema = z
  .object({
    draft: z
      .object({
        originAirports: z.string(),
        favoriteDestinations: z.string(),
        favoriteCountries: z.string(),
        budgetCeiling: z.string(),
        preferredTravelMonths: z.string()
      })
      .passthrough(),
    setDraft: z.function(),
    saving: z.boolean(),
    message: z.string(),
    error: z.string(),
    matches: z.array(z.any()),
    matchesLoading: z.boolean(),
    matchesError: z.string(),
    follows: z.array(z.any()),
    followsLoading: z.boolean(),
    followsError: z.string(),
    suggestedClusters: z.array(z.any()),
    clustersLoading: z.boolean(),
    clustersError: z.string(),
    pipelineStatus: z.any().nullable(),
    pipelineStatusLoading: z.boolean(),
    pipelineStatusError: z.string(),
    onRefreshMatches: z.function(),
    onRefreshFollows: z.function(),
    onRefreshPipeline: z.function(),
    onOpenDebug: z.function(),
    onExportDebug: z.function(),
    onRemoveFollow: z.function(),
    onFollowCluster: z.function(),
    onSave: z.function(),
    canUseRadar: z.boolean().default(false),
    onUpgradePro: z.function(),
    onUpgradeElite: z.function()
  })
  .passthrough();

function RadarSection(props) {
  const {
    draft,
    setDraft,
    saving,
    message,
    error,
    matches,
    matchesLoading,
    matchesError,
    follows,
    followsLoading,
    followsError,
    suggestedClusters,
    clustersLoading,
    clustersError,
    pipelineStatus,
    pipelineStatusLoading,
    pipelineStatusError,
    onRefreshMatches,
    onRefreshFollows,
    onRefreshPipeline,
    onOpenDebug,
    onExportDebug,
    onRemoveFollow,
    onFollowCluster,
    onSave,
    canUseRadar,
    onUpgradePro,
    onUpgradeElite
  } = validateProps(
    RadarSectionPropsSchema,
    props,
    'RadarSection'
  );

  return (
    <section className="panel radar-panel">
      <div className="panel-head">
        <h2>Attiva il radar delle opportunita</h2>
      </div>
      <p className="muted">
        Segui aeroporti, citta, paesi, budget e stagioni.
        <br />
        Quando troviamo un'opportunita davvero interessante ti avviseremo subito.
      </p>
      <div className="search-grid">
        <label>
          Aeroporti di partenza preferiti (IATA, separati da virgola)
          <input value={draft.originAirports} onChange={(e) => setDraft((p) => ({ ...p, originAirports: e.target.value }))} placeholder="FCO, MXP, BLQ" />
        </label>
        <label>
          Destinazioni preferite
          <input
            value={draft.favoriteDestinations}
            onChange={(e) => setDraft((p) => ({ ...p, favoriteDestinations: e.target.value }))}
            placeholder="Tokyo, Lisbona, Bangkok"
          />
        </label>
        <label>
          Paesi preferiti
          <input value={draft.favoriteCountries} onChange={(e) => setDraft((p) => ({ ...p, favoriteCountries: e.target.value }))} placeholder="Giappone, Spagna" />
        </label>
        <label>
          Budget massimo
          <input type="number" min={0} value={draft.budgetCeiling} onChange={(e) => setDraft((p) => ({ ...p, budgetCeiling: e.target.value }))} placeholder="500" />
        </label>
        <label>
          Mesi preferiti (1-12, separati da virgola)
          <input value={draft.preferredTravelMonths} onChange={(e) => setDraft((p) => ({ ...p, preferredTravelMonths: e.target.value }))} placeholder="4,5,10,11" />
        </label>
      </div>
      <div className="item-actions">
        <button type="button" onClick={onSave} disabled={saving}>
          {saving ? 'Attivazione radar...' : 'Attiva radar'}
        </button>
      </div>
      {!canUseRadar ? (
        <UpgradePrompt
          title="Radar completo disponibile su PRO"
          message="Il piano FREE ha radar limitato. Sblocca notifiche e follow illimitati."
          onUpgradePro={onUpgradePro}
          onUpgradeElite={onUpgradeElite}
        />
      ) : null}
      {message ? <p className="muted">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      <div className="panel-head">
        <h3>Cluster suggeriti da seguire</h3>
      </div>
      {clustersLoading ? <p className="muted">Caricamento cluster...</p> : null}
      {clustersError ? <p className="error">{clustersError}</p> : null}
      {!clustersLoading && !clustersError && suggestedClusters.length === 0 ? <p className="muted">Nessun cluster suggerito disponibile.</p> : null}
      <div className="list-stack">
        {suggestedClusters.slice(0, 6).map((cluster) => (
          <article key={cluster.slug} className="watch-item radar-follow-item">
            <div className="radar-follow-content">
              <strong>{cluster.cluster_name}</strong>
              <p className="radar-follow-meta">
                <span className="radar-pill">CLUSTER</span>
                <span>{cluster.min_price ? `da ${Math.round(cluster.min_price)} EUR` : 'Prezzo variabile'}</span>
                <span>{Number(cluster.opportunities_count || 0)} opportunita</span>
              </p>
            </div>
            <button type="button" className="ghost" onClick={() => onFollowCluster(cluster)}>
              Segui cluster
            </button>
          </article>
        ))}
      </div>
      <div className="panel-head">
        <h3>Follow attivi (concetti di viaggio)</h3>
        <button type="button" className="ghost" onClick={onRefreshFollows} disabled={followsLoading}>
          {followsLoading ? 'Aggiornamento...' : 'Aggiorna follow'}
        </button>
      </div>
      {followsError ? <p className="error">{followsError}</p> : null}
      {!followsLoading && follows.length === 0 ? <p className="muted">Nessun follow attivo. Salva il radar per creare follow su aeroporti, citta, paesi, budget e stagioni.</p> : null}
      <div className="list-stack">
        {follows.map((follow) => (
          <article key={follow.id} className="watch-item radar-follow-item">
            <div className="radar-follow-content">
              <strong>{follow.entity?.display_name || follow.entity?.slug || 'Entity'}</strong>
              <p className="radar-follow-meta">
                <span className="radar-pill">{String(follow.entity?.entity_type || 'entity').toUpperCase()}</span>
                <span>slug: {follow.entity?.slug || '-'}</span>
              </p>
            </div>
            <button type="button" className="ghost" onClick={() => onRemoveFollow(follow.id)}>
              Rimuovi follow
            </button>
          </article>
        ))}
      </div>
      <div className="panel-head">
        <h3>Match radar recenti</h3>
        <button type="button" className="ghost" onClick={onRefreshMatches} disabled={matchesLoading}>
          {matchesLoading ? 'Aggiornamento...' : 'Aggiorna match'}
        </button>
      </div>
      {matchesError ? <p className="error">{matchesError}</p> : null}
      {!matchesLoading && matches.length === 0 ? <p className="muted">Nessun match recente. Continua a seguire il feed opportunita.</p> : null}
      <div className="list-stack">
        {matches.map((item) => (
          <article key={item.id} className="watch-item radar-match-item">
            <div>
              <strong>Radar match: {Number(item.totalMatches || item.matchCount || 0)} opportunita</strong>
              <p>{item.createdAt ? new Date(item.createdAt).toLocaleString() : 'Aggiornamento recente'}</p>
              {Array.isArray(item.opportunityIds) && item.opportunityIds.length > 0 ? (
                <p>ID: {item.opportunityIds.slice(0, 4).join(', ')}{item.opportunityIds.length > 4 ? '...' : ''}</p>
              ) : null}
              {Array.isArray(item.matches) && item.matches.length > 0 ? (
                <div className="list-stack">
                  {item.matches.slice(0, 3).map((match) => (
                    <div key={`${item.id}_${match.opportunityId}`} className="watch-item">
                      <div>
                        <strong>
                          {match.originAirport} {'->'} {match.destinationCity} ({match.destinationAirport})
                        </strong>
                        <p>
                          {Math.round(Number(match.price || 0))} {match.currency} | {match.departDate} | {match.haulType}
                        </p>
                        <p>
                          {match.destinationCountry || 'Country n/a'} | {String(match.destinationRegion || 'unknown').toUpperCase()} | Score {Math.round(Number(match.finalScore || 0))}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </article>
        ))}
      </div>
      <div className="panel-head">
        <h3>Debug pipeline opportunita</h3>
        <div className="item-actions">
          <button type="button" className="ghost" onClick={onRefreshPipeline} disabled={pipelineStatusLoading}>
            {pipelineStatusLoading ? 'Aggiornamento...' : 'Aggiorna stato'}
          </button>
          <button type="button" className="ghost" onClick={onOpenDebug}>
            Apri debug esteso
          </button>
          <button type="button" className="ghost" onClick={onExportDebug}>
            Esporta JSON
          </button>
        </div>
      </div>
      {pipelineStatusError ? <p className="error">{pipelineStatusError}</p> : null}
      {(pipelineStatus?.opportunityPipeline?.totals || pipelineStatus?.totals) ? (
        <article className="watch-item radar-debug-card">
          <div>
            <strong>Stato intelligence</strong>
            <div className="radar-debug-metrics">
              <span className="radar-metric">Pubblicate: {Number((pipelineStatus.opportunityPipeline?.totals || pipelineStatus.totals).published || 0)}</span>
              <span className="radar-metric">Totali: {Number((pipelineStatus.opportunityPipeline?.totals || pipelineStatus.totals).total || 0)}</span>
              <span className="radar-metric">Normalizzate: {Number((pipelineStatus.opportunityPipeline?.totals || pipelineStatus.totals).normalizedFlights || 0)}</span>
              <span className="radar-metric">Taggate: {Number((pipelineStatus.opportunityPipeline?.totals || pipelineStatus.totals).taggedOpportunities || 0)}</span>
              <span className="radar-metric">Match preparati: {Number((pipelineStatus.opportunityPipeline?.totals || pipelineStatus.totals).preparedMatches || 0)}</span>
            </div>
            {pipelineStatus?.radarPrecompute ? (
              <p className="radar-debug-line">
                Radar 24h: {Number(pipelineStatus.radarPrecompute.snapshots24h || 0)} snapshot | Follow match:{' '}
                {Number(pipelineStatus.radarPrecompute.followMatchCount || 0)} | Expanded match:{' '}
                {Number(pipelineStatus.radarPrecompute.expandedMatchCount || 0)}
              </p>
            ) : null}
            {pipelineStatus?.providers ? (
              <p className="radar-debug-line">
                Provider enabled: {(pipelineStatus.providers.enabled || []).join(', ') || 'none'} | Configured:{' '}
                {(pipelineStatus.providers.configured || []).join(', ') || 'none'} | Missing creds:{' '}
                {(pipelineStatus.providers.missing || []).join(', ') || 'none'}
              </p>
            ) : null}
            {pipelineStatus?.alertDelivery ? (
              <p className="radar-debug-line">
                Alert delivery: SMTP {pipelineStatus.alertDelivery.smtpConfigured ? 'configured' : 'not configured'} | Push{' '}
                {pipelineStatus.alertDelivery.pushConfigured ? 'configured' : 'not configured'}
              </p>
            ) : null}
            {pipelineStatus?.opportunityPipeline?.recentRuns?.[0]?.metadata?.graphSeed ? (
              <p className="radar-debug-line">
                Graph seed (ultimo run): same_country {Number(pipelineStatus.opportunityPipeline.recentRuns[0].metadata.graphSeed.seededSameCountry || 0)} | same_region{' '}
                {Number(pipelineStatus.opportunityPipeline.recentRuns[0].metadata.graphSeed.seededSameRegion || 0)} | budget_cluster{' '}
                {Number(pipelineStatus.opportunityPipeline.recentRuns[0].metadata.graphSeed.seededBudgetCluster || 0)} | season_cluster{' '}
                {Number(pipelineStatus.opportunityPipeline.recentRuns[0].metadata.graphSeed.seededSeasonCluster || 0)}
              </p>
            ) : null}
          </div>
        </article>
      ) : null}
    </section>
  );
}

export default RadarSection;
