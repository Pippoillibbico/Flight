export function createAiTravelOperations({
  isAuthenticated,
  aiTravelPrompt,
  userPlanType,
  searchResult,
  opportunityFeed,
  searchForm,
  searchSortBy,
  searchMode,
  t,
  aiGateway,
  resolveApiError,
  getUpgradeTriggerContent,
  buildItineraryGenerationInputs,
  buildItineraryGenerationPreferences,
  setAiTravelLoading,
  setAiTravelError,
  setAiTravelResult,
  setSubMessage
}) {
  async function runAiTravelQuery() {
    if (!isAuthenticated) return setAiTravelError(t('loginRequiredAlert'));
    if (!String(aiTravelPrompt || '').trim()) return;

    setAiTravelLoading(true);
    setAiTravelError('');
    try {
      const generationInputs = buildItineraryGenerationInputs({ searchResult, opportunityFeed, searchForm });
      const preferences = buildItineraryGenerationPreferences({ searchForm, searchSortBy, searchMode });
      const gatewayResult = await aiGateway.execute({
        taskType: 'itinerary_generation',
        planType: userPlanType,
        input: {
          prompt: aiTravelPrompt,
          generationInputs,
          preferences
        },
        maxOutputTokens: userPlanType === 'elite' ? 1800 : userPlanType === 'pro' ? 1100 : 450,
        schemaKey: 'itinerary_generation'
      });

      if (!gatewayResult.ok) {
        const blockedByPolicy = Boolean(gatewayResult.telemetry?.blockedByPolicy);
        if (blockedByPolicy) {
          const content = getUpgradeTriggerContent(userPlanType, 'ai_travel_limit');
          setAiTravelError(content.message);
          setSubMessage(content.message);
        } else {
          setAiTravelError(String(gatewayResult.error?.message || 'AI request failed.'));
        }
        setAiTravelResult(null);
        return;
      }

      setAiTravelResult(gatewayResult.data || null);
    } catch (error) {
      setAiTravelResult(null);
      setAiTravelError(resolveApiError(error));
    } finally {
      setAiTravelLoading(false);
    }
  }

  return {
    runAiTravelQuery
  };
}
