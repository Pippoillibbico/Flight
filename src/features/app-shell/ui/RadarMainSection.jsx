import RadarSection from '../../../components/RadarSection';
import SectionAccessGate from '../../../components/SectionAccessGate';
import LiveDealsRadarSection from '../../../components/LiveDealsRadarSection';

export default function RadarMainSection({
  isAuthenticated,
  t,
  language,
  token,
  canUseRadarPlan,
  upgradeToPremium,
  chooseElitePlan,
  requireSectionLogin,
  sendAdminTelemetryEvent,
  radarDraft,
  setRadarDraft,
  radarSaving,
  radarMessage,
  radarError,
  radarMatches,
  radarMatchesLoading,
  radarMatchesError,
  radarFollows,
  radarFollowsLoading,
  radarFollowsError,
  destinationClusters,
  destinationClustersLoading,
  destinationClustersError,
  opportunityPipelineStatus,
  opportunityPipelineStatusLoading,
  opportunityPipelineStatusError,
  loadRadarMatches,
  loadRadarFollows,
  loadOpportunityPipelineStatus,
  openOpportunityDebugView,
  exportOpportunityDebugSnapshot,
  removeRadarFollow,
  followDestinationCluster,
  saveRadarPreferences,
  radarSessionActivated,
  radarMessagingTier,
  preferredOrigin
}) {
  return (
    <>
      <LiveDealsRadarSection
        t={t}
        language={language}
        token={token}
        isAuthenticated={isAuthenticated}
        requireSectionLogin={requireSectionLogin}
        onUpgradePro={upgradeToPremium}
        onUpgradeElite={chooseElitePlan}
        canUseRadarPlan={canUseRadarPlan}
        preferredOrigin={preferredOrigin}
        sendAdminTelemetryEvent={sendAdminTelemetryEvent}
      />

      {isAuthenticated ? (
        <RadarSection
          t={t}
          language={language}
          draft={radarDraft}
          setDraft={setRadarDraft}
          saving={radarSaving}
          message={radarMessage}
          error={radarError}
          matches={radarMatches}
          matchesLoading={radarMatchesLoading}
          matchesError={radarMatchesError}
          follows={radarFollows}
          followsLoading={radarFollowsLoading}
          followsError={radarFollowsError}
          suggestedClusters={destinationClusters}
          clustersLoading={destinationClustersLoading}
          clustersError={destinationClustersError}
          pipelineStatus={opportunityPipelineStatus}
          pipelineStatusLoading={opportunityPipelineStatusLoading}
          pipelineStatusError={opportunityPipelineStatusError}
          onRefreshMatches={loadRadarMatches}
          onRefreshFollows={loadRadarFollows}
          onRefreshPipeline={loadOpportunityPipelineStatus}
          onOpenDebug={openOpportunityDebugView}
          onExportDebug={exportOpportunityDebugSnapshot}
          onRemoveFollow={removeRadarFollow}
          onFollowCluster={followDestinationCluster}
          onSave={saveRadarPreferences}
          sessionActivated={radarSessionActivated}
          radarMessagingTier={radarMessagingTier}
          canUseRadar={canUseRadarPlan}
          token={token}
          onUpgradePro={() => upgradeToPremium('radar_prompt')}
          onUpgradeElite={() => chooseElitePlan('radar_prompt')}
        />
      ) : (
        <SectionAccessGate
          title={t('radarPageTitle')}
          description={t('radarPageAccessDescription')}
          ctaLabel={t('opportunityFeedSoftGateCta')}
          onCta={() => requireSectionLogin('radar')}
        />
      )}
    </>
  );
}
