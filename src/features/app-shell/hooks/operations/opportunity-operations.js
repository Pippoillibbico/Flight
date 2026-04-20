import { format } from 'date-fns';
import { downloadTextFile, openJsonPayloadInNewTab } from './browser-export-utils.js';

async function resolveOpportunityDebugPayload({
  opportunityPipelineStatus,
  api,
  token,
  setOpportunityPipelineStatusError,
  resolveApiError
}) {
  if (opportunityPipelineStatus) return opportunityPipelineStatus;
  try {
    return await api.opportunityDebug(token);
  } catch (error) {
    setOpportunityPipelineStatusError(resolveApiError(error));
    return null;
  }
}

export function createOpportunityOperations({
  api,
  token,
  isAuthenticated,
  isAdminUser,
  selectedOpportunityCluster,
  opportunityPipelineStatus,
  COOKIE_SESSION_TOKEN,
  resolveApiError,
  setOpportunityFeed,
  setOpportunityFeedAccess,
  setOpportunityFeedLoading,
  setOpportunityFeedError,
  setDestinationClusters,
  setDestinationClustersLoading,
  setDestinationClustersError,
  setOpportunityPipelineStatus,
  setOpportunityPipelineStatusLoading,
  setOpportunityPipelineStatusError
}) {
  async function loadOpportunityFeed(forceRefresh = false) {
    setOpportunityFeedLoading(true);
    setOpportunityFeedError('');
    try {
      const payload = await api.opportunityFeed(
        token,
        { limit: 24, cluster: selectedOpportunityCluster || undefined },
        { forceRefresh }
      );
      setOpportunityFeed(payload.items || []);
      setOpportunityFeedAccess(payload.access || null);
    } catch (error) {
      setOpportunityFeed([]);
      setOpportunityFeedAccess(null);
      setOpportunityFeedError(resolveApiError(error));
    } finally {
      setOpportunityFeedLoading(false);
    }
  }

  async function loadOpportunityClusters(forceRefresh = false) {
    setDestinationClustersLoading(true);
    setDestinationClustersError('');
    try {
      const payload = await api.opportunityClusters(token, { limit: 12 }, { forceRefresh });
      setDestinationClusters(Array.isArray(payload?.items) ? payload.items : []);
    } catch (error) {
      setDestinationClusters([]);
      setDestinationClustersError(resolveApiError(error));
    } finally {
      setDestinationClustersLoading(false);
    }
  }

  async function loadOpportunityPipelineStatus() {
    if (!isAuthenticated || !isAdminUser) {
      setOpportunityPipelineStatus(null);
      setOpportunityPipelineStatusError('');
      return;
    }

    setOpportunityPipelineStatusLoading(true);
    setOpportunityPipelineStatusError('');
    try {
      const payload = await api.opportunityDebug(token);
      if (payload?.opportunityPipeline) {
        setOpportunityPipelineStatus(payload);
      } else {
        const fallback = await api.opportunityPipelineStatus(token);
        setOpportunityPipelineStatus({ opportunityPipeline: fallback?.status || null });
      }
    } catch (error) {
      try {
        const fallback = await api.opportunityPipelineStatus(token);
        setOpportunityPipelineStatus({ opportunityPipeline: fallback?.status || null });
      } catch {
        setOpportunityPipelineStatus(null);
      }
      setOpportunityPipelineStatusError(resolveApiError(error));
    } finally {
      setOpportunityPipelineStatusLoading(false);
    }
  }

  async function openOpportunityDebugView() {
    const payload = await resolveOpportunityDebugPayload({
      opportunityPipelineStatus,
      api,
      token,
      setOpportunityPipelineStatusError,
      resolveApiError
    });
    if (!payload) return;
    openJsonPayloadInNewTab(payload);
  }

  async function exportOpportunityDebugSnapshot() {
    const payload = await resolveOpportunityDebugPayload({
      opportunityPipelineStatus,
      api,
      token,
      setOpportunityPipelineStatusError,
      resolveApiError
    });
    if (!payload) return;
    const filename = `opportunity-debug-${format(new Date(), 'yyyy-MM-dd-HHmm')}.json`;
    downloadTextFile(JSON.stringify(payload, null, 2), filename, { mimeType: 'application/json;charset=utf-8' });
  }

  async function refreshOpportunityFeedNow() {
    if (isAuthenticated && token && token !== COOKIE_SESSION_TOKEN) {
      try {
        await api.opportunityPipelineRun(token);
      } catch {
        // Keep UI responsive even if the pipeline trigger is unavailable.
      }
    }

    await Promise.all([
      loadOpportunityFeed(true),
      loadOpportunityClusters(true),
      isAuthenticated && isAdminUser ? loadOpportunityPipelineStatus() : Promise.resolve()
    ]);
  }

  return {
    loadOpportunityFeed,
    loadOpportunityClusters,
    loadOpportunityPipelineStatus,
    openOpportunityDebugView,
    exportOpportunityDebugSnapshot,
    refreshOpportunityFeedNow
  };
}
