export default function UserDataPanels({
  t,
  isAuthenticated,
  subMessage,
  subscriptions,
  getAlertDraft,
  regionLabel,
  connectionLabel,
  isAdvancedMode,
  updateAlertDraft,
  config,
  saveSubscriptionEdit,
  toggleSubscriptionEnabled,
  deleteSubscription,
  refreshSubscriptions,
  unreadCount,
  enableBrowserNotifications,
  markAllRead,
  notifError,
  notifications,
  markNotificationRead,
  refreshWatchlist,
  watchlistError,
  watchlist,
  handleBookingFromSearchFlight,
  searchForm,
  removeWatchlistItem
}) {
  return (
    <>
      <section className="middle-grid">
        <article className="panel">
          <div className="panel-head">
            <h2>{t('priceAlerts')}</h2>
            <button className="ghost" type="button" onClick={refreshSubscriptions} disabled={!isAuthenticated}>
              {t('refresh')}
            </button>
          </div>
          <p className="muted">{t('priceAlertsHelp')}</p>
          {subMessage ? <p className="muted">{subMessage}</p> : null}
          {subscriptions.length === 0 ? <p className="muted">{t('noAlerts')}</p> : null}
          <div className="list-stack">
            {subscriptions.map((s) => {
              const draft = getAlertDraft(s);
              return (
                <div key={s.id} className="watch-item">
                  <div className="alert-row-main">
                    <strong>{t('myAlerts')}</strong>
                    <p>
                      {s.origin} | {regionLabel(s.region)} | {s.scanMode === 'duration_auto' ? `${t('smart')} ${s.stayDays}d` : `EUR ${s.targetPrice}`} |{' '}
                      {connectionLabel(s.connectionType) || t('any')} | {s.enabled ? t('on') : t('off')}
                    </p>
                    {isAdvancedMode ? (
                      <details className="advanced-block" open>
                        <summary>{t('editAlert')}</summary>
                        <div className="alert-inline-grid">
                          <label>
                            {t('eurTarget')}
                            <input
                              type="number"
                              min={0}
                              value={draft.targetPrice}
                              onChange={(e) => updateAlertDraft(s.id, { targetPrice: e.target.value })}
                              placeholder={t('emptyAuto')}
                            />
                          </label>
                          <label>
                            {t('stayDays')}
                            <input type="number" min={2} max={30} value={draft.stayDays} onChange={(e) => updateAlertDraft(s.id, { stayDays: e.target.value })} />
                          </label>
                          <label>
                            {t('travellers')}
                            <input type="number" min={1} max={9} value={draft.travellers} onChange={(e) => updateAlertDraft(s.id, { travellers: e.target.value })} />
                          </label>
                          <label>
                            {t('cabin')}
                            <select value={draft.cabinClass} onChange={(e) => updateAlertDraft(s.id, { cabinClass: e.target.value })}>
                              {config.cabins.map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="check-row">
                            <input
                              type="checkbox"
                              checked={Boolean(draft.cheapOnly)}
                              onChange={(e) => updateAlertDraft(s.id, { cheapOnly: e.target.checked })}
                            />
                            {t('dealsOnly')}
                          </label>
                        </div>
                        <button className="ghost" type="button" onClick={() => saveSubscriptionEdit(s)}>
                          {t('saveChanges')}
                        </button>
                      </details>
                    ) : null}
                  </div>
                  <div className="item-actions">
                    <button className="ghost" type="button" onClick={() => toggleSubscriptionEnabled(s)}>
                      {s.enabled ? t('disableAlert') : t('enableAlert')}
                    </button>
                    <button className="ghost" type="button" onClick={() => deleteSubscription(s.id)}>
                      {t('remove')}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </article>

        <article className="panel">
          <div className="panel-head">
            <h2>
              {t('notifications')} ({unreadCount})
            </h2>
            <div className="item-actions">
              <button className="ghost" type="button" onClick={enableBrowserNotifications}>
                {t('enableBrowser')}
              </button>
              <button className="ghost" type="button" onClick={markAllRead} disabled={!isAuthenticated}>
                {t('markAllRead')}
              </button>
            </div>
          </div>
          {notifError ? <p className="error">{notifError}</p> : null}
          {notifications.length === 0 ? <p className="muted">{t('noNotifications')}</p> : null}
          <div className="list-stack">
            {notifications.map((n) => (
              <div key={n.id} className={n.readAt ? 'watch-item muted-item' : 'watch-item'}>
                <div>
                  <strong>{n.title}</strong>
                  <p>{n.message}</p>
                </div>
                {!n.readAt ? (
                  <button className="ghost" type="button" onClick={() => markNotificationRead(n.id)}>
                    {t('markRead')}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="middle-grid">
        <article className="panel">
          <div className="panel-head">
            <h2>{t('watchlist')}</h2>
            <button className="ghost" type="button" onClick={refreshWatchlist} disabled={!isAuthenticated}>
              {t('refresh')}
            </button>
          </div>
          <p className="muted">{t('watchlistHelp')}</p>
          {watchlistError ? <p className="error">{watchlistError}</p> : null}
          {watchlist.length === 0 ? <p className="muted">{t('emptyWatchlist')}</p> : null}
          <div className="list-stack">
            {watchlist.map((item) => (
              <div key={item.id} className="watch-item">
                <div>
                  <strong>{item.destination}</strong>
                  <p>
                    EUR {item.price} | {item.dateFrom} {t('to')} {item.dateTo}
                  </p>
                </div>
                <div className="item-actions">
                  <button
                    type="button"
                    onClick={() =>
                      handleBookingFromSearchFlight(
                        {
                          origin: item.flightId?.split('-')?.[0] || searchForm.origin,
                          destinationIata: item.destinationIata,
                          destination: item.destination,
                          dateFrom: item.dateFrom,
                          dateTo: item.dateTo
                        },
                        'watchlist'
                      )
                    }
                  >
                    {t('partnerCta')}
                  </button>
                  <button className="ghost" type="button" onClick={() => removeWatchlistItem(item.id)}>
                    {t('remove')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>
    </>
  );
}

