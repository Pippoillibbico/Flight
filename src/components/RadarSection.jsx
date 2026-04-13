import { z } from 'zod';
import { validateProps } from '../utils/validateProps';
import { localizeCityName, localizeClusterDisplayName, localizeCountryName, localizeFollowEntityDisplayName } from '../utils/localizePlace';
import UpgradePrompt from './UpgradePrompt';
import { usePushSubscription } from '../hooks/usePushSubscription';

const RadarSectionPropsSchema = z
  .object({
    t: z.function().optional(),
    language: z.string().optional().default('it'),
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
    sessionActivated: z.boolean().optional().default(false),
    radarMessagingTier: z.enum(['basic', 'advanced', 'priority']).optional().default('basic'),
    canUseRadar: z.boolean().default(false),
    onUpgradePro: z.function(),
    onUpgradeElite: z.function(),
    token: z.string().nullable().optional().default(null)
  })
  .passthrough();

function RadarSection(props) {
  const {
    t,
    language,
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
    sessionActivated,
    radarMessagingTier,
    canUseRadar,
    onUpgradePro,
    onUpgradeElite,
    token
  } = validateProps(
    RadarSectionPropsSchema,
    props,
    'RadarSection'
  );
  const tt = (key, fallback) => (typeof t === 'function' ? t(key) : fallback) || fallback;
  const push = usePushSubscription(token);
  const debugDisabled = !canUseRadar;
  const radarTierMessage =
    radarMessagingTier === 'priority'
      ? tt('radarTierPriority', 'Priority radar active \u2014 top opportunities are surfaced first.')
      : radarMessagingTier === 'advanced'
        ? tt('radarTierAdvanced', 'Advanced radar active \u2014 richer signal depth and stronger route monitoring.')
        : tt('radarTierBasic', 'Basic radar is active on this plan.');

  return (
    <section className={`panel radar-panel${sessionActivated ? ' radar-session-active' : ''}`} data-testid="radar-panel">
      <div className="radar-hero">
        <div className="panel-head">
          <h2>{tt('radarPageTitle', 'Activate opportunity radar')}</h2>
        </div>
        <p className="muted">
          {tt('radarPageSubtitleLine1', 'Follow airports, cities, countries, budgets and seasons.')}
          <br />
          {tt('radarPageSubtitleLine2', 'When we find a truly strong opportunity, we notify you immediately.')}
        </p>
        <p className="radar-live-indicator" data-testid="radar-live-indicator">
          <span className="radar-live-dot" aria-hidden="true" />
          <span>{tt('radarRecentUpdateLabel', 'Recent update')}</span>
        </p>
        <p className="radar-tier-message" data-testid="radar-tier-message">{radarTierMessage}</p>
        {sessionActivated ? (
          <p className="radar-session-message" data-testid="radar-session-message">
            {tt('radarSessionActivatedMessage', 'Radar activated for this session')}
          </p>
        ) : null}
      </div>

      <section className={`radar-section-block radar-setup-block${sessionActivated ? ' radar-session-highlight' : ''}`}>
      <div className="search-grid">
        <label>
          {tt('radarFieldOriginsLabel', 'Preferred origin airports (IATA, comma-separated)')}
          <input value={draft.originAirports} onChange={(e) => setDraft((p) => ({ ...p, originAirports: e.target.value }))} placeholder={tt('radarFieldOriginsPlaceholder', 'FCO, MXP, BLQ')} />
        </label>
        <label>
          {tt('radarFieldDestinationsLabel', 'Favorite destinations')}
          <input
            value={draft.favoriteDestinations}
            onChange={(e) => setDraft((p) => ({ ...p, favoriteDestinations: e.target.value }))}
            placeholder={tt('radarFieldDestinationsPlaceholder', 'Tokyo, Lisbon, Bangkok')}
          />
        </label>
        <label>
          {tt('radarFieldCountriesLabel', 'Favorite countries')}
          <input value={draft.favoriteCountries} onChange={(e) => setDraft((p) => ({ ...p, favoriteCountries: e.target.value }))} placeholder={tt('radarFieldCountriesPlaceholder', 'Japan, Spain')} />
        </label>
        <label>
          {tt('radarFieldBudgetLabel', 'Max budget')}
          <input type="number" inputMode="numeric" min={0} value={draft.budgetCeiling} onChange={(e) => setDraft((p) => ({ ...p, budgetCeiling: e.target.value }))} placeholder="500" />
        </label>
        <label>
          {tt('radarFieldMonthsLabel', 'Preferred months (1-12, comma-separated)')}
          <input value={draft.preferredTravelMonths} onChange={(e) => setDraft((p) => ({ ...p, preferredTravelMonths: e.target.value }))} placeholder={tt('radarFieldMonthsPlaceholder', '4,5,10,11')} />
        </label>
      </div>
      <div className="item-actions radar-primary-actions">
        <button type="button" onClick={onSave} disabled={saving} data-testid="radar-save-preferences">
          {saving ? tt('radarSavingCta', 'Activating radar...') : tt('radarActivateCta', 'Activate radar')}
        </button>
        {push.supported ? (
          <button
            type="button"
            className={`push-toggle-btn${push.subscribed ? ' push-toggle-btn--active' : ''}`}
            onClick={push.subscribed ? push.unsubscribe : push.subscribe}
            disabled={push.loading}
            data-testid="radar-push-toggle"
          >
            {push.loading
              ? tt('pushToggleLoading', 'Please wait…')
              : push.subscribed
                ? tt('pushToggleDisable', 'Disable browser notifications')
                : tt('pushToggleEnable', 'Enable browser notifications')}
          </button>
        ) : null}
        {push.error ? <p className="form-error" data-testid="radar-push-error">{push.error}</p> : null}
      </div>
      </section>
      {!canUseRadar ? (
        <UpgradePrompt
          title={tt('radarUpgradeTitle', 'Full radar available on PRO')}
          message={tt('radarUpgradeMessage', 'FREE plan has limited radar. Unlock unlimited notifications and follows.')}
          primaryLabel={tt('opportunityFeedUpgradePrimaryCta', 'Upgrade to PRO')}
          secondaryLabel={tt('opportunityFeedUpgradeSecondaryCta', 'Discover ELITE')}
          onUpgradePro={onUpgradePro}
          onUpgradeElite={onUpgradeElite}
        />
      ) : null}
      {message ? <p className="muted">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      <section className="radar-section-block">
      <div className="panel-head">
        <h3>{tt('radarSuggestedClustersTitle', 'Suggested clusters to follow')}</h3>
      </div>
      {clustersLoading ? <p className="muted">{tt('opportunityFeedClustersLoading', 'Loading clusters...')}</p> : null}
      {clustersError ? <p className="error">{clustersError}</p> : null}
      {!clustersLoading && !clustersError && suggestedClusters.length === 0 ? <p className="muted">{tt('radarNoSuggestedClusters', 'No suggested clusters available.')}</p> : null}
      <div className="list-stack">
        {suggestedClusters.slice(0, 6).map((cluster) => (
          <article key={cluster.slug} className="watch-item radar-follow-item">
            <div className="radar-follow-content">
              <strong>{localizeClusterDisplayName(cluster, language)}</strong>
              <p className="radar-follow-meta">
                <span className="radar-pill">CLUSTER</span>
                <span>{cluster.min_price ? `${tt('opportunityFeedFromLabel', 'from')} ${Math.round(cluster.min_price)} EUR` : tt('opportunityFeedVariablePrice', 'Variable price')}</span>
                <span>{Number(cluster.opportunities_count || 0)} {tt('opportunityFeedOpportunitiesWord', 'opportunities')}</span>
              </p>
            </div>
            <button type="button" className="ghost" onClick={() => onFollowCluster(cluster)}>
              {tt('opportunityFeedFollowClusterCta', 'Track this route')}
            </button>
          </article>
        ))}
      </div>
      </section>

      <section className="radar-section-block">
      <div className="panel-head">
        <h3>{tt('radarFollowsTitle', 'Active follows (travel concepts)')}</h3>
        <button type="button" className="ghost" onClick={onRefreshFollows} disabled={followsLoading}>
          {followsLoading ? tt('radarRefreshing', 'Refreshing...') : tt('radarRefreshFollowsCta', 'Refresh follows')}
        </button>
      </div>
      {followsError ? <p className="error">{followsError}</p> : null}
      {!followsLoading && follows.length === 0 ? <p className="muted">{tt('radarNoFollows', 'No active follows. Save radar preferences to create follows on airports, cities, countries, budget and seasons.')}</p> : null}
      <div className="list-stack">
        {follows.map((follow) => (
          <article key={follow.id} className="watch-item radar-follow-item">
            <div className="radar-follow-content">
              <strong>{localizeFollowEntityDisplayName(follow.entity, language) || tt('radarEntityFallback', 'Entity')}</strong>
              <p className="radar-follow-meta">
                <span className="radar-pill">{String(follow.entity?.entity_type || 'entity').toUpperCase()}</span>
                <span>{tt('radarSlugLabel', 'slug')}: {follow.entity?.slug || '-'}</span>
              </p>
            </div>
            <button type="button" className="ghost" onClick={() => onRemoveFollow(follow.id)}>
              {tt('radarRemoveFollowCta', 'Remove follow')}
            </button>
          </article>
        ))}
      </div>
      </section>

      <section className="radar-section-block">
      <div className="panel-head">
        <h3>{tt('radarRecentMatchesTitle', 'Recent radar matches')}</h3>
        <button type="button" className="ghost" onClick={onRefreshMatches} disabled={matchesLoading}>
          {matchesLoading ? tt('radarRefreshing', 'Refreshing...') : tt('radarRefreshMatchesCta', 'Refresh matches')}
        </button>
      </div>
      {matchesError ? <p className="error">{matchesError}</p> : null}
      {!matchesLoading && matches.length === 0 ? <p className="muted">{tt('radarNoRecentMatches', 'No recent matches. Keep following the opportunity feed.')}</p> : null}
      <div className="list-stack">
        {matches.map((item) => (
          <article key={item.id} className="watch-item radar-match-item">
            <div>
              <strong>{tt('radarMatchLabel', 'Radar match')}: {Number(item.totalMatches || item.matchCount || 0)} {tt('opportunityFeedOpportunitiesWord', 'opportunities')}</strong>
              <p>{item.createdAt ? new Date(item.createdAt).toLocaleString() : tt('radarRecentUpdateLabel', 'Recent update')}</p>
              {Array.isArray(item.opportunityIds) && item.opportunityIds.length > 0 ? (
                <p>{tt('radarIdsLabel', 'IDs')}: {item.opportunityIds.slice(0, 4).join(', ')}{item.opportunityIds.length > 4 ? '...' : ''}</p>
              ) : null}
              {Array.isArray(item.matches) && item.matches.length > 0 ? (
                <div className="list-stack">
                  {item.matches.slice(0, 3).map((match) => (
                    <div key={`${item.id}_${match.opportunityId}`} className="watch-item">
                      <div>
                        <strong>
                          {match.originAirport} {'→'}{localizeCityName(match.destinationCity, language)} ({match.destinationAirport})
                        </strong>
                        <p>
                          {Math.round(Number(match.price || 0))} {match.currency} | {match.departDate} | {match.haulType}
                        </p>
                        <p>
                          {localizeCountryName(match.destinationCountry, language) || tt('radarCountryNA', 'Country n/a')} | {String(match.destinationRegion || tt('radarUnknownLabel', 'unknown')).toUpperCase()} | {tt('radarScoreLabel', 'Score')} {Math.round(Number(match.finalScore || 0))}
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
      </section>
      <details className="advanced-block radar-debug-block">
        <summary>{tt('radarDebugTitle', 'Pipeline diagnostics')}</summary>
        <p className="muted">{tt('radarDebugDescription', 'Technical panel for support and troubleshooting. Not required for normal usage.')}</p>
        {debugDisabled ? <p className="muted">{tt('radarDebugPlanHint', 'Diagnostics are available on PRO and ELITE plans.')}</p> : null}
        <div className="item-actions radar-debug-actions">
          <button
            type="button"
            className="ghost"
            onClick={onRefreshPipeline}
            disabled={pipelineStatusLoading || debugDisabled}
            title={tt('radarRefreshStatusTooltip', 'Refresh latest pipeline diagnostics and runtime metrics.')}
          >
            {pipelineStatusLoading ? tt('radarRefreshing', 'Refreshing...') : tt('radarRefreshStatusCta', 'Refresh diagnostics')}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={onOpenDebug}
            disabled={debugDisabled}
            title={tt('radarOpenDebugTooltip', 'Open a technical report in a new tab.')}
          >
            {tt('radarOpenDebugCta', 'Open technical report')}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={onExportDebug}
            disabled={debugDisabled}
            title={tt('radarExportJsonTooltip', 'Download the current diagnostics snapshot as JSON.')}
          >
            {tt('radarExportJsonCta', 'Download diagnostic JSON')}
          </button>
        </div>
        {pipelineStatusError ? <p className="error">{pipelineStatusError}</p> : null}
        {(pipelineStatus?.opportunityPipeline?.totals || pipelineStatus?.totals) ? (
          <article className="watch-item radar-debug-card">
            <div>
              <strong>{tt('radarIntelligenceStatusTitle', 'Intelligence status')}</strong>
              <div className="radar-debug-metrics">
                <span className="radar-metric">{tt('radarMetricPublished', 'Published')}: {Number((pipelineStatus.opportunityPipeline?.totals || pipelineStatus.totals).published || 0)}</span>
                <span className="radar-metric">{tt('radarMetricTotal', 'Total')}: {Number((pipelineStatus.opportunityPipeline?.totals || pipelineStatus.totals).total || 0)}</span>
                <span className="radar-metric">{tt('radarMetricNormalized', 'Normalized')}: {Number((pipelineStatus.opportunityPipeline?.totals || pipelineStatus.totals).normalizedFlights || 0)}</span>
                <span className="radar-metric">{tt('radarMetricTagged', 'Tagged')}: {Number((pipelineStatus.opportunityPipeline?.totals || pipelineStatus.totals).taggedOpportunities || 0)}</span>
                <span className="radar-metric">{tt('radarMetricPreparedMatches', 'Prepared matches')}: {Number((pipelineStatus.opportunityPipeline?.totals || pipelineStatus.totals).preparedMatches || 0)}</span>
              </div>
              {pipelineStatus?.radarPrecompute ? (
                <p className="radar-debug-line">
                  {tt('radar24hLabel', 'Radar 24h')}: {Number(pipelineStatus.radarPrecompute.snapshots24h || 0)} {tt('radarSnapshotsLabel', 'snapshots')} | {tt('radarFollowMatchLabel', 'Follow match')}:{' '}
                  {Number(pipelineStatus.radarPrecompute.followMatchCount || 0)} | {tt('radarExpandedMatchLabel', 'Expanded match')}:{' '}
                  {Number(pipelineStatus.radarPrecompute.expandedMatchCount || 0)}
                </p>
              ) : null}
              {pipelineStatus?.providers ? (
                <p className="radar-debug-line">
                  {tt('radarProvidersEnabledLabel', 'Providers enabled')}: {(pipelineStatus.providers.enabled || []).join(', ') || tt('none', 'none')} | {tt('radarConfiguredLabel', 'Configured')}:{' '}
                  {(pipelineStatus.providers.configured || []).join(', ') || tt('none', 'none')} | {tt('radarMissingCredsLabel', 'Missing creds')}:{' '}
                  {(pipelineStatus.providers.missing || []).join(', ') || tt('none', 'none')}
                </p>
              ) : null}
              {pipelineStatus?.alertDelivery ? (
                <p className="radar-debug-line">
                  {tt('radarAlertDeliveryLabel', 'Alert delivery')}: SMTP {pipelineStatus.alertDelivery.smtpConfigured ? tt('radarConfiguredStatus', 'configured') : tt('radarNotConfiguredStatus', 'not configured')} | Push{' '}
                  {pipelineStatus.alertDelivery.pushConfigured ? tt('radarConfiguredStatus', 'configured') : tt('radarNotConfiguredStatus', 'not configured')}
                </p>
              ) : null}
              {pipelineStatus?.opportunityPipeline?.apiQuality ? (
                <p className="radar-debug-line">
                  {tt('radarApiQualityLabel', 'API quality')}: {tt('radarApiFilteredOutLabel', 'filtered out')} {Number(pipelineStatus.opportunityPipeline.apiQuality.filteredOutSinceBoot || 0)}
                </p>
              ) : null}
              {pipelineStatus?.opportunityPipeline?.recentRuns?.[0]?.metadata?.graphSeed ? (
                <p className="radar-debug-line">
                  {tt('radarGraphSeedLabel', 'Graph seed (last run)')}: {tt('radarSameCountryLabel', 'same_country')} {Number(pipelineStatus.opportunityPipeline.recentRuns[0].metadata.graphSeed.seededSameCountry || 0)} | {tt('radarSameRegionLabel', 'same_region')}{' '}
                  {Number(pipelineStatus.opportunityPipeline.recentRuns[0].metadata.graphSeed.seededSameRegion || 0)} | {tt('radarBudgetClusterLabel', 'budget_cluster')}{' '}
                  {Number(pipelineStatus.opportunityPipeline.recentRuns[0].metadata.graphSeed.seededBudgetCluster || 0)} | {tt('radarSeasonClusterLabel', 'season_cluster')}{' '}
                  {Number(pipelineStatus.opportunityPipeline.recentRuns[0].metadata.graphSeed.seededSeasonCluster || 0)}
                </p>
              ) : null}
            </div>
          </article>
        ) : null}
      </details>
    </section>
  );
}

export default RadarSection;
