import ExploreDiscoverySection from '../../../components/ExploreDiscoverySection';
import SearchSection from '../../../components/SearchSection';
import { localizeClusterDisplayName } from '../../../utils/localizePlace';
import SearchResultsPanels from './SearchResultsPanels';
import UserDataPanels from './UserDataPanels';

export default function ExploreMainSection({
  t,
  tt,
  language,
  selectedOpportunityCluster,
  setSelectedOpportunityCluster,
  destinationClusters,
  setActiveMainSection,
  systemCapabilities,
  config,
  exploreDiscoveryInput,
  setExploreDiscoveryInput,
  loadExploreDiscovery,
  exploreBudgetLoading,
  exploreBudgetError,
  exploreBudgetItems,
  exploreMapPoints,
  exploreMapLoading,
  exploreMapError,
  exploreSelectedDestination,
  setExploreSelectedDestination,
  applyExploreDestination,
  uiMode,
  setUiMode,
  submitSearch,
  searchMode,
  setSearchMode,
  multiCitySegments,
  multiCityValidation,
  setMultiCitySegmentValue,
  appendMultiCitySegment,
  deleteMultiCitySegment,
  retryMultiCitySearch,
  multiCityRetryVisible,
  intakePrompt,
  setIntakePrompt,
  analyzeIntentPrompt,
  quickIntakePrompts,
  runQuickIntakePrompt,
  intakeLoading,
  intakeMessages,
  intakeInfo,
  searchForm,
  setSearchForm,
  showDestinationSuggestions,
  setShowDestinationSuggestions,
  destinationSuggestions,
  applyPeriodPreset,
  showCountrySuggestions,
  setShowCountrySuggestions,
  countrySuggestions,
  submitJustGo,
  searchLoading,
  createDurationAlert,
  upgradeToPremium,
  canUseRadarPlan,
  canUseAiTravelPlan,
  searchError,
  searchResult,
  autoFixSearchFilters,
  limitReachedBanner = null,
  isAdvancedMode,
  isAuthenticated,
  runFeatureAuditCheck,
  featureAuditLoading,
  featureAuditError,
  featureAudit,
  loadMonetizationReport,
  monetizationLoading,
  monetizationError,
  monetizationReport,
  loadFunnelReport,
  funnelLoading,
  funnelError,
  funnelReport,
  loadOutboundReport,
  outboundReportLoading,
  exportOutboundReportCsv,
  outboundCsvLoading,
  outboundReportError,
  outboundReport,
  runSecurityAuditCheck,
  securityAuditLoading,
  securityAuditError,
  securityAudit,
  refreshSecurityActivity,
  securityInfo,
  securityError,
  securityEvents,
  refreshSearchHistory,
  searchHistory,
  regionLabel,
  applySearchPreset,
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
  bookingHandoffError,
  radarStateText,
  compareIds,
  toggleCompare,
  loadDestinationInsights,
  insightLoadingByFlight,
  insightErrorByFlight,
  destinationInsights,
  comparedFlights,
  setCompareIds,
  subMessage,
  subscriptions,
  getAlertDraft,
  connectionLabel,
  updateAlertDraft,
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
  removeWatchlistItem
}) {
  const visibleClusterShortcuts = destinationClusters
    .map((cluster) => ({
      cluster,
      label: localizeClusterDisplayName(cluster, language)
    }))
    .filter(({ cluster, label }) => {
      if (!label) return false;
      const opportunitiesCount = Number(cluster?.opportunities_count || 0);
      const minPrice = Number(cluster?.min_price);
      return opportunitiesCount >= 2 || (Number.isFinite(minPrice) && minPrice < 180);
    })
    .slice(0, 6);

  return (
    <>
      <section className="panel explore-page-intro">
        <div className="panel-head">
          <h2>{t('explorePageTitle')}</h2>
          {selectedOpportunityCluster ? (
            <button type="button" className="ghost" onClick={() => setSelectedOpportunityCluster('')}>
              {t('exploreClearClusterFilter')}
            </button>
          ) : null}
        </div>
        <p className="muted">{t('explorePageSubtitleExtended')}</p>
        <div className={`item-actions explore-cluster-shortcuts${visibleClusterShortcuts.length > 0 ? '' : ' empty'}`}>
          {visibleClusterShortcuts.map(({ cluster, label }) => (
            <button
              key={cluster.slug}
              type="button"
              className={selectedOpportunityCluster === cluster.slug ? 'tab active' : 'tab'}
              onClick={() => {
                setSelectedOpportunityCluster(cluster.slug);
                setActiveMainSection('home');
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <ExploreDiscoverySection
        t={t}
        language={language}
        dataSource={systemCapabilities?.data_source || 'synthetic'}
        origins={config.origins}
        value={exploreDiscoveryInput}
        onChange={(next) => setExploreDiscoveryInput((prev) => ({ ...prev, ...next }))}
        onSubmit={loadExploreDiscovery}
        loading={exploreBudgetLoading}
        error={exploreBudgetError}
        budgetItems={exploreBudgetItems}
        mapPoints={exploreMapPoints}
        mapLoading={exploreMapLoading}
        mapError={exploreMapError}
        selectedDestination={exploreSelectedDestination}
        onSelectDestination={setExploreSelectedDestination}
        onApplyDestination={applyExploreDestination}
      />

      <SearchSection
        uiMode={uiMode}
        setUiMode={setUiMode}
        submitSearch={submitSearch}
        searchMode={searchMode}
        setSearchMode={setSearchMode}
        multiCitySegments={multiCitySegments}
        multiCityValidation={multiCityValidation}
        setMultiCitySegmentValue={setMultiCitySegmentValue}
        appendMultiCitySegment={appendMultiCitySegment}
        deleteMultiCitySegment={deleteMultiCitySegment}
        retryMultiCitySearch={retryMultiCitySearch}
        multiCityRetryVisible={multiCityRetryVisible}
        intakePrompt={intakePrompt}
        setIntakePrompt={setIntakePrompt}
        analyzeIntentPrompt={analyzeIntentPrompt}
        quickIntakePrompts={quickIntakePrompts}
        runQuickIntakePrompt={runQuickIntakePrompt}
        intakeLoading={intakeLoading}
        intakeMessages={intakeMessages}
        intakeInfo={intakeInfo}
        searchForm={searchForm}
        setSearchForm={setSearchForm}
        config={config}
        showDestinationSuggestions={showDestinationSuggestions}
        setShowDestinationSuggestions={setShowDestinationSuggestions}
        destinationSuggestions={destinationSuggestions}
        applyPeriodPreset={applyPeriodPreset}
        showCountrySuggestions={showCountrySuggestions}
        setShowCountrySuggestions={setShowCountrySuggestions}
        countrySuggestions={countrySuggestions}
        submitJustGo={submitJustGo}
        searchLoading={searchLoading}
        createDurationAlert={createDurationAlert}
        upgradeToPremium={() => upgradeToPremium('search_results_soft_gate')}
        canUseProFeatures={canUseRadarPlan}
        canUseEliteFeatures={canUseAiTravelPlan}
        searchError={searchError}
        searchResult={searchResult}
        autoFixSearchFilters={autoFixSearchFilters}
        limitReachedBanner={limitReachedBanner}
      />

      <SearchResultsPanels
        t={t}
        tt={tt}
        isAdvancedMode={isAdvancedMode}
        visibleFlights={visibleFlights}
        saveFirstResult={saveFirstResult}
        alertFirstResult={alertFirstResult}
        cheapestFlight={cheapestFlight}
        bestValueFlight={bestValueFlight}
        resolveCityName={resolveCityName}
        dealLabelText={dealLabelText}
        handleBookingFromSearchFlight={handleBookingFromSearchFlight}
        addToWatchlist={addToWatchlist}
        createAlertForFlight={createAlertForFlight}
        searchSortBy={searchSortBy}
        setSearchSortBy={setSearchSortBy}
        searchResult={searchResult}
        bookingHandoffError={bookingHandoffError}
        radarStateText={radarStateText}
        compareIds={compareIds}
        toggleCompare={toggleCompare}
        loadDestinationInsights={loadDestinationInsights}
        insightLoadingByFlight={insightLoadingByFlight}
        canUseAiTravelPlan={canUseAiTravelPlan}
        insightErrorByFlight={insightErrorByFlight}
        destinationInsights={destinationInsights}
        comparedFlights={comparedFlights}
        setCompareIds={setCompareIds}
      />

      {isAuthenticated ? (
        <UserDataPanels
          t={t}
          isAuthenticated={isAuthenticated}
          subMessage={subMessage}
          subscriptions={subscriptions}
          getAlertDraft={getAlertDraft}
          regionLabel={regionLabel}
          connectionLabel={connectionLabel}
          isAdvancedMode={isAdvancedMode}
          updateAlertDraft={updateAlertDraft}
          config={config}
          saveSubscriptionEdit={saveSubscriptionEdit}
          toggleSubscriptionEnabled={toggleSubscriptionEnabled}
          deleteSubscription={deleteSubscription}
          refreshSubscriptions={refreshSubscriptions}
          unreadCount={unreadCount}
          enableBrowserNotifications={enableBrowserNotifications}
          markAllRead={markAllRead}
          notifError={notifError}
          notifications={notifications}
          markNotificationRead={markNotificationRead}
          refreshWatchlist={refreshWatchlist}
          watchlistError={watchlistError}
          watchlist={watchlist}
          handleBookingFromSearchFlight={handleBookingFromSearchFlight}
          searchForm={searchForm}
          removeWatchlistItem={removeWatchlistItem}
        />
      ) : null}
    </>
  );
}
