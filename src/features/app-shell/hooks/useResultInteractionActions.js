import { differenceInCalendarDays, parseISO } from 'date-fns';

export function useResultInteractionActions({
  api,
  token,
  t,
  isAuthenticated,
  canUseRadarPlan,
  canUseAiTravelPlan,
  searchForm,
  showLandingPage,
  alertDraftById,
  visibleFlights,
  trackResultInteraction,
  beginSetAlertAuthFlow,
  canonicalCountryFilter,
  canonicalDestinationQuery,
  resolveApiError,
  refreshWatchlist,
  refreshSubscriptions,
  refreshNotifications,
  setWatchlistError,
  setSubMessage,
  setAlertDraftById,
  setDestinationInsights,
  setInsightLoadingByFlight,
  setInsightErrorByFlight,
  setCompareIds
}) {
  function getAlertDraft(subscription) {
    return (
      alertDraftById[subscription.id] || {
        targetPrice: Number.isFinite(subscription.targetPrice) ? String(subscription.targetPrice) : '',
        stayDays: String(subscription.stayDays ?? 7),
        travellers: String(subscription.travellers ?? 1),
        cabinClass: subscription.cabinClass || 'economy',
        cheapOnly: Boolean(subscription.cheapOnly)
      }
    );
  }

  function updateAlertDraft(id, patch) {
    setAlertDraftById((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] || {}),
        ...patch
      }
    }));
  }

  async function addToWatchlist(flight) {
    trackResultInteraction('save_watchlist', 'search_results', flight?.id);
    if (!isAuthenticated) return setWatchlistError(t('loginRequiredAlert'));
    try {
      await api.addWatchlist(token, {
        flightId: flight.id,
        destination: flight.destination,
        destinationIata: flight.destinationIata,
        price: flight.price,
        dateFrom: searchForm.dateFrom,
        dateTo: searchForm.dateTo,
        link: flight.bookingLink || flight.link
      });
      await refreshWatchlist();
    } catch (error) {
      setWatchlistError(resolveApiError(error));
    }
  }

  async function removeWatchlistItem(id) {
    try {
      await api.removeWatchlist(token, id);
      await refreshWatchlist();
    } catch (error) {
      setWatchlistError(resolveApiError(error));
    }
  }

  async function createAlertForFlight(flight) {
    trackResultInteraction('create_alert', 'search_results', flight?.id);
    if (!isAuthenticated) {
      beginSetAlertAuthFlow({ keepLandingVisible: showLandingPage });
      setSubMessage(t('loginRequiredAlert'));
      return;
    }

    const stayDays = Math.max(2, differenceInCalendarDays(parseISO(searchForm.dateTo), parseISO(searchForm.dateFrom)));
    const daysFromNow = Math.max(1, differenceInCalendarDays(parseISO(searchForm.dateFrom), new Date()));

    try {
      await api.createAlertSubscription(token, {
        origin: searchForm.origin,
        region: searchForm.region,
        country: canonicalCountryFilter(searchForm.country) || undefined,
        destinationQuery: canonicalDestinationQuery(searchForm.destinationQuery) || undefined,
        destinationIata: flight.destinationIata,
        targetPrice: Number(flight.price),
        connectionType: searchForm.connectionType,
        maxStops: searchForm.maxStops === '' ? undefined : Number(searchForm.maxStops),
        travelTime: searchForm.travelTime,
        minComfortScore: searchForm.minComfortScore === '' ? undefined : Number(searchForm.minComfortScore),
        cheapOnly: searchForm.cheapOnly,
        travellers: Number(searchForm.travellers),
        cabinClass: searchForm.cabinClass,
        stayDays,
        daysFromNow
      });
      await api.runNotificationScan(token);
      await refreshSubscriptions();
      await refreshNotifications();
      setSubMessage(t('alertCreated'));
    } catch (error) {
      setSubMessage(resolveApiError(error));
    }
  }

  async function createDurationAlert() {
    if (!isAuthenticated) return setSubMessage(t('loginRequiredAlert'));
    if (!canUseRadarPlan) return setSubMessage(t('premiumRequired'));

    const stayDays = Math.max(2, differenceInCalendarDays(parseISO(searchForm.dateTo), parseISO(searchForm.dateFrom)));

    try {
      await api.createAlertSubscription(token, {
        origin: searchForm.origin,
        region: searchForm.region,
        country: canonicalCountryFilter(searchForm.country) || undefined,
        destinationQuery: canonicalDestinationQuery(searchForm.destinationQuery) || undefined,
        destinationIata: undefined,
        targetPrice: undefined,
        connectionType: searchForm.connectionType,
        maxStops: searchForm.maxStops === '' ? undefined : Number(searchForm.maxStops),
        travelTime: searchForm.travelTime,
        minComfortScore: searchForm.minComfortScore === '' ? undefined : Number(searchForm.minComfortScore),
        cheapOnly: searchForm.cheapOnly,
        travellers: Number(searchForm.travellers),
        cabinClass: searchForm.cabinClass,
        stayDays,
        daysFromNow: undefined
      });
      await api.runNotificationScan(token);
      await refreshSubscriptions();
      await refreshNotifications();
      setSubMessage(t('durationAlertCreated'));
    } catch (error) {
      setSubMessage(resolveApiError(error));
    }
  }

  async function loadDestinationInsights(flight) {
    trackResultInteraction('load_insights', 'insights', flight?.id);
    if (!canUseAiTravelPlan) return setSubMessage(t('routeInsightsEliteOnly'));
    const stayDays = Math.max(2, differenceInCalendarDays(parseISO(searchForm.dateTo), parseISO(searchForm.dateFrom)));
    setInsightErrorByFlight((prev) => ({ ...prev, [flight.id]: '' }));
    setInsightLoadingByFlight((prev) => ({ ...prev, [flight.id]: true }));

    try {
      const payload = await api.destinationInsights(
        {
          origin: searchForm.origin,
          region: searchForm.region,
          country: canonicalCountryFilter(searchForm.country) || undefined,
          destinationQuery: canonicalDestinationQuery(searchForm.destinationQuery) || flight.destination,
          destinationIata: flight.destinationIata,
          cheapOnly: searchForm.cheapOnly,
          maxBudget: searchForm.maxBudget ? Number(searchForm.maxBudget) : undefined,
          connectionType: searchForm.connectionType,
          maxStops: searchForm.maxStops === '' ? undefined : Number(searchForm.maxStops),
          travelTime: searchForm.travelTime,
          minComfortScore: searchForm.minComfortScore === '' ? undefined : Number(searchForm.minComfortScore),
          travellers: Number(searchForm.travellers),
          cabinClass: searchForm.cabinClass,
          stayDays,
          horizonDays: 120
        },
        token
      );
      setDestinationInsights((prev) => ({ ...prev, [flight.id]: payload }));
    } catch {
      setInsightErrorByFlight((prev) => ({ ...prev, [flight.id]: t('bestDatesError') }));
    } finally {
      setInsightLoadingByFlight((prev) => ({ ...prev, [flight.id]: false }));
    }
  }

  async function deleteSubscription(id) {
    try {
      await api.deleteAlertSubscription(token, id);
      await refreshSubscriptions();
    } catch (error) {
      setSubMessage(resolveApiError(error));
    }
  }

  async function toggleSubscriptionEnabled(subscription) {
    if (!isAuthenticated) return;
    try {
      await api.updateAlertSubscription(token, subscription.id, { enabled: !subscription.enabled });
      await refreshSubscriptions();
      setSubMessage(t('alertUpdated'));
    } catch (error) {
      setSubMessage(resolveApiError(error));
    }
  }

  async function saveSubscriptionEdit(subscription) {
    if (!isAuthenticated) return;
    const draft = getAlertDraft(subscription);
    const parsedTarget = draft.targetPrice === '' ? null : Number(draft.targetPrice);
    const parsedStay = Number(draft.stayDays);
    const parsedTravellers = Number(draft.travellers);

    if (!Number.isFinite(parsedStay) || parsedStay < 2 || parsedStay > 30) return setSubMessage(t('updateFailed'));
    if (!Number.isFinite(parsedTravellers) || parsedTravellers < 1 || parsedTravellers > 9)
      return setSubMessage(t('updateFailed'));
    if (draft.targetPrice !== '' && (!Number.isFinite(parsedTarget) || parsedTarget <= 0))
      return setSubMessage(t('updateFailed'));

    try {
      await api.updateAlertSubscription(token, subscription.id, {
        targetPrice: parsedTarget,
        stayDays: parsedStay,
        travellers: parsedTravellers,
        cabinClass: draft.cabinClass,
        cheapOnly: Boolean(draft.cheapOnly)
      });
      await refreshSubscriptions();
      await refreshNotifications();
      setSubMessage(t('alertUpdated'));
    } catch (error) {
      setSubMessage(resolveApiError(error) || t('updateFailed'));
    }
  }

  async function markNotificationRead(id) {
    await api.markNotificationRead(token, id);
    await refreshNotifications();
  }

  async function markAllRead() {
    await api.markAllNotificationsRead(token);
    await refreshNotifications();
  }

  async function enableBrowserNotifications() {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    try {
      await window.Notification.requestPermission();
    } catch {}
  }

  function toggleCompare(flightId) {
    trackResultInteraction('toggle_compare', 'compare', flightId);
    setCompareIds((prev) => {
      if (prev.includes(flightId)) return prev.filter((id) => id !== flightId);
      if (prev.length >= 3) return [...prev.slice(1), flightId];
      return [...prev, flightId];
    });
  }

  async function saveFirstResult() {
    const first = visibleFlights[0];
    if (!first) return;
    await addToWatchlist(first);
  }

  async function alertFirstResult() {
    const first = visibleFlights[0];
    if (!first) return;
    await createAlertForFlight(first);
  }

  return {
    getAlertDraft,
    updateAlertDraft,
    addToWatchlist,
    removeWatchlistItem,
    createAlertForFlight,
    createDurationAlert,
    loadDestinationInsights,
    deleteSubscription,
    toggleSubscriptionEnabled,
    saveSubscriptionEdit,
    markNotificationRead,
    markAllRead,
    enableBrowserNotifications,
    toggleCompare,
    saveFirstResult,
    alertFirstResult
  };
}
