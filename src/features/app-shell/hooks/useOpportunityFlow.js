import { useCallback, useRef } from 'react';

function toUpgradePrompt(content) {
  if (!content) return null;
  return {
    title: content.title,
    message: content.message,
    primaryLabel: content.proLabel,
    secondaryLabel: content.eliteLabel
  };
}

export function useOpportunityFlow({
  api,
  token,
  opportunityFeed,
  userPlanType,
  resolveApiError,
  saveRecentItineraryWithPlanGate,
  resolveUpgradeTriggerContent,
  trackResultInteraction,
  trackItineraryOpened,
  clearOpportunityBookingError,
  setOpportunityDetail,
  setOpportunityDetailLoading,
  setOpportunityDetailError,
  setOpportunityDetailUpgradePrompt,
  shouldShowUrgencyPrompt = null
}) {
  const opportunityDetailRequestIdRef = useRef(0);

  const openOpportunityDetail = useCallback(
    async (opportunityId) => {
      const normalizedOpportunityId = String(opportunityId || '').trim();
      if (!normalizedOpportunityId) return;

      const requestId = opportunityDetailRequestIdRef.current + 1;
      opportunityDetailRequestIdRef.current = requestId;

      trackResultInteraction('open_detail', 'opportunity_feed', normalizedOpportunityId);
      trackItineraryOpened('opportunity_feed', normalizedOpportunityId);
      setOpportunityDetailLoading(true);
      setOpportunityDetailError('');
      clearOpportunityBookingError();
      setOpportunityDetailUpgradePrompt(null);
      setOpportunityDetail(null);

      try {
        const payload = await api.opportunityDetail(token, normalizedOpportunityId);
        if (requestId !== opportunityDetailRequestIdRef.current) return;

        if (!payload || typeof payload !== 'object') {
          throw new Error('Opportunity detail payload missing.');
        }

        setOpportunityDetail(payload);

        if (payload?.item) {
          const saveOutcome = saveRecentItineraryWithPlanGate(payload.item);
          const feedItem = opportunityFeed.find((item) => String(item?.id || '') === normalizedOpportunityId);
          const radarState = String(
            payload?.item?.radarState || payload?.item?.radar_state || feedItem?.radarState || feedItem?.radar_state || ''
          )
            .trim()
            .toLowerCase();

          if (saveOutcome.limitReached) {
            const content = resolveUpgradeTriggerContent('saved_itineraries_limit', {
              used: saveOutcome.usage.used,
              limit: saveOutcome.usage.limit
            });
            setOpportunityDetailUpgradePrompt(toUpgradePrompt(content));
          } else if (radarState === 'radar_hot' && userPlanType !== 'elite') {
            const content = resolveUpgradeTriggerContent('radar_hot_opened');
            setOpportunityDetailUpgradePrompt(toUpgradePrompt(content));
          } else if (userPlanType === 'free' && typeof shouldShowUrgencyPrompt === 'function' && shouldShowUrgencyPrompt()) {
            const content = resolveUpgradeTriggerContent('deal_urgency');
            setOpportunityDetailUpgradePrompt(toUpgradePrompt(content));
          }
        }
      } catch (error) {
        if (requestId !== opportunityDetailRequestIdRef.current) return;
        setOpportunityDetail(null);
        setOpportunityDetailUpgradePrompt(null);
        setOpportunityDetailError(resolveApiError(error));
      } finally {
        if (requestId === opportunityDetailRequestIdRef.current) {
          setOpportunityDetailLoading(false);
        }
      }
    },
    [
      api,
      clearOpportunityBookingError,
      opportunityFeed,
      resolveApiError,
      resolveUpgradeTriggerContent,
      saveRecentItineraryWithPlanGate,
      setOpportunityDetail,
      setOpportunityDetailError,
      setOpportunityDetailLoading,
      setOpportunityDetailUpgradePrompt,
      token,
      trackItineraryOpened,
      trackResultInteraction,
      userPlanType,
      shouldShowUrgencyPrompt
    ]
  );

  const openSavedHubItinerary = useCallback(
    (itineraryId) => {
      const normalizedItineraryId = String(itineraryId || '').trim();
      if (!normalizedItineraryId) return;
      void openOpportunityDetail(normalizedItineraryId);
    },
    [openOpportunityDetail]
  );

  return {
    openOpportunityDetail,
    openSavedHubItinerary
  };
}
