export function createExploreOperations({
  api,
  token,
  exploreDiscoveryInput,
  exploreSelectedDestination,
  setExploreBudgetItems,
  setExploreMapPoints,
  setExploreBudgetError,
  setExploreMapError,
  setExploreBudgetLoading,
  setExploreMapLoading,
  setExploreDiscoveryInput,
  setExploreSelectedDestination,
  setActiveMainSection,
  setSearchForm,
  setSubMessage,
  resolveApiError,
  t
}) {
  async function loadExploreDiscovery(overrides = {}) {
    const origin = String(overrides.origin ?? exploreDiscoveryInput.origin ?? '').trim().toUpperCase();
    const budgetCandidate = overrides.budgetMax ?? exploreDiscoveryInput.budgetMax;
    const budgetMax = Number(budgetCandidate);
    const limitCandidate = Number(overrides.limit ?? exploreDiscoveryInput.limit ?? 24);
    const limit = Number.isFinite(limitCandidate) && limitCandidate > 0 ? Math.min(60, Math.max(5, Math.round(limitCandidate))) : 24;

    if (!/^[A-Z]{3}$/.test(origin)) {
      setExploreBudgetItems([]);
      setExploreMapPoints([]);
      setExploreBudgetError(t('exploreDiscoveryOriginRequired'));
      setExploreMapError('');
      return;
    }
    if (!Number.isFinite(budgetMax) || budgetMax <= 0) {
      setExploreBudgetItems([]);
      setExploreMapPoints([]);
      setExploreBudgetError(t('exploreDiscoveryBudgetRequired'));
      setExploreMapError('');
      return;
    }

    setExploreBudgetLoading(true);
    setExploreMapLoading(true);
    setExploreBudgetError('');
    setExploreMapError('');
    setExploreDiscoveryInput((prev) => ({
      ...prev,
      origin,
      budgetMax: String(Math.round(budgetMax)),
      limit
    }));

    const [budgetResult, mapResult] = await Promise.allSettled([
      api.opportunityExploreBudget(token, { origin, budgetMax, limit }),
      api.opportunityExploreMap(token, { origin, budgetMax, limit })
    ]);

    if (budgetResult.status === 'fulfilled') {
      const items = Array.isArray(budgetResult.value?.items) ? budgetResult.value.items : [];
      setExploreBudgetItems(items);
      if (!items.length) setExploreSelectedDestination('');
      else {
        const selected = String(exploreSelectedDestination || '').toUpperCase();
        const hasSelected = items.some((item) => String(item.destination_airport || '').toUpperCase() === selected);
        if (!selected || !hasSelected) setExploreSelectedDestination(String(items[0].destination_airport || '').toUpperCase());
      }
    } else {
      setExploreBudgetItems([]);
      setExploreBudgetError(resolveApiError(budgetResult.reason));
    }

    if (mapResult.status === 'fulfilled') {
      const points = Array.isArray(mapResult.value?.points) ? mapResult.value.points : [];
      setExploreMapPoints(points);
    } else {
      setExploreMapPoints([]);
      setExploreMapError(resolveApiError(mapResult.reason));
    }

    setExploreBudgetLoading(false);
    setExploreMapLoading(false);
  }

  function applyExploreDestination(item) {
    const destinationAirport = String(item?.destination_airport || '').toUpperCase();
    const destinationQuery = String(item?.destination_city || destinationAirport || '').trim();
    const budgetValue = Number(item?.price_from);
    const resolvedBudget = Number.isFinite(budgetValue) && budgetValue > 0 ? String(Math.round(budgetValue)) : '';
    if (!destinationQuery) return;
    setExploreSelectedDestination(destinationAirport);
    setActiveMainSection('home');
    setSearchForm((prev) => ({
      ...prev,
      origin: String(exploreDiscoveryInput.origin || prev.origin || '').toUpperCase() || prev.origin,
      destinationQuery,
      maxBudget: resolvedBudget || prev.maxBudget,
      cheapOnly: true
    }));
    setSubMessage(`${t('exploreDiscoveryAppliedPrefix')} ${destinationQuery}`);
  }

  return {
    loadExploreDiscovery,
    applyExploreDestination
  };
}
