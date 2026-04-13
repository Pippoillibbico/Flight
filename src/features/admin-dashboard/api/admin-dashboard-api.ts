import type { AdminBackofficeReport, AdminDashboardApi, AdminTelemetryEventPayload } from '../types/index.ts';

interface HttpApiClient {
  adminBackofficeReport?: (token?: string) => Promise<AdminBackofficeReport>;
  adminTelemetry?: (token: string | undefined, payload: AdminTelemetryEventPayload) => Promise<unknown>;
}

export function createAdminDashboardApi(apiClient: HttpApiClient): AdminDashboardApi {
  return {
    async loadReport(token?: string): Promise<AdminBackofficeReport> {
      if (typeof apiClient?.adminBackofficeReport !== 'function') {
        throw new Error('admin_backoffice_api_missing');
      }
      return apiClient.adminBackofficeReport(token);
    },
    async trackTelemetryEvent(token: string | undefined, event: AdminTelemetryEventPayload): Promise<void> {
      if (typeof apiClient?.adminTelemetry !== 'function') return;
      await apiClient.adminTelemetry(token, event);
    }
  };
}
