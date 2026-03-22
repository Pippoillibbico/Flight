import { addDays } from 'date-fns';

function csvEscape(value) {
  const text = String(value ?? '');
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function buildOutboundReport(db, windowDays = 30) {
  const safeDb = db || {};
  const clicksSource = Array.isArray(safeDb.outboundClicks) ? safeDb.outboundClicks : [];
  const searchesSource = Array.isArray(safeDb.searches) ? safeDb.searches : [];
  const since = addDays(new Date(), -windowDays).getTime();
  const clicks = clicksSource.filter((c) => new Date(c?.at).getTime() >= since);
  const searches = searchesSource.filter((s) => new Date(s?.at).getTime() >= since);

  const partnerMap = new Map();
  const routeMap = new Map();
  const filterMap = new Map();
  const campaignMap = new Map();
  const sourceMediumMap = new Map();

  for (const click of clicks) {
    partnerMap.set(click.partner, (partnerMap.get(click.partner) || 0) + 1);
    const route = `${click.origin}-${click.destinationIata}`;
    routeMap.set(route, (routeMap.get(route) || 0) + 1);
    const campaign = click.utmCampaign || 'organic';
    campaignMap.set(campaign, (campaignMap.get(campaign) || 0) + 1);
    const sourceMedium = `${click.utmSource || 'direct'} / ${click.utmMedium || 'none'}`;
    sourceMediumMap.set(sourceMedium, (sourceMediumMap.get(sourceMedium) || 0) + 1);
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
      uniqueRoutesClicked: routeMap.size
    },
    byPartner,
    topRoutes,
    topDecisionPatterns,
    topCampaigns,
    topSources
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

  return lines.join('\n');
}
