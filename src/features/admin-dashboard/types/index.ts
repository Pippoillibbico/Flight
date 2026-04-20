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
  monitoring?: {
    callsPerUser: {
      search: number;
      provider: number;
      ai: number;
    } | null;
    costPerUser: {
      provider: number;
      ai: number;
      total: number;
    } | null;
    budgetUsedPercent: {
      providerDailyCalls: number;
      aiMonthlyTokens: number;
    };
    search429Count: number;
    search429Pct: number;
    usersActiveEstimated: number;
    feedViews: number;
    redirectClicks: number;
    ctrPercent: number;
    providerCostTotalEur: number;
    aiCostTotalEur: number;
    providerBudgetExceededEvents: number;
    aiBudgetExceededEvents: number;
    alerts: Array<{ level: string; code: string; message: string }>;
    suggestions: string[];
  } | null;
}

export interface AdminDashboardApi {
  loadReport: (token?: string) => Promise<AdminBackofficeReport>;
  trackTelemetryEvent: (token: string | undefined, event: AdminTelemetryEventPayload) => Promise<void>;
}

export type AdminTelemetryEventType =
  | 'result_interaction_clicked'
  | 'itinerary_opened'
  | 'booking_clicked'
  | 'live_deal_feed_view'
  | 'live_deal_card_click'
  | 'live_deal_detail_open'
  | 'live_deal_pre_redirect_open'
  | 'live_deal_redirect_confirm'
  | 'live_deal_return_view'
  | 'live_deal_save_route_click'
  | 'live_deal_alert_click'
  | 'upgrade_cta_shown'
  | 'upgrade_cta_clicked'
  | 'elite_cta_clicked'
  | 'upgrade_modal_opened'
  | 'elite_modal_opened'
  | 'upgrade_primary_cta_clicked'
  | 'checkout_started'
  | 'checkout_completed'
  | 'radar_activated'
  | 'trial_banner_shown'
  | 'trial_upgrade_clicked'
  | 'upgrade_prompt_shown'
  | 'upgrade_prompt_dismissed';

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
  dealId?: string;
  sessionId?: string;
  price?: number;
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
