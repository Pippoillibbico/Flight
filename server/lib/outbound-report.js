import { addDays } from 'date-fns';

function csvEscape(value) {
  const raw = String(value ?? '');
  const formulaLike = /^[=+\-@]/.test(raw.trimStart());
  const text = formulaLike ? `'${raw}` : raw;
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function normalizeCorrelationId(value) {
  const normalized = String(value || '').trim();
  return normalized || '';
}

export function buildOutboundReport(db, windowDays = 30) {
  const safeDb = db || {};
  const outboundEventsSource = Array.isArray(safeDb.outboundClicks) ? safeDb.outboundClicks : [];
  const searchesSource = Array.isArray(safeDb.searches) ? safeDb.searches : [];
  const since = addDays(new Date(), -windowDays).getTime();
  const outboundEvents = outboundEventsSource.filter((event) => new Date(event?.at).getTime() >= since);
  const isRedirectSuccess = (eventName) => {
    const normalized = String(eventName || '').trim().toLowerCase();
    return normalized === 'outbound_redirect_succeeded' || normalized === 'booking_resolved_redirect';
  };
  const isRedirectFailure = (eventName) => {
    const normalized = String(eventName || '').trim().toLowerCase();
    return normalized === 'outbound_redirect_failed' || normalized === 'booking_redirect_failed';
  };
  const clicks = outboundEvents.filter((event) => String(event?.eventName || 'booking_clicked') === 'booking_clicked');
  const redirectSuccesses = outboundEvents.filter((event) => isRedirectSuccess(event?.eventName));
  const redirectFailures = outboundEvents.filter((event) => isRedirectFailure(event?.eventName));
  const searches = searchesSource.filter((s) => new Date(s?.at).getTime() >= since);

  const partnerMap = new Map();
  const routeMap = new Map();
  const filterMap = new Map();
  const campaignMap = new Map();
  const sourceMediumMap = new Map();
  const failureReasonMap = new Map();

  for (const click of clicks) {
    partnerMap.set(click.partner, (partnerMap.get(click.partner) || 0) + 1);
    const route = `${click.origin}-${click.destinationIata}`;
    routeMap.set(route, (routeMap.get(route) || 0) + 1);
    const campaign = click.utmCampaign || 'organic';
    campaignMap.set(campaign, (campaignMap.get(campaign) || 0) + 1);
    const sourceMedium = `${click.utmSource || 'direct'} / ${click.utmMedium || 'none'}`;
    sourceMediumMap.set(sourceMedium, (sourceMediumMap.get(sourceMedium) || 0) + 1);
  }

  for (const failure of redirectFailures) {
    const reason = String(failure?.failureReason || 'unknown_reason');
    failureReasonMap.set(reason, (failureReasonMap.get(reason) || 0) + 1);
  }

  for (const search of searches) {
    const payload = search?.payload || {};
    const key = `${payload.connectionType || 'all'}|${payload.travelTime || 'all'}|stops:${Number.isFinite(payload.maxStops) ? payload.maxStops : 'any'}`;
    filterMap.set(key, (filterMap.get(key) || 0) + 1);
  }

  const byPartner = [...partnerMap.entries()].map(([partner, clicksCount]) => ({ partner, clicks: clicksCount })).sort((a, b) => b.clicks - a.clicks);
  const topRoutes = [...routeMap.entries()].map(([route, clicksCount]) => ({ route, clicks: clicksCount })).sort((a, b) => b.clicks - a.clicks).slice(0, 10);
  const topDecisionPatterns = [...filterMap.entries()]
    .map(([pattern, used]) => ({ pattern, used }))
    .sort((a, b) => b.used - a.used)
    .slice(0, 10);
  const topCampaigns = [...campaignMap.entries()]
    .map(([campaign, clicksCount]) => ({ campaign, clicks: clicksCount }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 10);
  const topSources = [...sourceMediumMap.entries()]
    .map(([sourceMedium, clicksCount]) => ({ sourceMedium, clicks: clicksCount }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 10);
  const redirectFailureReasons = [...failureReasonMap.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  const clickCorrelationIds = new Set(clicks.map((event) => normalizeCorrelationId(event?.correlationId)).filter(Boolean));
  const redirectOutcomes = [...redirectSuccesses, ...redirectFailures];
  const redirectOutcomesWithCorrelation = redirectOutcomes.filter((event) => Boolean(normalizeCorrelationId(event?.correlationId)));
  const correlatedRedirectOutcomes = redirectOutcomesWithCorrelation.filter((event) =>
    clickCorrelationIds.has(normalizeCorrelationId(event?.correlationId))
  );
  const clicksWithCorrelationId = clicks.filter((event) => Boolean(normalizeCorrelationId(event?.correlationId))).length;
  const redirectOutcomesWithCorrelationId = redirectOutcomesWithCorrelation.length;
  const correlatedRedirectOutcomeCount = correlatedRedirectOutcomes.length;
  const redirectCorrelationRatePct = redirectOutcomes.length > 0
    ? Math.round((correlatedRedirectOutcomeCount / redirectOutcomes.length) * 1000) / 10
    : 0;

  return {
    generatedAt: new Date().toISOString(),
    policy: {
      monetizationModel: 'decision_value',
      scrapingUsed: false,
      externalInventoryResale: false,
      note: 'The portal generates value through decision analytics and intelligent filtering, not by reselling partner inventory.'
    },
    summary: {
      windowDays,
      searchCount: searches.length,
      outboundClicks: clicks.length,
      clickThroughRatePct: searches.length > 0 ? Math.round((clicks.length / searches.length) * 1000) / 10 : 0,
      uniqueRoutesClicked: routeMap.size,
      redirectSuccesses: redirectSuccesses.length,
      redirectFailures: redirectFailures.length,
      clicksWithCorrelationId,
      redirectOutcomesWithCorrelationId,
      correlatedRedirectOutcomes: correlatedRedirectOutcomeCount,
      redirectCorrelationRatePct
    },
    byPartner,
    topRoutes,
    topDecisionPatterns,
    topCampaigns,
    topSources,
    redirectFailureReasons
  };
}

export function outboundReportToCsv(report) {
  const lines = [];
  lines.push(['section', 'key', 'value'].join(','));
  lines.push(['summary', 'generatedAt', csvEscape(report.generatedAt)].join(','));
  lines.push(['summary', 'windowDays', csvEscape(report.summary.windowDays)].join(','));
  lines.push(['summary', 'searchCount', csvEscape(report.summary.searchCount)].join(','));
  lines.push(['summary', 'outboundClicks', csvEscape(report.summary.outboundClicks)].join(','));
  lines.push(['summary', 'clickThroughRatePct', csvEscape(report.summary.clickThroughRatePct)].join(','));
  lines.push(['summary', 'uniqueRoutesClicked', csvEscape(report.summary.uniqueRoutesClicked)].join(','));
  lines.push(['summary', 'redirectSuccesses', csvEscape(report.summary.redirectSuccesses)].join(','));
  lines.push(['summary', 'redirectFailures', csvEscape(report.summary.redirectFailures)].join(','));
  lines.push(['summary', 'clicksWithCorrelationId', csvEscape(report.summary.clicksWithCorrelationId)].join(','));
  lines.push(['summary', 'redirectOutcomesWithCorrelationId', csvEscape(report.summary.redirectOutcomesWithCorrelationId)].join(','));
  lines.push(['summary', 'correlatedRedirectOutcomes', csvEscape(report.summary.correlatedRedirectOutcomes)].join(','));
  lines.push(['summary', 'redirectCorrelationRatePct', csvEscape(report.summary.redirectCorrelationRatePct)].join(','));

  lines.push('');
  lines.push(['partner', 'clicks'].join(','));
  for (const row of report.byPartner || []) {
    lines.push([csvEscape(row.partner), csvEscape(row.clicks)].join(','));
  }

  lines.push('');
  lines.push(['route', 'clicks'].join(','));
  for (const row of report.topRoutes || []) {
    lines.push([csvEscape(row.route), csvEscape(row.clicks)].join(','));
  }

  lines.push('');
  lines.push(['campaign', 'clicks'].join(','));
  for (const row of report.topCampaigns || []) {
    lines.push([csvEscape(row.campaign), csvEscape(row.clicks)].join(','));
  }

  lines.push('');
  lines.push(['source_medium', 'clicks'].join(','));
  for (const row of report.topSources || []) {
    lines.push([csvEscape(row.sourceMedium), csvEscape(row.clicks)].join(','));
  }

  lines.push('');
  lines.push(['decision_pattern', 'used'].join(','));
  for (const row of report.topDecisionPatterns || []) {
    lines.push([csvEscape(row.pattern), csvEscape(row.used)].join(','));
  }

  lines.push('');
  lines.push(['redirect_failure_reason', 'count'].join(','));
  for (const row of report.redirectFailureReasons || []) {
    lines.push([csvEscape(row.reason), csvEscape(row.count)].join(','));
  }

  return lines.join('\n');
}
