import { extractUpgradeContext } from '../../../../utils/handleApiError.js';

export function createFollowOperations({
  api,
  token,
  isAuthenticated,
  canUseRadarPlan,
  userPlanType,
  language,
  localizeClusterDisplayName,
  getUpgradeTriggerContent,
  beginSetAlertAuthFlow,
  trackResultInteraction,
  refreshSubscriptions,
  refreshNotifications,
  loadRadarFollows,
  setSubMessage,
  setActiveMainSection,
  openPlanUpgradeFlowRef,
  resolveApiError,
  t
}) {
  async function followOpportunity(opportunityId) {
    if (!isAuthenticated) {
      beginSetAlertAuthFlow({ keepLandingVisible: false });
      return setSubMessage(t('loginRequiredAlert'));
    }
    if (!canUseRadarPlan) {
      setSubMessage(t('upgradePromptUnlockAll'));
      setActiveMainSection('premium');
      return;
    }
    try {
      await api.followOpportunity(token, opportunityId);
      await refreshSubscriptions();
      await api.runNotificationScan(token);
      await refreshNotifications();
      setSubMessage(t('alertCreated'));
    } catch (error) {
      const upgradeCtx = extractUpgradeContext(error);
      if (upgradeCtx && openPlanUpgradeFlowRef?.current) {
        openPlanUpgradeFlowRef.current(upgradeCtx.planType, upgradeCtx.source);
      } else {
        setSubMessage(resolveApiError(error));
      }
    }
  }

  async function followDestinationCluster(cluster) {
    const slug = String(cluster?.slug || '').trim();
    const displayName = localizeClusterDisplayName(cluster, language) || String(cluster?.cluster_name || slug || '').trim();
    if (!slug) return;
    if (!isAuthenticated) {
      beginSetAlertAuthFlow({ keepLandingVisible: false });
      setSubMessage(t('loginRequiredAlert'));
      return;
    }
    if (!canUseRadarPlan) {
      setSubMessage(t('followDestinationProOnly'));
      setActiveMainSection('premium');
      return;
    }
    try {
      await api.followEntity(token, {
        entityType: 'destination_cluster',
        slug,
        displayName,
        followType: 'radar',
        metadata: { source: 'cluster_follow' }
      });
      await loadRadarFollows();
      setSubMessage(`${t('clusterFollowedPrefix')} ${displayName}`);
    } catch (error) {
      const upgradeCtx = extractUpgradeContext(error);
      if (upgradeCtx && openPlanUpgradeFlowRef?.current) {
        openPlanUpgradeFlowRef.current(upgradeCtx.planType, upgradeCtx.source);
      } else {
        setSubMessage(resolveApiError(error));
      }
    }
  }

  async function followDestinationClusterFromFeed(cluster) {
    if (!isAuthenticated) {
      beginSetAlertAuthFlow({ keepLandingVisible: false });
      setSubMessage(t('loginRequiredAlert'));
      return;
    }
    if (!canUseRadarPlan) {
      const content = getUpgradeTriggerContent(userPlanType, 'personal_hub');
      setSubMessage(content.message);
      return;
    }
    trackResultInteraction('track_route', 'opportunity_feed', String(cluster?.slug || '').trim().toLowerCase() || undefined);
    await followDestinationCluster(cluster);
  }

  return {
    followOpportunity,
    followDestinationCluster,
    followDestinationClusterFromFeed
  };
}
