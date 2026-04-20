import { format } from 'date-fns';
import { downloadTextFile } from './browser-export-utils.js';

export function createReportOperations({
  api,
  token,
  isAuthenticated,
  isAdminUser,
  resolveApiError,
  adminDashboardApi,
  setSecurityAudit,
  setSecurityAuditLoading,
  setSecurityAuditError,
  setFeatureAudit,
  setFeatureAuditLoading,
  setFeatureAuditError,
  setOutboundReport,
  setOutboundReportLoading,
  setOutboundReportError,
  setOutboundCsvLoading,
  setMonetizationReport,
  setMonetizationLoading,
  setMonetizationError,
  setBillingPricing,
  setBillingPricingLoading,
  setBillingPricingError,
  setFunnelReport,
  setFunnelLoading,
  setFunnelError,
  setAdminDashboardReport,
  setAdminDashboardLoading,
  setAdminDashboardError
}) {
  async function runSecurityAuditCheck() {
    if (!isAuthenticated || !isAdminUser) {
      setSecurityAudit(null);
      setSecurityAuditError('Admin access required.');
      return;
    }
    setSecurityAuditLoading(true);
    setSecurityAuditError('');
    try {
      const payload = await api.healthSecurity();
      setSecurityAudit(payload);
    } catch (error) {
      setSecurityAudit(null);
      setSecurityAuditError(resolveApiError(error));
    } finally {
      setSecurityAuditLoading(false);
    }
  }

  async function runFeatureAuditCheck() {
    setFeatureAuditLoading(true);
    setFeatureAuditError('');
    try {
      const payload = await api.healthFeatures();
      setFeatureAudit(payload);
    } catch (error) {
      setFeatureAudit(null);
      setFeatureAuditError(resolveApiError(error));
    } finally {
      setFeatureAuditLoading(false);
    }
  }

  async function loadOutboundReport() {
    if (!isAuthenticated) return;
    setOutboundReportLoading(true);
    setOutboundReportError('');
    try {
      const payload = await api.outboundReport(token);
      setOutboundReport(payload);
    } catch (error) {
      setOutboundReport(null);
      setOutboundReportError(resolveApiError(error));
    } finally {
      setOutboundReportLoading(false);
    }
  }

  async function exportOutboundReportCsv() {
    if (!isAuthenticated) return;
    setOutboundCsvLoading(true);
    setOutboundReportError('');
    try {
      const csv = await api.outboundReportCsv(token);
      const filename = `outbound-report-${format(new Date(), 'yyyy-MM-dd')}.csv`;
      downloadTextFile(csv, filename, { mimeType: 'text/csv;charset=utf-8' });
    } catch (error) {
      setOutboundReportError(resolveApiError(error));
    } finally {
      setOutboundCsvLoading(false);
    }
  }

  async function loadMonetizationReport() {
    if (!isAuthenticated) return;
    setMonetizationLoading(true);
    setMonetizationError('');
    try {
      const payload = await api.monetizationReport(token);
      setMonetizationReport(payload);
    } catch (error) {
      setMonetizationReport(null);
      setMonetizationError(resolveApiError(error));
    } finally {
      setMonetizationLoading(false);
    }
  }

  async function loadBillingPricing(silent = false, forceRefresh = false) {
    if (!silent) setBillingPricingLoading(true);
    setBillingPricingError('');
    try {
      const payload = await api.billingPricing({ forceRefresh });
      const pricing = payload?.pricing || {};
      setBillingPricing({
        free: { monthlyEur: Number(pricing?.free?.monthlyEur || 0) },
        pro: { monthlyEur: Number(pricing?.pro?.monthlyEur || 7) },
        creator: { monthlyEur: Number(pricing?.creator?.monthlyEur || 19) },
        updatedAt: pricing?.updatedAt || null,
        lastCostCheckAt: pricing?.lastCostCheckAt || null
      });
    } catch (error) {
      if (!silent) setBillingPricingError(resolveApiError(error));
    } finally {
      if (!silent) setBillingPricingLoading(false);
    }
  }

  async function loadFunnelReport() {
    if (!isAuthenticated) return;
    setFunnelLoading(true);
    setFunnelError('');
    try {
      const payload = await api.funnelAnalytics(token);
      setFunnelReport(payload);
    } catch (error) {
      setFunnelReport(null);
      setFunnelError(resolveApiError(error));
    } finally {
      setFunnelLoading(false);
    }
  }

  async function loadAdminBackofficeReport() {
    if (!isAuthenticated || !isAdminUser) {
      setAdminDashboardReport(null);
      setAdminDashboardError('');
      return;
    }
    setAdminDashboardLoading(true);
    setAdminDashboardError('');
    try {
      const payload = await adminDashboardApi.loadReport(token || undefined);
      setAdminDashboardReport(payload);
    } catch (error) {
      setAdminDashboardReport(null);
      setAdminDashboardError(resolveApiError(error));
    } finally {
      setAdminDashboardLoading(false);
    }
  }

  return {
    runSecurityAuditCheck,
    runFeatureAuditCheck,
    loadOutboundReport,
    exportOutboundReportCsv,
    loadMonetizationReport,
    loadBillingPricing,
    loadFunnelReport,
    loadAdminBackofficeReport
  };
}
