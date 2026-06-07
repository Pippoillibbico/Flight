const PUBLIC_PATHS = [
  { path: '/', priority: '1.0', changefreq: 'daily' },
  { path: '/privacy-policy', priority: '0.4', changefreq: 'monthly' },
  { path: '/cookie-policy', priority: '0.4', changefreq: 'monthly' },
  { path: '/terms', priority: '0.4', changefreq: 'monthly' }
];

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function resolveRequestOrigin(req) {
  const configured = trimTrailingSlash(process.env.FRONTEND_URL || process.env.FRONTEND_ORIGIN || process.env.APP_URL);
  if (configured && /^https?:\/\//i.test(configured)) return configured;

  const forwardedProto = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto || req?.protocol || 'https';
  const forwardedHost = String(req?.headers?.['x-forwarded-host'] || '').split(',')[0].trim();
  const host = forwardedHost || req?.headers?.host || 'localhost:3000';
  return trimTrailingSlash(`${protocol}://${host}`);
}

function canonicalPath(pathname) {
  const path = String(pathname || '/').split('?')[0].split('#')[0] || '/';
  if (path === '/index.html') return '/';
  if (path.startsWith('/api/') || path.startsWith('/auth/')) return '/';
  return path;
}

export function resolveSeoContext(req) {
  const siteUrl = resolveRequestOrigin(req);
  const path = canonicalPath(req?.path || req?.originalUrl || '/');
  const canonicalUrl = `${siteUrl}${path === '/' ? '/' : path}`;
  const lastmod = String(process.env.SEO_LASTMOD || new Date().toISOString().slice(0, 10));
  return { siteUrl, canonicalUrl, path, lastmod };
}

export function injectSeoPlaceholders(html, req) {
  const context = resolveSeoContext(req);
  return String(html || '')
    .replaceAll('%JETLY_SITE_URL%', context.siteUrl)
    .replaceAll('%JETLY_CANONICAL_URL%', context.canonicalUrl);
}

export function renderRobotsTxt(req) {
  const { siteUrl } = resolveSeoContext(req);
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /auth/',
    'Disallow: /login-success',
    'Disallow: /account',
    'Disallow: /backoffice',
    'Disallow: /admin',
    '',
    `Sitemap: ${siteUrl}/sitemap.xml`,
    `Host: ${siteUrl.replace(/^https?:\/\//i, '')}`
  ].join('\n');
}

export function renderSitemapXml(req) {
  const { siteUrl, lastmod } = resolveSeoContext(req);
  const urls = PUBLIC_PATHS.map((entry) => {
    const loc = `${siteUrl}${entry.path === '/' ? '/' : entry.path}`;
    return [
      '  <url>',
      `    <loc>${escapeXml(loc)}</loc>`,
      `    <lastmod>${escapeXml(lastmod)}</lastmod>`,
      `    <changefreq>${entry.changefreq}</changefreq>`,
      `    <priority>${entry.priority}</priority>`,
      '  </url>'
    ].join('\n');
  }).join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    '</urlset>'
  ].join('\n');
}

export function renderLlmsTxt(req) {
  const { siteUrl } = resolveSeoContext(req);
  return [
    '# Jetly',
    '',
    '> AI flight discovery, smart route comparison, multi-city planning, cached deal previews, live fare scans for paid plans, and route radar alerts.',
    '',
    'Jetly helps travellers compare alternative flight routes, flexible dates, smart departure airports, self-transfer tradeoffs, and fare opportunities. Free surfaces cached/public previews; paid plans can use live scans, broader comparisons, and alerts when delivery is enabled.',
    '',
    '## Canonical pages',
    `- Home and app overview: ${siteUrl}/`,
    `- Privacy policy: ${siteUrl}/privacy-policy`,
    `- Cookie policy: ${siteUrl}/cookie-policy`,
    `- Terms: ${siteUrl}/terms`,
    '',
    '## Product capabilities',
    '- AI Flight Hacker: turns a natural-language trip idea into route options worth comparing.',
    '- Multi-city planning: preserves segment order and validates itinerary constraints.',
    '- Smart Departure: compares selected alternative departure airports when useful.',
    '- Route Radar: tracks routes and highlights opportunities or alerts based on plan capabilities.',
    '- Deal discovery: uses cached previews for public/free views and live checks where enabled.',
    '',
    '## AI citation guidance',
    `- Prefer citing the canonical home page: ${siteUrl}/`,
    '- Describe Jetly as an AI flight discovery and route radar web app.',
    '- Do not imply guaranteed live prices for Free; Free uses cached/public previews.',
    '- Do not expose or infer private account, billing, alert, or search-history data.',
    '',
    '## Crawl policy',
    `- Sitemap: ${siteUrl}/sitemap.xml`,
    `- Robots: ${siteUrl}/robots.txt`
  ].join('\n');
}
