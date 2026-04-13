import { z } from 'zod';
import { validateProps } from '../../../utils/validateProps';
import { buildAdminFunnelView } from '../domain/build-admin-funnel-view.ts';

const TopItemSchema = z.object({
  key: z.string(),
  label: z.string(),
  count: z.number()
});

const ReportSchema = z.object({
  generatedAt: z.string(),
  windowDays: z.number(),
  overview: z.object({
    totalUsers: z.number(),
    loginSessions: z.number(),
    activeUsers24h: z.number(),
    activeUsers7d: z.number(),
    trackedRouteActions: z.number(),
    trackedRoutesTotal: z.number(),
    itineraryOpens: z.number(),
    bookingClicks: z.number(),
    upgradeClicks: z.number()
  }),
  funnel: z.object({
    steps: z.array(
      z.object({
        key: z.string(),
        label: z.string(),
        count: z.number(),
        conversionPct: z.number(),
        dropOffPct: z.number()
      })
    )
  }),
  behavior: z.object({
    topTrackedRoutes: z.array(TopItemSchema),
    topViewedItineraries: z.array(TopItemSchema),
    topBookingRoutes: z.array(TopItemSchema),
    topUpgradeSurfaces: z.array(TopItemSchema)
  }),
  monetization: z.object({
    upgradeClicked: z.number(),
    planDistribution: z.array(TopItemSchema),
    proInterestCount: z.number(),
    eliteInterestCount: z.number(),
    triggerSurfaces: z.array(TopItemSchema)
  }),
  operations: z.object({
    authFailures24h: z.number(),
    outboundRedirectFailures24h: z.number(),
    rateLimitEvents24h: z.number(),
    recentErrors: z.array(
      z.object({
        id: z.string(),
        at: z.string(),
        scope: z.string(),
        message: z.string()
      })
    )
  }),
  recentActivity: z.array(
    z.object({
      id: z.string(),
      at: z.string(),
      type: z.string(),
      label: z.string(),
      meta: z.string().optional()
    })
  )
});

const AdminBackofficeSectionPropsSchema = z
  .object({
    isAuthorized: z.boolean(),
    loading: z.boolean(),
    error: z.string().optional().default(''),
    report: ReportSchema.nullable().optional().default(null),
    onRefresh: z.function().optional(),
    onBackToApp: z.function().optional()
  })
  .passthrough();

const ACTIVITY_ICONS = {
  route_tracked: '📍',
  itinerary_opened: '✈️',
  booking_clicked: '🛒',
  upgrade_opened: '⬆️',
  upgrade_confirmed: '🎉',
  radar_activated: '📡'
};

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}

function formatRelativeTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60000) return 'just now';
  if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ago`;
  if (diffMs < 86400000) return `${Math.floor(diffMs / 3600000)}h ago`;
  return `${Math.floor(diffMs / 86400000)}d ago`;
}

function healthBadge(count, warnAt = 1, badAt = 5) {
  if (count === 0) return { text: 'OK', cls: 'admin-badge-ok' };
  if (count < badAt) return { text: `${count} warn`, cls: 'admin-badge-warn' };
  return { text: `${count} issues`, cls: 'admin-badge-bad' };
}

function deriveWhyNoPurchase(funnelView, monetization) {
  const steps = funnelView.steps;
  const insights = [];

  if (steps.length < 4 || steps[0].count === 0) {
    return [{ icon: '📊', severity: 'ok', text: 'Not enough data yet. As users interact with the app, insights will appear here automatically.' }];
  }

  const [, track, itinerary, booking] = steps;

  if (track.dropOffPct > 60) {
    insights.push({
      icon: '🔍',
      severity: 'high',
      text: `${track.dropOffPct}% of logged-in users never track a route. They may not understand what to do after login. Consider a welcome flow or a clear "Track your first flight" CTA on the dashboard.`
    });
  } else if (track.dropOffPct > 35) {
    insights.push({
      icon: '🔍',
      severity: 'medium',
      text: `${track.dropOffPct}% drop between login and route tracking. A short onboarding email or in-app tip could nudge these users to engage.`
    });
  }

  if (itinerary.dropOffPct > 60) {
    insights.push({
      icon: '✈️',
      severity: 'high',
      text: `${itinerary.dropOffPct}% of users who track routes never open an itinerary. The deal cards may not feel relevant or radar notification timing needs tuning.`
    });
  } else if (itinerary.dropOffPct > 35) {
    insights.push({
      icon: '✈️',
      severity: 'medium',
      text: `${itinerary.dropOffPct}% of trackers don't open itineraries. Try surfacing more personalised or time-sensitive deals.`
    });
  }

  if (booking.dropOffPct > 70) {
    insights.push({
      icon: '💳',
      severity: 'high',
      text: `${booking.dropOffPct}% of users who view itineraries don't click to book. They may hit the paywall, distrust the price, or be comparison shopping. Check whether free-tier users can complete a booking.`
    });
  } else if (booking.dropOffPct > 40) {
    insights.push({
      icon: '💳',
      severity: 'medium',
      text: `${booking.dropOffPct}% view-to-book drop-off. Adding trust signals (price guarantee badge, last-booked timestamp) near the CTA could improve conversion.`
    });
  }

  if (monetization.upgradeClicked === 0) {
    insights.push({
      icon: '💰',
      severity: 'high',
      text: 'Zero upgrade interactions. Users are not hitting paywall triggers or upgrade prompts are not visible. Verify that SectionAccessGate is active on premium features.'
    });
  } else if (monetization.proInterestCount === 0 && monetization.eliteInterestCount === 0 && monetization.upgradeClicked > 0) {
    insights.push({
      icon: '💰',
      severity: 'medium',
      text: 'Upgrade modal opens but no plan is selected. The pricing page may not convert — consider simplifying the comparison table or adding a "Most popular" badge.'
    });
  }

  if (insights.length === 0) {
    insights.push({ icon: '✅', severity: 'ok', text: 'Funnel looks healthy across all steps. Keep monitoring as user volume grows.' });
  }

  return insights;
}

function SectionCard({ title, subtitle, icon, children, testId, insight }) {
  return (
    <section className="admin-section-card" data-testid={testId}>
      <div className="admin-section-header">
        <span className="admin-section-icon">{icon}</span>
        <div>
          <h3 className="admin-section-title">{title}</h3>
          {subtitle ? <p className="admin-section-subtitle">{subtitle}</p> : null}
        </div>
      </div>
      <div className="admin-section-body">{children}</div>
      {insight ? (
        <div className="admin-section-insight">
          <span className="admin-insight-bulb">💡</span>
          {insight}
        </div>
      ) : null}
    </section>
  );
}

