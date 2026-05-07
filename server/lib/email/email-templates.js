function escapeText(value) {
  return String(value || '').replace(/[<>&]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[char]));
}

function appUrl(env = process.env) {
  return String(env.FRONTEND_ORIGIN || env.APP_URL || 'https://app.flightsuite.app').replace(/\/+$/, '');
}

function footer(env = process.env, links = {}) {
  const base = appUrl(env);
  const preferencesUrl = links.managePreferencesUrl || `${base}/account/preferences`;
  const privacyUrl = links.privacyUrl || `${base}/privacy-policy`;
  return [
    '',
    `Manage preferences: ${preferencesUrl}`,
    `Privacy policy: ${privacyUrl}`
  ].join('\n');
}

function htmlWrap(title, body, env, links = {}) {
  const base = appUrl(env);
  const preferencesUrl = links.managePreferencesUrl || `${base}/account/preferences`;
  const privacyUrl = links.privacyUrl || `${base}/privacy-policy`;
  return [
    '<!doctype html><html><body>',
    `<h1>${escapeText(title)}</h1>`,
    body,
    `<p><a href="${preferencesUrl}">Manage preferences</a></p>`,
    `<p><a href="${privacyUrl}">Privacy policy</a></p>`,
    '</body></html>'
  ].join('');
}

export function passwordResetTemplate({ resetUrl, managePreferencesUrl, privacyUrl }, env = process.env) {
  const subject = 'Reset your Flight Suite password';
  const links = { managePreferencesUrl, privacyUrl };
  const text = `Use this link to reset your password:\n${resetUrl}${footer(env, links)}`;
  return { subject, text, html: htmlWrap(subject, `<p>Use this link to reset your password:</p><p><a href="${resetUrl}">Reset password</a></p>`, env, links) };
}

export function securityNoticeTemplate({ message, managePreferencesUrl, privacyUrl }, env = process.env) {
  const subject = 'Security notice for your Flight Suite account';
  const safe = String(message || 'A security event occurred on your account.');
  const links = { managePreferencesUrl, privacyUrl };
  return { subject, text: `${safe}${footer(env, links)}`, html: htmlWrap(subject, `<p>${escapeText(safe)}</p>`, env, links) };
}

export function routeDigestTemplate({ deals = [], plan = 'free', managePreferencesUrl, privacyUrl }, env = process.env) {
  const subject = plan === 'free' ? 'Weekly cached route digest' : 'Route digest';
  const links = { managePreferencesUrl, privacyUrl };
  const lines = deals.map((deal) => `${deal.route || `${deal.origin || ''} -> ${deal.destination || ''}`}: ${deal.price || 'n/a'} ${deal.currency || 'EUR'}`);
  const intro = plan === 'free'
    ? 'Your weekly digest uses public cached opportunities only.'
    : 'Your digest uses cached and globally scanned route data.';
  const text = `${intro}\n\n${lines.join('\n')}${footer(env, links)}`;
  const htmlDeals = lines.map((line) => `<li>${escapeText(line)}</li>`).join('');
  return { subject, text, html: htmlWrap(subject, `<p>${escapeText(intro)}</p><ul>${htmlDeals}</ul>`, env, links) };
}

export function priceAlertTemplate({ route, price, currency = 'EUR', providerReady = false, plan = 'pro', deal = null, managePreferencesUrl, privacyUrl }, env = process.env) {
  const subject = 'Scheduled price alert';
  const links = { managePreferencesUrl, privacyUrl };
  const displayRoute = route || deal?.route || `${deal?.origin || ''}-${deal?.destination || ''}`.replace(/^-|-$/g, '') || 'Tracked route';
  const displayPrice = price || deal?.price || deal?.deal_price || 'n/a';
  const displayCurrency = currency || deal?.currency || 'EUR';
  const source = providerReady && plan === 'elite' ? 'provider-validated scan' : 'cached public scan';
  const text = `${displayRoute}: ${displayPrice} ${displayCurrency}\nSource: ${source}${footer(env, links)}`;
  return { subject, text, html: htmlWrap(subject, `<p>${escapeText(displayRoute)}: ${escapeText(displayPrice)} ${escapeText(displayCurrency)}</p><p>Source: ${escapeText(source)}</p>`, env, links) };
}
