import { extractUpgradeContext } from '../../../../utils/handleApiError.js';

export function createRadarPreferenceOperations({
  api,
  token,
  isAuthenticated,
  canUseRadarPlan,
  radarDraft,
  userPlanType,
  t,
  parseCsvText,
  slugifyFollowValue,
  monthsToSeasonSlugs,
  resolveApiError,
  openPlanUpgradeFlowRef,
  sendAdminTelemetryEvent,
  activateRadarSessionFlag,
  loadRadarMatches,
  loadRadarFollows,
  loadOpportunityPipelineStatus,
  setRadarError,
  setRadarSaving,
  setRadarMessage,
  setRadarFollowsError,
  setActiveMainSection
}) {
  async function saveRadarPreferences() {
    if (!isAuthenticated) return;
    if (!canUseRadarPlan) {
      setRadarError(t('radarUpgradeTitle'));
      setActiveMainSection('premium');
      return;
    }

    setRadarSaving(true);
    setRadarError('');
    setRadarMessage('');
    try {
      const body = {
        originAirports: parseCsvText(radarDraft.originAirports, (entry) => entry.toUpperCase()),
        favoriteDestinations: parseCsvText(radarDraft.favoriteDestinations),
        favoriteCountries: parseCsvText(radarDraft.favoriteCountries),
        budgetCeiling: radarDraft.budgetCeiling ? Number(radarDraft.budgetCeiling) : null,
        preferredTravelMonths: parseCsvText(radarDraft.preferredTravelMonths, (entry) => Number(entry)).filter(
          (entry) => Number.isFinite(entry) && entry >= 1 && entry <= 12
        )
      };

      await api.updateRadarPreferences(token, body);

      const existingRadarFollowsPayload = await api.listFollows(token);
      const existingRadarFollows = Array.isArray(existingRadarFollowsPayload?.items)
        ? existingRadarFollowsPayload.items.filter((item) => String(item.follow_type || '').toLowerCase() === 'radar')
        : [];

      for (const item of existingRadarFollows) {
        await api.unfollowEntity(token, item.id);
      }

      const followItems = [];
      for (const airport of body.originAirports) {
        followItems.push({ entityType: 'airport', slug: slugifyFollowValue(airport), displayName: airport });
      }
      for (const city of body.favoriteDestinations) {
        followItems.push({ entityType: 'city', slug: slugifyFollowValue(city), displayName: city });
      }
      for (const country of body.favoriteCountries) {
        followItems.push({ entityType: 'country', slug: slugifyFollowValue(country), displayName: country });
      }
      if (Number.isFinite(Number(body.budgetCeiling)) && Number(body.budgetCeiling) > 0) {
        const value = Number(body.budgetCeiling);
        const bucket = value <= 250 ? 'under_250' : value <= 400 ? 'under_400' : value <= 600 ? 'under_600' : 'above_600';
        followItems.push({ entityType: 'budget_bucket', slug: bucket, displayName: bucket.replace(/_/g, ' ') });
      }
      for (const season of monthsToSeasonSlugs(body.preferredTravelMonths)) {
        followItems.push({ entityType: 'season', slug: season, displayName: season });
      }

      const dedupe = new Set();
      for (const item of followItems) {
        const key = `${item.entityType}:${item.slug}`;
        if (!item.slug || dedupe.has(key)) continue;
        dedupe.add(key);
        await api.followEntity(token, { ...item, followType: 'radar', metadata: { source: 'radar_preferences' } });
      }

      setRadarMessage(t('radarSavedSuccess'));
      activateRadarSessionFlag();
      sendAdminTelemetryEvent({
        eventType: 'radar_activated',
        source: 'radar_preferences_save',
        planType: userPlanType
      });

      await loadRadarMatches();
      await loadRadarFollows();
      await loadOpportunityPipelineStatus();
    } catch (error) {
      const upgradeContext = extractUpgradeContext(error);
      if (upgradeContext && openPlanUpgradeFlowRef?.current) {
        openPlanUpgradeFlowRef.current(upgradeContext.planType, upgradeContext.source);
      } else {
        setRadarError(resolveApiError(error));
      }
    } finally {
      setRadarSaving(false);
    }
  }

  async function removeRadarFollow(followId) {
    if (!isAuthenticated || !followId) return;
    setRadarFollowsError('');
    try {
      await api.unfollowEntity(token, followId);
      await loadRadarFollows();
      setRadarMessage(t('radarFollowUpdated'));
    } catch (error) {
      setRadarFollowsError(resolveApiError(error));
    }
  }

  return {
    saveRadarPreferences,
    removeRadarFollow
  };
}
