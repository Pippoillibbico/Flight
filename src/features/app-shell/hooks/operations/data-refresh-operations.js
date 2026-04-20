function buildSubscriptionDraft(existingDraft, subscriptionItem) {
  return (
    existingDraft || {
      targetPrice: Number.isFinite(subscriptionItem?.targetPrice) ? String(subscriptionItem.targetPrice) : '',
      stayDays: String(subscriptionItem?.stayDays ?? 7),
      travellers: String(subscriptionItem?.travellers ?? 1),
      cabinClass: subscriptionItem?.cabinClass || 'economy',
      cheapOnly: Boolean(subscriptionItem?.cheapOnly)
    }
  );
}

export function createDataRefreshOperations({
  api,
  token,
  isAuthenticated,
  resolveApiError,
  notifiedIdsRef,
  setWatchlist,
  setWatchlistError,
  setSubscriptions,
  setAlertDraftById,
  setNotifications,
  setUnreadCount,
  setNotifError,
  setSearchHistory,
  setSecurityEvents,
  setSecurityError
}) {
  async function refreshWatchlist() {
    if (!isAuthenticated) return;
    setWatchlistError('');
    try {
      const payload = await api.watchlist(token);
      setWatchlist(payload.items);
    } catch (error) {
      setWatchlistError(resolveApiError(error));
    }
  }

  async function refreshSubscriptions() {
    if (!isAuthenticated) return;
    try {
      const payload = await api.listAlertSubscriptions(token);
      const items = Array.isArray(payload?.items) ? payload.items : [];
      setSubscriptions(items);
      setAlertDraftById((prev) => {
        const next = {};
        for (const item of items) {
          next[item.id] = buildSubscriptionDraft(prev[item.id], item);
        }
        return next;
      });
    } catch {
      setSubscriptions([]);
    }
  }

  async function refreshNotifications(isPolling = false) {
    if (!isAuthenticated) return;
    setNotifError('');
    try {
      const payload = await api.listNotifications(token);
      const items = Array.isArray(payload?.items) ? payload.items : [];
      setNotifications(items);
      setUnreadCount(Number(payload?.unread || 0));

      const canUseBrowserNotifications =
        typeof window !== 'undefined' && 'Notification' in window && window.Notification.permission === 'granted';
      if (isPolling && canUseBrowserNotifications) {
        for (const notification of items) {
          if (notification.readAt || notifiedIdsRef.current.has(notification.id)) continue;
          notifiedIdsRef.current.add(notification.id);
          try {
            new window.Notification(notification.title, { body: notification.message });
          } catch {
            break;
          }
        }
      }
    } catch (error) {
      setNotifError(resolveApiError(error));
    }
  }

  async function refreshSearchHistory() {
    if (!isAuthenticated) return;
    try {
      const payload = await api.searchHistory(token);
      setSearchHistory(payload.items || []);
    } catch {
      setSearchHistory([]);
    }
  }

  async function refreshSecurityActivity() {
    if (!isAuthenticated) return;
    setSecurityError('');
    try {
      const payload = await api.securityActivity(token);
      setSecurityEvents(payload.items || []);
    } catch (error) {
      setSecurityEvents([]);
      setSecurityError(resolveApiError(error));
    }
  }

  return {
    refreshWatchlist,
    refreshSubscriptions,
    refreshNotifications,
    refreshSearchHistory,
    refreshSecurityActivity
  };
}
