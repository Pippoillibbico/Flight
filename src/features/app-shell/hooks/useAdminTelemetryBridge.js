import { useCallback, useEffect } from 'react';
import { isConsentGiven } from '../../../utils/cookieConsent';

function withTelemetryEnvelope(payload) {
  const base = payload && typeof payload === 'object' ? payload : {};
  const normalizedEventId = String(base.eventId || '').trim().toLowerCase();
  const eventId = /^[a-z0-9_-]{8,80}$/.test(normalizedEventId)
    ? normalizedEventId
    : `adm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    ...base,
    eventId,
    eventVersion: Number.isInteger(Number(base.eventVersion)) && Number(base.eventVersion) > 0 ? Number(base.eventVersion) : 1,
    schemaVersion: Number.isInteger(Number(base.schemaVersion)) && Number(base.schemaVersion) > 0 ? Number(base.schemaVersion) : 2,
    sourceContext: String(base.sourceContext || '').trim().toLowerCase() === 'api_client' ? 'api_client' : 'web_app'
  };
}

export function getErrorTrackingData(error) {
  return {
    errorCode: String(error?.code || error?.status || 'unknown_error'),
    errorMessage: String(error?.message || 'Request failed')
  };
}

export function useAdminTelemetryBridge({
  isAuthenticated,
  searchMode,
  funnelEventService,
  adminDashboardApi,
  token,
  mapFunnelEventToAdminTelemetry,
  mapUpgradeEventToAdminTelemetry
}) {
  const sendAdminTelemetryEvent = useCallback(
    (payload) => {
      if (!isAuthenticated) return;
      if (!isConsentGiven('analytics')) return;
      adminDashboardApi.trackTelemetryEvent(token || undefined, withTelemetryEnvelope(payload)).catch(() => {});
    },
    [adminDashboardApi, isAuthenticated, token]
  );

  const trackSearchEvent = useCallback(
    (eventType, extra = {}) => {
      if (!isConsentGiven('analytics')) return;
      const effectiveSearchMode = extra.searchModeOverride || searchMode;
      funnelEventService.trackSearchLifecycle(eventType, {
        searchMode: effectiveSearchMode,
        resultCount: extra.resultCount,
        errorCode: extra.errorCode,
        errorMessage: extra.errorMessage,
        extra: extra.extra
      });
    },
    [funnelEventService, searchMode]
  );

  const trackResultInteraction = useCallback(
    (action, surface, itineraryId) => {
      if (!isConsentGiven('analytics')) return;
      funnelEventService.trackResultInteraction({
        searchMode,
        action,
        surface,
        itineraryId
      });
    },
    [funnelEventService, searchMode]
  );

  const trackItineraryOpened = useCallback(
    (surface, itineraryId) => {
      if (!isConsentGiven('analytics')) return;
      funnelEventService.trackItineraryOpened({
        searchMode,
        surface,
        itineraryId
      });
    },
    [funnelEventService, searchMode]
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleFunnelTelemetry = (event) => {
      const payload = mapFunnelEventToAdminTelemetry(event?.detail);
      if (!payload) return;
      const isTrackRoute = payload.eventType === 'result_interaction_clicked' && String(payload.action || '') === 'track_route';
      const shouldCollect =
        payload.eventType === 'itinerary_opened' ||
        payload.eventType === 'booking_clicked' ||
        isTrackRoute;
      if (!shouldCollect) return;
      sendAdminTelemetryEvent(payload);
    };
    const handleUpgradeTelemetry = (event) => {
      const payload = mapUpgradeEventToAdminTelemetry(event?.detail);
      if (!payload) return;
      sendAdminTelemetryEvent(payload);
    };
    window.addEventListener('flight_funnel_event', handleFunnelTelemetry);
    window.addEventListener('flight_upgrade_event', handleUpgradeTelemetry);
    return () => {
      window.removeEventListener('flight_funnel_event', handleFunnelTelemetry);
      window.removeEventListener('flight_upgrade_event', handleUpgradeTelemetry);
    };
  }, [mapFunnelEventToAdminTelemetry, mapUpgradeEventToAdminTelemetry, sendAdminTelemetryEvent]);

  return {
    sendAdminTelemetryEvent,
    trackSearchEvent,
    trackResultInteraction,
    trackItineraryOpened
  };
}
