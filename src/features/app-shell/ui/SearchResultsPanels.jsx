import InfoTip from '../../../components/InfoTip';

export default function SearchResultsPanels({
  t,
  tt,
  isAdvancedMode,
  visibleFlights,
  saveFirstResult,
  alertFirstResult,
  cheapestFlight,
  bestValueFlight,
  resolveCityName,
  dealLabelText,
  handleBookingFromSearchFlight,
  addToWatchlist,
  createAlertForFlight,
  searchSortBy,
  setSearchSortBy,
  searchResult,
  bookingHandoffError,
  radarStateText,
  compareIds,
  toggleCompare,
  loadDestinationInsights,
  insightLoadingByFlight,
  canUseAiTravelPlan,
  insightErrorByFlight,
  destinationInsights,
  comparedFlights,
  setCompareIds
}) {
  return (
    <>
      {!isAdvancedMode && visibleFlights.length > 0 ? (
        <section className="panel search-quick-actions-panel">
          <div className="panel-head">
            <h2>{t('quickActions')}</h2>
          </div>
          <div className="item-actions">
            <button type="button" onClick={saveFirstResult}>
              {t('saveBest')}
            </button>
            <button type="button" className="ghost" onClick={alertFirstResult}>
              {t('alertBest')}
            </button>
          </div>
        </section>
      ) : null}

      {visibleFlights.length > 0 ? (
        <section className="panel search-top-picks-panel">
          <div className="panel-head">
            <h2>{t('topPicks')}</h2>
          </div>
          <div className="middle-grid">
            {cheapestFlight ? (
              <article className="result-card">
                <div>
                  <strong>{t('cheapestNow')}</strong>
                  <p>
                    {resolveCityName(cheapestFlight.destination, cheapestFlight.destinationIata)} | EUR {cheapestFlight.price} | {cheapestFlight.stopLabel}
                  </p>
                  {cheapestFlight.dealLabel ? (
                    <p className={`deal-value-label deal-value-${cheapestFlight.dealLabel}`}>
                      {dealLabelText(t, cheapestFlight.dealLabel)} {cheapestFlight.dealReason ? `- ${cheapestFlight.dealReason}` : ''}
                    </p>
                  ) : null}
                </div>
                <div className="item-actions">
                  <button type="button" data-testid="book-top-pick" onClick={() => handleBookingFromSearchFlight(cheapestFlight, 'top_picks')}>
                    {t('partnerCta')}
                  </button>
                  <button type="button" onClick={() => addToWatchlist(cheapestFlight)}>
                    {t('save')}
                  </button>
                </div>
              </article>
            ) : null}
            {bestValueFlight ? (
              <article className="result-card">
                <div>
                  <strong>{t('bestValue')}</strong>
                  <p>
                    {resolveCityName(bestValueFlight.destination, bestValueFlight.destinationIata)} | {t('savingVs2024')}: EUR {bestValueFlight.savingVs2024} |{' '}
                    {bestValueFlight.stopLabel}
                  </p>
                  {bestValueFlight.dealLabel ? (
                    <p className={`deal-value-label deal-value-${bestValueFlight.dealLabel}`}>
                      {dealLabelText(t, bestValueFlight.dealLabel)} {bestValueFlight.dealReason ? `- ${bestValueFlight.dealReason}` : ''}
                    </p>
                  ) : null}
                </div>
                <div className="item-actions">
                  <button type="button" data-testid="book-best-value" onClick={() => handleBookingFromSearchFlight(bestValueFlight, 'top_picks')}>
                    {t('partnerCta')}
                  </button>
                  <button type="button" className="ghost" onClick={() => createAlertForFlight(bestValueFlight)}>
                    {t('alertAtPrice')}
                  </button>
                </div>
              </article>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="panel search-results-panel">
        <div className="panel-head">
          <h2>{t('results')}</h2>
          {isAdvancedMode ? (
            <label className="sort-pick">
              {t('sortBy')}
              <select value={searchSortBy} onChange={(e) => setSearchSortBy(e.target.value)}>
                <option value="saving">{t('sortSaving')}</option>
                <option value="price">{t('sortPrice')}</option>
                <option value="avg2024">{t('sortAvg2024')}</option>
                <option value="travelScore">{t('sortTravelScore') || `${t('travelScore')} (${t('bestValue')})`}</option>
                <option value="deal">{t('sortDealPriority')}</option>
                <option value="radar">{t('sortRadarPriority')}</option>
              </select>
            </label>
          ) : null}
        </div>
        {searchResult?.meta?.bookability ? (
          <p className="muted">
            {t('searchModeLabel')}: {searchResult.meta.searchMode || t('notAvailable')} | {t('bookabilityLabel')}: {searchResult.meta.bookability}
          </p>
        ) : null}
        {searchResult?.inventory?.providerValidated?.degradedReason ? (
          <p className="muted">{t('providerValidationDegradedLabel')}: {String(searchResult.inventory.providerValidated.degradedReason)}</p>
        ) : null}

        {searchResult.flights.length === 0 ? <p className="muted">{t('noResults')}</p> : null}
        {bookingHandoffError ? <p className="error" data-testid="booking-handoff-error">{bookingHandoffError}</p> : null}

        <div className="results-grid">
          {visibleFlights.map((flight) => (
            <article key={flight.id} className="result-card" data-testid={`result-card-${flight.id}`}>
              <div>
                <strong>
                  {resolveCityName(flight.origin, flight.origin)} {t('to')} {resolveCityName(flight.destination, flight.destinationIata)}
                </strong>
                <p>
                  EUR {flight.price} | {flight.stopLabel} | {flight.departureTimeLabel} {t('to')} {flight.arrivalTimeLabel} | {flight.durationHours}h | {t('comfort')} {flight.comfortScore}/100
                </p>
                {Number.isFinite(flight.travelScore) ? (
                  <p>
                    <span data-testid={`travel-score-${flight.id}`}>{t('travelScore')} {flight.travelScore}/100</span> | {t('totalEstimated')} EUR {flight.costBreakdown?.total ?? '-'} | {t('climate')} {flight.climateInPeriod?.avgTempC ?? '-'}C | {t('crowding')}{' '}
                    {flight.crowding?.index ?? '-'}
                  </p>
                ) : null}
                {flight.dealLabel ? (
                  <p className={`deal-value-label deal-value-${flight.dealLabel}`} data-testid={`deal-label-${flight.id}`}>
                    {dealLabelText(t, flight.dealLabel)} {flight.dealReason ? `- ${flight.dealReason}` : ''}
                  </p>
                ) : null}
                {flight.radarState ? (
                  <p className={`radar-state-badge radar-state-${flight.radarState}`} data-testid={`radar-badge-${flight.id}`}>
                    {radarStateText(t, flight.radarState)} {flight.radarReason ? `- ${flight.radarReason}` : ''}
                  </p>
                ) : null}
                {Array.isArray(flight.reasons) && flight.reasons.length > 0 ? <p>{flight.reasons.slice(0, 2).join(' | ')}</p> : null}
                {flight.aiWhyNow ? <p>AI: {flight.aiWhyNow}</p> : null}
              </div>
              <div className="item-actions">
                <button type="button" data-testid={`book-result-${flight.id}`} onClick={() => handleBookingFromSearchFlight(flight, 'results')}>
                  {t('partnerCta')}
                </button>
                <button type="button" onClick={() => addToWatchlist(flight)}>
                  {t('save')}
                </button>
                <button type="button" className="ghost" onClick={() => createAlertForFlight(flight)}>
                  {t('alertAtPrice')}
                </button>
                <button type="button" className={compareIds.includes(flight.id) ? 'tab active' : 'ghost'} onClick={() => toggleCompare(flight.id)}>
                  {t('compare')}
                </button>
                <InfoTip text={tt('compare_help')} />
                {isAdvancedMode ? (
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => loadDestinationInsights(flight)}
                    disabled={Boolean(insightLoadingByFlight[flight.id]) || !canUseAiTravelPlan}
                  >
                    {insightLoadingByFlight[flight.id] ? t('bestDatesLoading') : t('bestDates')}
                  </button>
                ) : null}
                {isAdvancedMode ? <InfoTip text={tt('best_dates_help')} /> : null}
              </div>
              {isAdvancedMode && insightErrorByFlight[flight.id] ? <p className="error">{insightErrorByFlight[flight.id]}</p> : null}
              {isAdvancedMode && destinationInsights[flight.id]?.windows?.length ? (
                <div className="list-stack">
                  <p className="muted">
                    {t('suggestedDates')} | min EUR {destinationInsights[flight.id].stats?.minPrice ?? '-'} | avg EUR {destinationInsights[flight.id].stats?.avgPrice ?? '-'}
                  </p>
                  {destinationInsights[flight.id].windows.slice(0, 3).map((windowItem) => (
                    <div key={`${flight.id}-${windowItem.dateFrom}-${windowItem.dateTo}`} className="watch-item">
                      <div>
                        <strong>
                          {windowItem.dateFrom} {t('to')} {windowItem.dateTo}
                        </strong>
                        <p>
                          EUR {windowItem.price} | {t('avg2024Label')} EUR {windowItem.avg2024}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          handleBookingFromSearchFlight(
                            {
                              ...windowItem,
                              origin: flight.origin,
                              stopCount: flight.stopCount,
                              comfortScore: flight.comfortScore
                            },
                            'insights'
                          )
                        }
                      >
                        {t('partnerCta')}
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
        </div>
        {visibleFlights.length > 0 ? <p className="muted">{t('affiliateDisclosure')}</p> : null}
      </section>

      {comparedFlights.length > 0 ? (
        <section className="panel">
          <div className="panel-head">
            <h2>{t('comparedFlights')}</h2>
            <button type="button" className="ghost" onClick={() => setCompareIds([])}>
              {t('clearCompare')}
            </button>
          </div>
          <div className="compare-grid">
            {comparedFlights.map((flight) => (
              <article key={flight.id} className="watch-item compare-card">
                <div>
                  <strong>{resolveCityName(flight.destination, flight.destinationIata)}</strong>
                  <p>EUR {flight.price}</p>
                  <p>
                    {flight.stopLabel} | {flight.durationHours}h
                  </p>
                  <p>{t('savingVs2024')}: EUR {flight.savingVs2024}</p>
                  <p>{flight.climate}</p>
                </div>
                <div className="item-actions">
                  <button type="button" onClick={() => handleBookingFromSearchFlight(flight, 'compare')}>
                    {t('partnerCta')}
                  </button>
                  <button type="button" onClick={() => addToWatchlist(flight)}>
                    {t('save')}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