function BarList({ items, testId, emptyLabel = 'No data yet', barColor }) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return <p className="muted" style={{ padding: '8px 0' }}>{emptyLabel}</p>;
  const max = Math.max(1, list[0].count);
  return (
    <ol className="admin-bar-list" data-testid={testId}>
      {list.map((item) => (
        <li key={item.key} className="admin-bar-item">
          <div className="admin-bar-item-header">
            <span className="admin-bar-item-label">{item.label}</span>
            <strong className="admin-bar-item-count">{item.count}</strong>
          </div>
          <div className="admin-bar-track">
            <div
              className="admin-bar-fill"
              style={{
                width: `${Math.max(4, Math.round((item.count / max) * 100))}%`,
                background: barColor || undefined
              }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}

function FunnelVisual({ funnelView }) {
  const { steps } = funnelView;
  if (steps.length === 0) return <p className="muted">No funnel data yet.</p>;
  const maxCount = Math.max(1, steps[0].count);

  return (
    <div className="admin-funnel-v2">
      {steps.map((step, idx) => {
        const widthPct = Math.max(12, Math.round((step.count / maxCount) * 100));
        const isFirst = idx === 0;
        const dropSeverity = step.dropOffPct > 60 ? 'bad' : step.dropOffPct > 35 ? 'warn' : 'ok';
        return (
          <div key={step.key} className="admin-funnel-v2-step" data-testid={`admin-funnel-step-${step.key}`}>
            {!isFirst && (
              <div className="admin-funnel-connector">
                <span className={`admin-funnel-drop admin-funnel-drop-${dropSeverity}`}>
                  ↓ {step.dropOffPct}% drop
                </span>
              </div>
            )}
            <div className="admin-funnel-bar-wrapper">
              <div className="admin-funnel-bar-block" style={{ width: `${widthPct}%` }}>
                <span className="admin-funnel-bar-label">{step.label}</span>
              </div>
              <span className="admin-funnel-bar-count">{step.count}</span>
              {!isFirst && (
                <span className="admin-funnel-conv-pct">{step.conversionPct}% conv.</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AdminBackofficeSection(props) {
  const { isAuthorized, loading, error, report, onRefresh, onBackToApp } = validateProps(
    AdminBackofficeSectionPropsSchema,
    props,
    'AdminBackofficeSection'
  );

  if (!isAuthorized) {
    return (
      <section className="panel admin-backoffice-panel admin-backoffice-denied" data-testid="admin-access-denied">
        <div className="panel-head">
          <h2>Backoffice access restricted</h2>
        </div>
        <p className="muted">This area is reserved for the app owner/admin only.</p>
        <div className="item-actions">
          <button type="button" className="ghost" onClick={() => onBackToApp?.()}>
            Return to app
          </button>
        </div>
      </section>
    );
  }

  const funnelView = buildAdminFunnelView(report || null);
  const whyNoPurchase = report ? deriveWhyNoPurchase(funnelView, report.monetization) : [];
  const authBadge = report ? healthBadge(report.operations.authFailures24h, 3, 10) : null;
  const outboundBadge = report ? healthBadge(report.operations.outboundRedirectFailures24h, 1, 5) : null;
  const rateBadge = report ? healthBadge(report.operations.rateLimitEvents24h, 1, 5) : null;
  const planMax = report ? Math.max(1, ...report.monetization.planDistribution.map((p) => p.count)) : 1;

  return (
    <section className="admin-dashboard" data-testid="admin-dashboard-panel">
      {/* ── Header ── */}
      <div className="admin-dashboard-header">
        <div className="admin-dashboard-header-left">
          <div className="admin-dashboard-title-row">
            <span className="admin-dashboard-logo">🎛</span>
            <div>
              <h2 className="admin-dashboard-title">Admin Backoffice</h2>
              <p className="admin-dashboard-subtitle">
                Private control room
                {report
                  ? ` · Updated ${formatRelativeTime(report.generatedAt)} · ${report.windowDays}-day window`
                  : ' · No data loaded'}
              </p>
            </div>
          </div>
          {report && (
            <div className="admin-status-bar">
              <span className="admin-status-label">System health:</span>
              <span className={`admin-badge ${authBadge.cls}`}>Auth {authBadge.text}</span>
              <span className={`admin-badge ${outboundBadge.cls}`}>Outbound {outboundBadge.text}</span>
              <span className={`admin-badge ${rateBadge.cls}`}>Rate limits {rateBadge.text}</span>
            </div>
          )}
        </div>
        <div className="admin-dashboard-actions">
          <button type="button" className="ghost" onClick={() => onBackToApp?.()} data-testid="admin-backoffice-close">
            ← Back to app
          </button>
          <button type="button" onClick={() => onRefresh?.()} disabled={loading} data-testid="admin-backoffice-refresh">
            {loading ? '⟳ Refreshing…' : '⟳ Refresh'}
          </button>
        </div>
      </div>

      {error ? <p className="error" style={{ padding: '8px 12px' }}>{error}</p> : null}

      {!report && !loading ? (
        <div className="admin-empty-state">
          <p className="admin-empty-icon">📊</p>
          <p className="admin-empty-text">No dashboard data yet. Click Refresh to load.</p>
        </div>
      ) : null}

      {report ? (
        <>
          {/* ── KPI Strip ── */}
          <div className="admin-kpi-grid" data-testid="admin-kpi-strip">
            {[
              { icon: '👥', value: report.overview.totalUsers, label: 'Total users', sub: `${report.overview.activeUsers24h} active today` },
              { icon: '📅', value: report.overview.activeUsers7d, label: 'Active (7d)', sub: `${report.overview.loginSessions} login sessions` },
              { icon: '📍', value: report.overview.trackedRouteActions, label: 'Route trackings', sub: `${report.overview.trackedRoutesTotal} total routes` },
              { icon: '✈️', value: report.overview.itineraryOpens, label: 'Itinerary opens', sub: 'Interest shown' },
              { icon: '🛒', value: report.overview.bookingClicks, label: 'Booking clicks', sub: 'Revenue intent' },
              { icon: '⬆️', value: report.overview.upgradeClicks, label: 'Upgrade clicks', sub: 'Monetization signal' }
            ].map(({ icon, value, label, sub }) => (
              <article key={label} className="admin-kpi-v2">
                <div className="admin-kpi-v2-top">
                  <span className="admin-kpi-v2-icon">{icon}</span>
                  <p className="admin-kpi-v2-value">{value}</p>
                </div>
                <p className="admin-kpi-v2-label">{label}</p>
                <p className="admin-kpi-v2-sub">{sub}</p>
              </article>
            ))}
          </div>

          {/* ── Funnel + Why No Purchase ── */}
          <div className="admin-two-col">
            <SectionCard
              icon="🎯"
              title="Conversion funnel"
              subtitle={`${report.windowDays}-day window · ${funnelView.steps[0]?.count ?? 0} users entered`}
              testId="admin-funnel-section"
              insight={
                funnelView.strongestDropOff
                  ? `Biggest drop-off at "${funnelView.strongestDropOff.label}" with ${funnelView.strongestDropOff.dropOffPct}% falling out. Prioritise optimising this step first.`
                  : 'No significant drop-off detected.'
              }
            >
              <FunnelVisual funnelView={funnelView} />
            </SectionCard>

            <SectionCard
              icon="🔎"
              title="Why aren't users purchasing?"
              subtitle="Automatic diagnosis based on your funnel data"
              testId="admin-why-no-purchase"
            >
              <ul className="admin-insight-list">
                {whyNoPurchase.map((item, idx) => (
                  <li key={idx} className={`admin-insight-item admin-insight-${item.severity || 'ok'}`}>
                    <span className="admin-insight-icon">{item.icon}</span>
                    <span className="admin-insight-text">{item.text}</span>
                  </li>
                ))}
              </ul>
            </SectionCard>
          </div>

          {/* ── Behaviour ── */}
          <div className="admin-two-col" data-testid="admin-behavior-section">
            <SectionCard
              icon="📍"
              title="Top tracked routes"
              subtitle="Most-watched flight corridors"
              insight="High tracking shows demand. If bookings are low on these routes, pricing or availability may be the blocker."
            >
              <BarList
                items={report.behavior.topTrackedRoutes}
                testId="admin-top-tracked-routes"
                barColor="linear-gradient(90deg,#3b82f6,#60a5fa)"
              />
            </SectionCard>

            <SectionCard
              icon="✈️"
              title="Top viewed itineraries"
              subtitle="Deals users open most"
              insight="These itineraries generate intent. Verify booking links are working and prices are competitive."
            >
              <BarList
                items={report.behavior.topViewedItineraries}
                testId="admin-top-viewed-itineraries"
                barColor="linear-gradient(90deg,#8b5cf6,#a78bfa)"
              />
            </SectionCard>

            <SectionCard
              icon="🛒"
              title="Top booked routes"
              subtitle="Where users actually click to book"
              insight="Cross-reference with tracked routes. A popular tracked route with low bookings suggests a deal quality or paywall issue."
            >
              <BarList
                items={report.behavior.topBookingRoutes}
                testId="admin-top-booking-routes"
                barColor="linear-gradient(90deg,#10b981,#34d399)"
              />
            </SectionCard>

            <SectionCard
              icon="🔔"
              title="Top upgrade surfaces"
              subtitle="Where upgrade intent is triggered"
              insight="These are your best-converting paywall touchpoints. Keep the message clear and the CTA prominent."
            >
              <BarList
                items={report.behavior.topUpgradeSurfaces}
                testId="admin-top-upgrade-surfaces"
                barColor="linear-gradient(90deg,#f59e0b,#fbbf24)"
              />
            </SectionCard>
          </div>

          {/* ── Monetization ── */}
          <div className="admin-two-col" data-testid="admin-monetization-section">
            <SectionCard
              icon="💰"
              title="Plan distribution"
              subtitle="Who is on which plan right now"
              insight={
                report.monetization.planDistribution.find((p) => p.key === 'free')?.count > 0
                  ? 'Most users are on free. Each free user is a conversion opportunity — consider in-app upgrade nudges at high-intent moments.'
                  : 'Review plan distribution to identify conversion opportunities.'
              }
            >
              <ol className="admin-bar-list">
                {report.monetization.planDistribution.map((item) => (
                  <li key={item.key} className="admin-bar-item">
                    <div className="admin-bar-item-header">
                      <span className="admin-bar-item-label">
                        <span className={`admin-plan-badge admin-plan-${item.key.toLowerCase()}`}>{item.label}</span>
                      </span>
                      <strong className="admin-bar-item-count">{item.count} users</strong>
                    </div>
                    <div className="admin-bar-track">
                      <div
                        className="admin-bar-fill"
                        style={{
                          width: `${Math.max(4, Math.round((item.count / planMax) * 100))}%`,
                          background:
                            item.key === 'free'
                              ? '#94a3b8'
                              : item.key === 'pro'
                              ? 'linear-gradient(90deg,#3b82f6,#60a5fa)'
                              : 'linear-gradient(90deg,#f59e0b,#fbbf24)'
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ol>
            </SectionCard>

            <SectionCard
              icon="⬆️"
              title="Monetization signals"
              subtitle="Upgrade intent and plan conversion"
              insight={
                report.monetization.upgradeClicked > 0 &&
                report.monetization.proInterestCount + report.monetization.eliteInterestCount === 0
                  ? 'Upgrade modals open but no plan is selected. Review the pricing page UX and CTA copy.'
                  : report.monetization.upgradeClicked === 0
                  ? 'No upgrade clicks yet. Check that premium features are gated and upgrade prompts are visible.'
                  : 'Upgrade clicks recorded. Monitor the PRO/ELITE split to adjust pricing messaging.'
              }
            >
              <div className="admin-mono-stats">
                <div className="admin-mono-stat">
                  <span className="admin-mono-stat-value">{report.monetization.upgradeClicked}</span>
                  <span className="admin-mono-stat-label">Total upgrade clicks</span>
                </div>
                <div className="admin-mono-stat">
                  <span className="admin-mono-stat-value admin-mono-stat-pro">{report.monetization.proInterestCount}</span>
                  <span className="admin-mono-stat-label">PRO interest</span>
                </div>
                <div className="admin-mono-stat">
                  <span className="admin-mono-stat-value admin-mono-stat-elite">{report.monetization.eliteInterestCount}</span>
                  <span className="admin-mono-stat-label">ELITE interest</span>
                </div>
              </div>
              <div style={{ marginTop: 16 }}>
                <p className="admin-section-subtitle" style={{ marginBottom: 6 }}>Upgrade trigger surfaces</p>
                <BarList
                  items={report.monetization.triggerSurfaces}
                  testId="admin-upgrade-trigger-sources"
                  barColor="linear-gradient(90deg,#f59e0b,#fbbf24)"
                />
              </div>
            </SectionCard>
          </div>

          {/* ── Operations ── */}
          <SectionCard
            icon="⚙️"
            title="System operations"
            subtitle="Last 24 hours — errors, failures, rate limiting"
            testId="admin-operations-section"
            insight={
              report.operations.authFailures24h === 0 &&
              report.operations.outboundRedirectFailures24h === 0 &&
              report.operations.rateLimitEvents24h === 0
                ? 'All operational signals are clean in the last 24 hours.'
                : 'Auth failures may indicate brute-force attempts or broken OAuth flows. Outbound failures may affect affiliate revenue.'
            }
          >
            <div className="admin-ops-grid">
              <div className="admin-ops-stat">
                <span
                  className={`admin-ops-value ${
                    report.operations.authFailures24h > 5
                      ? 'admin-ops-bad'
                      : report.operations.authFailures24h > 0
                      ? 'admin-ops-warn'
                      : 'admin-ops-ok'
                  }`}
                >
                  {report.operations.authFailures24h}
                </span>
                <span className="admin-ops-label">Auth failures</span>
              </div>
              <div className="admin-ops-stat">
                <span
                  className={`admin-ops-value ${
                    report.operations.outboundRedirectFailures24h > 3
                      ? 'admin-ops-bad'
                      : report.operations.outboundRedirectFailures24h > 0
                      ? 'admin-ops-warn'
                      : 'admin-ops-ok'
                  }`}
                >
                  {report.operations.outboundRedirectFailures24h}
                </span>
                <span className="admin-ops-label">Outbound failures</span>
              </div>
              <div className="admin-ops-stat">
                <span
                  className={`admin-ops-value ${
                    report.operations.rateLimitEvents24h > 3
                      ? 'admin-ops-bad'
                      : report.operations.rateLimitEvents24h > 0
                      ? 'admin-ops-warn'
                      : 'admin-ops-ok'
                  }`}
                >
                  {report.operations.rateLimitEvents24h}
                </span>
                <span className="admin-ops-label">Rate limit events</span>
              </div>
            </div>
            {report.operations.recentErrors.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <p className="admin-section-subtitle" style={{ marginBottom: 8 }}>Recent errors</p>
                <ul className="admin-timeline">
                  {report.operations.recentErrors.map((item) => (
                    <li key={item.id} className="admin-timeline-item admin-timeline-error">
                      <span className="admin-timeline-dot" />
                      <div className="admin-timeline-body">
                        <span className="admin-timeline-scope">[{item.scope}]</span> {item.message}
                        <span className="admin-timeline-time">{formatRelativeTime(item.at)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {report.operations.recentErrors.length === 0 && (
              <p className="muted" style={{ marginTop: 12 }}>No recent errors — system is clean.</p>
            )}
          </SectionCard>

          {/* ── Recent Activity ── */}
          <SectionCard
            icon="📡"
            title="Live activity feed"
            subtitle={`Last update: ${formatDateTime(report.generatedAt)}`}
            testId="admin-recent-activity-section"
          >
            {report.recentActivity.length === 0 ? (
              <p className="muted">No recent activity collected yet. Events will appear here as users interact with the app.</p>
            ) : (
              <ul className="admin-timeline">
                {report.recentActivity.map((item) => (
                  <li key={item.id} className="admin-timeline-item">
                    <span className="admin-timeline-dot" />
                    <div className="admin-timeline-body">
                      <span className="admin-timeline-event-icon">{ACTIVITY_ICONS[item.type] || '·'}</span>
                      <strong>{item.label}</strong>
                      {item.meta ? <span className="admin-timeline-meta">{item.meta}</span> : null}
                      <span className="admin-timeline-time">{formatRelativeTime(item.at)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </>
      ) : null}
    </section>
  );
}

export default AdminBackofficeSection;
