import { useCallback, useState } from 'react';

function getErrorTrackingData(error) {
  return {
    errorCode: String(error?.code || error?.status || 'unknown_error'),
    errorMessage: String(error?.message || 'Request failed')
  };
}

function toUpgradePrompt(content) {
  if (!content) return null;
  return {
    title: content.title,
    message: content.message,
    primaryLabel: content.proLabel,
    secondaryLabel: content.eliteLabel
  };
}

export function useBookingFlow({
  bookingHandoffLayer,
  bookingClickTracker,
  funnelEventService,
  searchForm,
  searchMode,
  t,
  utmParams,
  resolveUpgradeTriggerContent,
  saveRecentItineraryWithPlanGate,
  setOpportunityDetailUpgradePrompt,
  trackResultInteraction
}) {
  const [bookingHandoffError, setBookingHandoffError] = useState('');
  const [opportunityBookingError, setOpportunityBookingError] = useState('');

  const clearBookingHandoffError = useCallback(() => {
    setBookingHandoffError('');
  }, []);

  const clearOpportunityBookingError = useCallback(() => {
    setOpportunityBookingError('');
  }, []);

  const trackBookingClickedEvent = useCallback(
    (handoff) => {
      funnelEventService.trackBookingClicked({
        searchMode,
        surface: handoff?.event?.surface,
        correlationId: handoff?.event?.correlationId,
        itineraryId: handoff?.event?.itineraryId,
        extra: {
          partner: handoff?.event?.partner,
          providerType: handoff?.event?.providerType
        }
      });
    },
    [funnelEventService, searchMode]
  );

  const trackOutboundRedirectSuccess = useCallback(
    (handoff, extra = {}) => {
      funnelEventService.trackOutboundRedirectSucceeded({
        searchMode,
        surface: handoff?.event?.surface,
        correlationId: handoff?.event?.correlationId,
        itineraryId: handoff?.event?.itineraryId,
        extra: {
          partner: handoff?.event?.partner,
          providerType: handoff?.event?.providerType,
          ...extra
        }
      });
    },
    [funnelEventService, searchMode]
  );

  const trackOutboundRedirectFailure = useCallback(
    ({ surface, correlationId, itineraryId, error, extra = {} }) => {
      funnelEventService.trackOutboundRedirectFailed({
        searchMode,
        surface,
        correlationId,
        itineraryId,
        errorCode: String(error?.code || error?.status || 'outbound_redirect_failed'),
        errorMessage: String(error?.message || 'Outbound redirect failed'),
        extra
      });
    },
    [funnelEventService, searchMode]
  );

  const toBookingItinerary = useCallback(
    (flight) => ({
      itineraryId: String(flight?.id || '').trim() || undefined,
      origin: String(flight?.origin || searchForm.origin || '').toUpperCase(),
      destinationIata: String(flight?.destinationIata || '').toUpperCase(),
      destination: String(flight?.destination || flight?.destinationIata || '').trim(),
      dateFrom: String(flight?.dateFrom || searchForm.dateFrom || ''),
      dateTo: String(flight?.dateTo || searchForm.dateTo || ''),
      travellers: Number(searchForm.travellers) || 1,
      cabinClass: String(searchForm.cabinClass || 'economy'),
      stopCount: Number.isFinite(Number(flight?.stopCount)) ? Number(flight.stopCount) : undefined,
      comfortScore: Number.isFinite(Number(flight?.comfortScore)) ? Number(flight.comfortScore) : undefined,
      connectionType: searchForm.connectionType,
      travelTime: searchForm.travelTime,
      bookingLink: String(flight?.bookingLink || flight?.link || '').trim()
    }),
    [searchForm]
  );

  const toOpportunityBookingItinerary = useCallback(
    (item) => ({
      itineraryId: String(item?.id || '').trim() || undefined,
      origin: String(item?.origin_airport || item?.origin || searchForm.origin || '').toUpperCase(),
      destinationIata: String(item?.destination_airport || item?.destinationIata || '').toUpperCase(),
      destination: String(item?.destination_city || item?.destination || item?.destination_airport || item?.destinationIata || '').trim(),
      dateFrom: String(item?.depart_date || item?.dateFrom || searchForm.dateFrom || ''),
      dateTo: String(item?.return_date || item?.dateTo || searchForm.dateTo || ''),
      travellers: Number(searchForm.travellers) || 1,
      cabinClass: String(searchForm.cabinClass || 'economy'),
      stopCount: Number.isFinite(Number(item?.stops)) ? Number(item.stops) : undefined,
      comfortScore: Number.isFinite(Number(item?.comfortScore)) ? Number(item.comfortScore) : undefined,
      connectionType: searchForm.connectionType,
      travelTime: searchForm.travelTime,
      bookingLink: String(item?.booking_url || item?.bookingLink || item?.link || '').trim()
    }),
    [searchForm]
  );

  const bookingHandoffFailureMessage = useCallback(() => {
    return t('bookingHandoffError') || 'Unable to open booking right now. Please try again.';
  }, [t]);

  const resolveBookingHandoff = useCallback(
    (flight, surface) => {
      if (!flight?.destinationIata) throw new Error('Missing itinerary destination IATA code.');
      return bookingHandoffLayer.generateBookingHandoff(toBookingItinerary(flight), {
        surface,
        utm: utmParams
      });
    },
    [bookingHandoffLayer, toBookingItinerary, utmParams]
  );

  const openBookingHandoff = useCallback(
    (handoff) => {
      if (!handoff?.url) {
        trackOutboundRedirectFailure({
          surface: handoff?.event?.surface || 'results',
          correlationId: handoff?.event?.correlationId,
          itineraryId: handoff?.event?.itineraryId,
          error: {
            code: 'missing_handoff_url',
            message: 'Missing booking handoff URL.'
          }
        });
        return false;
      }

      trackBookingClickedEvent(handoff);
      void bookingClickTracker.track(handoff.event).catch((error) => {
        trackOutboundRedirectFailure({
          surface: handoff?.event?.surface || 'results',
          correlationId: handoff?.event?.correlationId,
          itineraryId: handoff?.event?.itineraryId,
          error: {
            code: 'booking_click_tracking_failed',
            message: String(error?.message || 'Booking click tracking request failed.')
          }
        });
      });

      if (typeof window === 'undefined') {
        trackOutboundRedirectSuccess(handoff, { openContext: 'non_browser' });
        return true;
      }

      const popup = window.open(handoff.url, '_blank', 'noopener,noreferrer');
      const opened = popup !== null;
      if (opened) {
        trackOutboundRedirectSuccess(handoff, { openContext: 'popup' });
      } else {
        trackOutboundRedirectFailure({
          surface: handoff?.event?.surface || 'results',
          correlationId: handoff?.event?.correlationId,
          itineraryId: handoff?.event?.itineraryId,
          error: {
            code: 'popup_blocked',
            message: 'Booking handoff popup blocked.'
          }
        });
      }
      return opened;
    },
    [bookingClickTracker, trackBookingClickedEvent, trackOutboundRedirectFailure, trackOutboundRedirectSuccess]
  );

  const trackBookingHandoffFailure = useCallback(
    ({ surface, correlationId, itineraryId, error }) => {
      const errorData = getErrorTrackingData(error);
      funnelEventService.trackBookingHandoffFailed({
        searchMode,
        surface,
        correlationId,
        itineraryId,
        errorCode: errorData.errorCode,
        errorMessage: errorData.errorMessage
      });
    },
    [funnelEventService, searchMode]
  );

  const handleBookingFromSearchFlight = useCallback(
    (flight, surface) => {
      clearBookingHandoffError();
      trackResultInteraction('book_cta', surface, flight?.id);
      let handoff = null;
      try {
        handoff = resolveBookingHandoff(flight, surface);
        const opened = openBookingHandoff(handoff);
        if (!opened) throw new Error('Booking handoff popup blocked.');
        clearBookingHandoffError();
      } catch (error) {
        if (!handoff) {
          trackOutboundRedirectFailure({
            surface,
            itineraryId: flight?.id,
            error,
            extra: { stage: 'handoff_generation' }
          });
        }
        trackBookingHandoffFailure({
          surface,
          correlationId: handoff?.event?.correlationId,
          itineraryId: flight?.id,
          error
        });
        setBookingHandoffError(bookingHandoffFailureMessage());
      }
    },
    [
      bookingHandoffFailureMessage,
      clearBookingHandoffError,
      openBookingHandoff,
      resolveBookingHandoff,
      trackBookingHandoffFailure,
      trackOutboundRedirectFailure,
      trackResultInteraction
    ]
  );

  const openOpportunityBooking = useCallback(
    (item) => {
      clearOpportunityBookingError();
      trackResultInteraction('book_cta', 'opportunity_detail', item?.id);

      if (item) {
        const saveOutcome = saveRecentItineraryWithPlanGate(item);
        if (saveOutcome.limitReached) {
          const content = resolveUpgradeTriggerContent('saved_itineraries_limit', {
            used: saveOutcome.usage.used,
            limit: saveOutcome.usage.limit
          });
          setOpportunityDetailUpgradePrompt(toUpgradePrompt(content));
        }
      }

      let handoff = null;
      try {
        handoff = bookingHandoffLayer.generateBookingHandoff(toOpportunityBookingItinerary(item), {
          surface: 'opportunity_detail',
          utm: utmParams
        });
        const opened = openBookingHandoff(handoff);
        if (!opened) throw new Error('Booking handoff popup blocked.');
        clearOpportunityBookingError();
      } catch (error) {
        if (!handoff) {
          trackOutboundRedirectFailure({
            surface: 'opportunity_detail',
            itineraryId: item?.id,
            error,
            extra: { stage: 'handoff_generation' }
          });
        }
        trackBookingHandoffFailure({
          surface: 'opportunity_detail',
          correlationId: handoff?.event?.correlationId,
          itineraryId: item?.id,
          error
        });
        setOpportunityBookingError(bookingHandoffFailureMessage());
      }
    },
    [
      bookingHandoffFailureMessage,
      bookingHandoffLayer,
      clearOpportunityBookingError,
      openBookingHandoff,
      resolveUpgradeTriggerContent,
      saveRecentItineraryWithPlanGate,
      setOpportunityDetailUpgradePrompt,
      toOpportunityBookingItinerary,
      trackBookingHandoffFailure,
      trackOutboundRedirectFailure,
      trackResultInteraction,
      utmParams
    ]
  );

  return {
    bookingHandoffError,
    opportunityBookingError,
    clearBookingHandoffError,
    clearOpportunityBookingError,
    handleBookingFromSearchFlight,
    openOpportunityBooking
  };
}
