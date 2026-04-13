export type AdminPlanType = 'free' | 'pro' | 'elite';

export interface AdminOverviewMetrics {
  totalUsers: number;
  loginSessions: number;
  activeUsers24h: number;
  activeUsers7d: number;
  trackedRouteActions: number;
  trackedRoutesTotal: number;
  itineraryOpens: number;
  bookingClicks: number;
  upgradeClicks: number;
}

export interface AdminFunnelStep {
  key: string;
  label: string;
  count: number;
  conversionPct: number;
  dropOffPct: number;
}

export interface AdminTopItem {
  key: string;
  label: string;
  count: number;
}

export interface AdminRecentError {
  id: string;
  at: string;
  scope: string;
  message: string;
}

export interface AdminRecentActivity {
  id: string;
  at: string;
  type: string;
  label: string;
  meta?: string;
}

export interface AdminBackofficeReport {
  generatedAt: string;
  windowDays: number;
  overview: AdminOverviewMetrics;
  funnel: {
    steps: AdminFunnelStep[];
  };
  behavior: {
    topTrackedRoutes: AdminTopItem[];
    topViewedItineraries: AdminTopItem[];
    topBookingRoutes: AdminTopItem[];
    topUpgradeSurfaces: AdminTopItem[];
  };
  monetization: {
    upgradeClicked: number;
    planDistribution: AdminTopItem[];
    proInterestCount: number;
    eliteInterestCount: number;
    triggerSurfaces: AdminTopItem[];
  };
  operations: {
    authFailures24h: number;
    outboundRedirectFailures24h: number;
    rateLimitEvents24h: number;
    recentErrors: AdminRecentError[];
  };
  recentActivity: AdminRecentActivity[];
}

export interface AdminDashboardApi {
  loadReport: (token?: string) => Promise<AdminBackofficeReport>;
  trackTelemetryEvent: (token: string | undefined, event: AdminTelemetryEventPayload) => Promise<void>;
}

export type AdminTelemetryEventType =
  | 'result_interaction_clicked'
  | 'itinerary_opened'
  | 'booking_clicked'
  | 'upgrade_cta_clicked'
  | 'elite_cta_clicked'
  | 'upgrade_modal_opened'
  | 'elite_modal_opened'
  | 'upgrade_primary_cta_clicked'
  | 'radar_activated';

export interface AdminTelemetryEventPayload {
  eventType: AdminTelemetryEventType;
  at?: string;
  eventId?: string;
  eventVersion?: number;
  schemaVersion?: number;
  sourceContext?: 'web_app' | 'admin_backoffice' | 'api_client';
  action?: string;
  surface?: string;
  itineraryId?: string;
  correlationId?: string;
  source?: string;
  routeSlug?: string;
  planType?: AdminPlanType;
}

export interface AdminAccessContext {
  userEmail?: unknown;
  allowlistCsv?: string | null;
}

export interface AdminAccessResult {
  isAdmin: boolean;
  normalizedEmail: string;
  allowlist: string[];
}
