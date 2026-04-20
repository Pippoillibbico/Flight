export function createRadarOperations({
  api,
  token,
  isAuthenticated,
  toRadarDraft,
  setRadarError,
  setRadarDraft,
  setRadarMatchesLoading,
  setRadarMatchesError,
  setRadarMatches,
  setRadarFollowsLoading,
  setRadarFollowsError,
  setRadarFollows,
  resolveApiError
}) {
  async function loadRadarPreferences() {
    if (!isAuthenticated) return;
    setRadarError('');
    try {
      const payload = await api.getRadarPreferences(token);
      setRadarDraft(toRadarDraft(payload.item));
    } catch (error) {
      setRadarError(resolveApiError(error));
    }
  }

  async function loadRadarMatches() {
    if (!isAuthenticated) return;
    setRadarMatchesLoading(true);
    setRadarMatchesError('');
    try {
      const payload = await api.radarMatches(token);
      setRadarMatches(Array.isArray(payload?.items) ? payload.items : []);
    } catch (error) {
      setRadarMatches([]);
      setRadarMatchesError(resolveApiError(error));
    } finally {
      setRadarMatchesLoading(false);
    }
  }

  async function loadRadarFollows() {
    if (!isAuthenticated) return;
    setRadarFollowsLoading(true);
    setRadarFollowsError('');
    try {
      const payload = await api.listFollows(token);
      const items = Array.isArray(payload?.items) ? payload.items : [];
      setRadarFollows(items.filter((item) => String(item.follow_type || '').toLowerCase() === 'radar'));
    } catch (error) {
      setRadarFollows([]);
      setRadarFollowsError(resolveApiError(error));
    } finally {
      setRadarFollowsLoading(false);
    }
  }

  return {
    loadRadarPreferences,
    loadRadarMatches,
    loadRadarFollows
  };
}
