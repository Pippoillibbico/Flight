import DiscoveryFeedWidget from '../../../components/DiscoveryFeedWidget';
import OpportunityDetailSection from '../../../components/OpportunityDetailSection';
import OpportunityFeedSection from '../../../components/OpportunityFeedSection';
import PersonalHubSection from '../../../components/PersonalHubSection';
import UpgradeInlineBanner from '../../../components/UpgradeInlineBanner';

export default function HomeMainSection({
  isAuthenticated,
  destinationClusters,
  language,
  userPlanType,
  quota,
  planEntitlements,
  radarSessionActivated,
  viewDealsForTrackedRoute,
  handleUntrackedRouteFromHub,
  handleClearLocalTravelData,
  openSavedHubItinerary,
  activateRadarFromHubWithTelemetry,
  upgradeToPremium,
  chooseElitePlan,
  searchForm,
  opportunityFeed,
  destinationClustersLoading,
  destinationClustersError,
  selectedOpportunityCluster,
  opportunityFeedLoading,
  opportunityFeedError,
  refreshOpportunityFeedNow,
  setSelectedOpportunityCluster,
  followDestinationClusterFromFeed,
  openOpportunityDetail,
  followOpportunity,
  setActiveMainSection,
  activateRadarFromFeedWithTelemetry,
  beginAuthFlow,
  t,
  opportunityFeedAccess,
  handleTrackedRoutesLimitReached,
  systemCapabilities,
  opportunityDetailLoading,
  opportunityDetailError,
  opportunityDetail,
  opportunityBookingError,
  setOpportunityDetail,
  clearOpportunityBookingError,
  setOpportunityDetailUpgradePrompt,
  openOpportunityBooking,
  opportunityDetailUpgradePrompt,
  limitedResultsBanner
}) {
  return (
    <>
      {isAuthenticated ? (
        <PersonalHubSection
          clusters={destinationClusters}
          language={language}
          planType={userPlanType}
          quota={quota}
          trackedRoutesLimit={planEntitlements.trackedRoutesLimit}
          savedItinerariesLimit={planEntitlements.savedItinerariesLimit}
          radarMessagingTier={planEntitlements.radarMessagingTier}
          radarSessionActivated={radarSessionActivated}
          onViewDeals={viewDealsForTrackedRoute}
          onUntrackRoute={handleUntrackedRouteFromHub}
          onClearLocalData={handleClearLocalTravelData}
          onOpenItinerary={openSavedHubItinerary}
          onActivateRadar={activateRadarFromHubWithTelemetry}
          onUpgradePro={() => upgradeToPremium('personal_hub_prompt')}
          onUpgradeElite={() => chooseElitePlan('personal_hub_prompt')}
        />
      ) : null}

      <DiscoveryFeedWidget origin={searchForm.origin || undefined} limit={12} language={language} />

      {limitedResultsBanner?.show ? (
        <UpgradeInlineBanner
          title={limitedResultsBanner.title}
          message={limitedResultsBanner.message}
          ctaLabel={limitedResultsBanner.ctaLabel}
          onCta={limitedResultsBanner.onCta}
          onDismiss={limitedResultsBanner.onDismiss}
        />
      ) : null}

      <OpportunityFeedSection
        items={opportunityFeed}
        clusters={destinationClusters}
        clustersLoading={destinationClustersLoading}
        clustersError={destinationClustersError}
        selectedCluster={selectedOpportunityCluster}
        loading={opportunityFeedLoading}
        error={opportunityFeedError}
        onRefresh={refreshOpportunityFeedNow}
        onSelectCluster={setSelectedOpportunityCluster}
        onClearCluster={() => setSelectedOpportunityCluster('')}
        onFollowCluster={followDestinationClusterFromFeed}
        onView={openOpportunityDetail}
        onFollow={followOpportunity}
        onAlert={followOpportunity}
        onDiscover={() => setActiveMainSection('explore')}
        onActivateRadar={activateRadarFromFeedWithTelemetry}
        isAuthenticated={isAuthenticated}
        radarSessionActivated={radarSessionActivated}
        onCreateAccount={() =>
          beginAuthFlow({
            action: 'enter_app',
            authMode: 'register',
            authView: 'options',
            keepLandingVisible: false,
            targetSection: 'explore'
          })
        }
        t={t}
        language={language}
        planType={userPlanType}
        trackedRoutesLimit={planEntitlements.trackedRoutesLimit}
        showUpgradePrompt={Boolean(opportunityFeedAccess?.showUpgradePrompt) && userPlanType === 'free'}
        upgradeMessage={t(opportunityFeedAccess?.upgradeMessageKey || 'upgradePromptUnlockAll')}
        onTrackedRoutesLimitReached={handleTrackedRoutesLimitReached}
        onUpgradePro={() => upgradeToPremium('opportunity_feed_prompt')}
        onUpgradeElite={() => chooseElitePlan('opportunity_feed_prompt')}
        dataSource={systemCapabilities?.data_source || 'synthetic'}
      />

      {opportunityDetailLoading || opportunityDetailError || opportunityDetail ? (
        <OpportunityDetailSection
          loading={opportunityDetailLoading}
          error={opportunityDetailError}
          detail={opportunityDetail}
          language={language}
          t={t}
          bookingError={opportunityBookingError}
          onClose={() => {
            setOpportunityDetail(null);
            clearOpportunityBookingError();
            setOpportunityDetailUpgradePrompt(null);
          }}
          onFollow={followOpportunity}
          onActivateAlert={followOpportunity}
          onOpenBooking={openOpportunityBooking}
          onViewRelated={openOpportunityDetail}
          upgradePrompt={opportunityDetailUpgradePrompt}
          onUpgradePro={() => upgradeToPremium('opportunity_detail_prompt')}
          onUpgradeElite={() => chooseElitePlan('opportunity_detail_prompt')}
        />
      ) : null}
    </>
  );
}

