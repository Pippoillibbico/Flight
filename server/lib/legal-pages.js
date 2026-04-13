/**
 * Legal pages renderer.
 *
 * Notes:
 * - Content is generated from runtime values where available.
 * - Unknown legal/company details are left as explicit TODO placeholders.
 * - Keep this file aligned with actual data/storage behavior in src/ and server/.
 */

const APP_NAME = String(process.env.APP_NAME || 'Flight').trim();
const APP_URL = String(process.env.FRONTEND_URL || 'http://localhost:8080').trim();
const EFFECTIVE_DATE = String(process.env.LEGAL_EFFECTIVE_DATE || new Date().toISOString().slice(0, 10)).trim();
const COMPANY = String(process.env.LEGAL_COMPANY_NAME || 'Clariter Group').trim();
const ADDRESS = String(process.env.LEGAL_COMPANY_ADDRESS || 'Via del Corso 101, 00186 Roma, Italia').trim();
const PRIVACY_EMAIL = String(process.env.LEGAL_PRIVACY_EMAIL || 'privacy@flightsuite.app').trim();
const DPO_EMAIL = String(process.env.LEGAL_DPO_EMAIL || 'dpo@flightsuite.app').trim();
const AUTH_EVENT_RETENTION_DAYS = Math.max(7, Math.min(3650, Number(process.env.DATA_RETENTION_AUTH_EVENTS_DAYS || 180)));
const TELEMETRY_RETENTION_DAYS = Math.max(7, Math.min(3650, Number(process.env.DATA_RETENTION_CLIENT_TELEMETRY_DAYS || 120)));
const OUTBOUND_RETENTION_DAYS = Math.max(7, Math.min(3650, Number(process.env.DATA_RETENTION_OUTBOUND_EVENTS_DAYS || 180)));

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function css() {
  return `
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0;
      background: #f3f6fb;
      color: #12233f;
      font: 15px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      padding: 24px 12px 48px;
    }
    .wrap {
      max-width: 900px;
      margin: 0 auto;
      background: #ffffff;
      border: 1px solid #dfe8f5;
      border-radius: 14px;
      padding: 28px;
      box-shadow: 0 8px 28px rgba(13, 35, 72, 0.08);
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 18px;
      text-decoration: none;
      color: #0f6fff;
      font-weight: 800;
    }
    .back {
      display: inline-block;
      margin: 0 0 22px;
      color: #1f4f9d;
      text-decoration: none;
      font-weight: 600;
      font-size: 13px;
    }
    .back:hover { text-decoration: underline; }
    h1 { margin: 0 0 6px; font-size: 28px; color: #0d2142; }
    h2 { margin: 28px 0 8px; font-size: 20px; color: #0f2f60; }
    h3 { margin: 18px 0 6px; font-size: 16px; color: #184582; }
    p { margin: 0 0 12px; }
    ul { margin: 8px 0 14px 20px; }
    li { margin: 4px 0; }
    code {
      background: #eef4ff;
      border: 1px solid #d5e3ff;
      border-radius: 6px;
      padding: 1px 5px;
      font-size: 12px;
    }
    .meta { color: #516b92; font-size: 13px; margin-bottom: 14px; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 12px 0 18px;
      font-size: 14px;
    }
    th, td {
      border: 1px solid #d9e4f6;
      padding: 8px 10px;
      text-align: left;
      vertical-align: top;
    }
    th { background: #edf4ff; color: #183f75; }
    tr:nth-child(even) td { background: #f9fbff; }
    footer {
      margin-top: 34px;
      padding-top: 14px;
      border-top: 1px solid #d9e4f6;
      color: #5a7195;
      font-size: 13px;
    }
    @media (max-width: 680px) {
      .wrap { padding: 18px; }
      h1 { font-size: 24px; }
      h2 { font-size: 18px; }
    }
  `;
}

function page(title, body) {
  const safeTitle = escapeHtml(title);
  const safeAppName = escapeHtml(APP_NAME);
  const safeAppUrl = escapeHtml(APP_URL);
  const safeCompany = escapeHtml(COMPANY);
  const safeAddress = escapeHtml(ADDRESS);
  const safePrivacyEmail = escapeHtml(PRIVACY_EMAIL);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle} - ${safeAppName}</title>
  <style>${css()}</style>
</head>
<body>
  <article class="wrap">
    <a class="brand" href="${safeAppUrl}">${safeAppName}</a>
    <a class="back" href="${safeAppUrl}">Back to app</a>
    ${body}
    <footer>
      <p>${safeAppName} is operated by ${safeCompany}, ${safeAddress}.</p>
      <p>Privacy contact: <a href="mailto:${safePrivacyEmail}">${safePrivacyEmail}</a></p>
      <p>
        <a href="${safeAppUrl}/privacy-policy">Privacy Policy</a> |
        <a href="${safeAppUrl}/cookie-policy">Cookie Policy</a> |
        <a href="${safeAppUrl}/terms">Terms</a>
      </p>
    </footer>
  </article>
</body>
</html>`;
}

export function renderPrivacyPolicy() {
  const safeDate = escapeHtml(EFFECTIVE_DATE);
  const safeAppName = escapeHtml(APP_NAME);
  const safeCompany = escapeHtml(COMPANY);
  const safeAddress = escapeHtml(ADDRESS);
  const safePrivacyEmail = escapeHtml(PRIVACY_EMAIL);
  const safeDpoEmail = escapeHtml(DPO_EMAIL);

  return page(
    'Privacy Policy',
    `
      <h1>Privacy Policy</h1>
      <p class="meta">Last updated: ${safeDate}</p>

      <h2>1. Controller</h2>
      <p>${safeCompany}<br/>${safeAddress}<br/>Privacy: <a href="mailto:${safePrivacyEmail}">${safePrivacyEmail}</a><br/>DPO: <a href="mailto:${safeDpoEmail}">${safeDpoEmail}</a></p>

      <h2>2. Data categories processed</h2>
      <ul>
        <li>Account and authentication data (name, email, hashed password, auth metadata).</li>
        <li>Search and product usage data (queries, selected routes, feature interactions).</li>
        <li>Operational security logs (IP, request metadata, request IDs, abuse/rate-limit events).</li>
        <li>Subscription and billing state (no full card PAN stored in this app backend).</li>
        <li>Optional local browser data only when consented (see Cookie Policy).</li>
      </ul>

      <h2>3. Purposes and legal basis</h2>
      <table>
        <tr><th>Purpose</th><th>Legal basis</th></tr>
        <tr><td>Provide account and core service features</td><td>Contract (GDPR Art. 6(1)(b))</td></tr>
        <tr><td>Security hardening, fraud/abuse prevention</td><td>Legitimate interest (Art. 6(1)(f))</td></tr>
        <tr><td>Optional preference persistence in browser</td><td>Consent (Art. 6(1)(a))</td></tr>
        <tr><td>Analytics/funnel telemetry</td><td>Consent (Art. 6(1)(a))</td></tr>
        <tr><td>Billing/subscription management</td><td>Contract (Art. 6(1)(b)) + legal obligations where applicable</td></tr>
      </table>

      <h2>4. Data recipients</h2>
      <ul>
        <li>Hosting and infrastructure providers (compute, database, cache).</li>
        <li>Payment providers for subscription flows.</li>
        <li>Email delivery provider for transactional notifications.</li>
        <li>Travel/booking partners when user explicitly opens outbound booking links.</li>
      </ul>
      <p>Processors are selected under contractual safeguards (including data processing agreements) and access is limited to operational necessity.</p>

      <h2>5. Retention</h2>
      <p>Retention windows are technically enforced server-side by configurable environment variables.</p>
      <table>
        <tr><th>Dataset</th><th>Current behavior</th><th>Policy status</th></tr>
        <tr><td>Auth/session and security events</td><td>Stored in DB-backed auth events and pruned automatically</td><td>Configured with <code>DATA_RETENTION_AUTH_EVENTS_DAYS</code> (current default: ${AUTH_EVENT_RETENTION_DAYS} days)</td></tr>
        <tr><td>Search/product telemetry and admin funnel events</td><td>Stored in DB-backed telemetry events and pruned automatically</td><td>Configured with <code>DATA_RETENTION_CLIENT_TELEMETRY_DAYS</code> (current default: ${TELEMETRY_RETENTION_DAYS} days)</td></tr>
        <tr><td>Outbound click/redirect operational events</td><td>Stored in DB-backed outbound event collections and pruned automatically</td><td>Configured with <code>DATA_RETENTION_OUTBOUND_EVENTS_DAYS</code> (current default: ${OUTBOUND_RETENTION_DAYS} days)</td></tr>
        <tr><td>Browser local storage keys</td><td>Persisted client-side until user clears or consent policy revokes</td><td>Covered in Cookie Policy</td></tr>
      </table>
      <p>Retention windows are reviewed periodically to stay aligned with product, security and legal obligations.</p>

      <h2>6. User rights</h2>
      <p>Users can request access, rectification, deletion, restriction, portability, objection and consent withdrawal. Contact: <a href="mailto:${safePrivacyEmail}">${safePrivacyEmail}</a>.</p>

      <h2>7. Account deletion</h2>
      <p>The app provides account deletion flow; associated account-linked records are removed from primary stores. Browser-side consent and local travel data are cleared by app logic on deletion.</p>

      <h2>8. International transfers</h2>
      <p>Where processing involves non-EEA infrastructure or subprocessors, transfers are handled with appropriate safeguards (including contractual mechanisms where required).</p>

      <h2>9. Changes</h2>
      <p>Policy changes are published at this URL. Material updates should be communicated through in-app notice or email where appropriate.</p>
    `
  );
}

export function renderCookiePolicy() {
  const safeDate = escapeHtml(EFFECTIVE_DATE);

  return page(
    'Cookie Policy',
    `
      <h1>Cookie Policy</h1>
      <p class="meta">Last updated: ${safeDate}</p>

      <h2>1. Consent model</h2>
      <p>The app uses category-based consent with three choices: <strong>Accept all</strong>, <strong>Functional only</strong>, and <strong>Necessary only</strong>. Non-necessary storage is blocked/cleared when consent is not granted.</p>

      <h2>2. Necessary (always active)</h2>
      <table>
        <tr><th>Name/Key</th><th>Purpose</th><th>Storage</th></tr>
        <tr><td><code>flight_access_token</code></td><td>Short-lived authenticated session token</td><td>HttpOnly cookie</td></tr>
        <tr><td><code>flight_refresh_token</code></td><td>Refresh session token for access rotation</td><td>HttpOnly cookie</td></tr>
        <tr><td><code>flight_cookie_consent_v1</code></td><td>Stores your consent choices</td><td>localStorage</td></tr>
        <tr><td><code>flight_post_auth_action</code>, <code>flight_post_auth_mode</code>, <code>flight_post_auth_view</code>, <code>flight_post_auth_section</code></td><td>Resume intended flow after auth</td><td>localStorage</td></tr>
        <tr><td><code>free_device_id</code></td><td>Free/demo quota and abuse prevention</td><td>HttpOnly cookie</td></tr>
      </table>

      <h2>3. Functional (requires consent)</h2>
      <table>
        <tr><th>Name/Key</th><th>Purpose</th><th>Storage</th></tr>
        <tr><td><code>remembered_email</code></td><td>Pre-fill login email when requested</td><td>localStorage</td></tr>
        <tr><td><code>flight_language</code></td><td>Remember selected UI language</td><td>localStorage</td></tr>
        <tr><td><code>flight_tracked_routes_v1</code></td><td>Persist tracked routes on this browser</td><td>localStorage</td></tr>
        <tr><td><code>flight_saved_itineraries_v1</code></td><td>Persist saved/recent itineraries</td><td>localStorage</td></tr>
        <tr><td><code>flight_radar_session_active_v1</code></td><td>Remember radar session state</td><td>localStorage</td></tr>
        <tr><td><code>flight_user_plan_v1</code></td><td>Client-side plan cache</td><td>localStorage</td></tr>
        <tr><td><code>flight_upgrade_interest_records</code></td><td>Avoid repeated upgrade prompts</td><td>localStorage</td></tr>
      </table>

      <h2>4. Analytics (requires consent)</h2>
      <table>
        <tr><th>Item</th><th>Purpose</th><th>Storage</th></tr>
        <tr><td>Funnel and product telemetry events</td><td>Measure product usage and conversion funnel (event type, timestamp, route/interaction context)</td><td>Server-side event store with dedupe and retention policy</td></tr>
        <tr><td>Search lifecycle analytics</td><td>Service quality and feature optimization (search mode, result count, error codes)</td><td>Server-side event store with retention policy</td></tr>
      </table>
      <p>The application does not depend on third-party ad-tech trackers in the audited code paths.</p>

      <h2>5. Managing choices</h2>
      <p>You can change your cookie preferences anytime from the in-app "Cookie settings" control. The app enforces the selected policy and removes disallowed local keys.</p>

      <h2>6. Third-party sites</h2>
      <p>When you open an outbound booking link, you leave this application. Third-party providers apply their own cookie/privacy policies.</p>
    `
  );
}

export function renderTermsOfService() {
  const safeDate = escapeHtml(EFFECTIVE_DATE);
  const safeAppName = escapeHtml(APP_NAME);
  const safeCompany = escapeHtml(COMPANY);
  const safePrivacyEmail = escapeHtml(PRIVACY_EMAIL);

  return page(
    'Terms and Conditions',
    `
      <h1>Terms and Conditions</h1>
      <p class="meta">Last updated: ${safeDate}</p>

      <h2>1. Service scope</h2>
      <p>${safeAppName} provides travel discovery, analytics and booking handoff features. The service does not itself sell flight tickets.</p>

      <h2>2. Accounts and eligibility</h2>
      <p>You are responsible for your account credentials and for activity performed through your account.</p>

      <h2>3. Plans and billing</h2>
      <p>Paid features may require an active subscription. Billing operations are handled by integrated payment providers.</p>
      <p>Plan terms, renewal cadence and included features are presented in-app before purchase and can change with prior notice where required by law.</p>

      <h2>4. Acceptable use</h2>
      <ul>
        <li>No abuse, probing, scraping beyond allowed usage, or attempts to bypass quotas/security.</li>
        <li>No unlawful use or rights-infringing activity.</li>
        <li>No reverse engineering or unauthorized redistribution of proprietary data/features.</li>
      </ul>

      <h2>5. Third-party services</h2>
      <p>Outbound bookings and third-party providers are outside direct control of ${safeCompany}. Their own terms apply once you leave the app.</p>

      <h2>6. Liability disclaimer</h2>
      <p>Service is provided on an "as available" basis. Pricing and availability shown in app may change on partner checkout pages.</p>

      <h2>7. Termination</h2>
      <p>We may suspend accounts for material breach, security abuse, or legal necessity. Users can close accounts through in-app account deletion where available.</p>

      <h2>8. Governing law</h2>
      <p>These terms are interpreted according to applicable consumer and commercial law in the jurisdiction where the service operator is established, without limiting mandatory consumer protections.</p>

      <h2>9. Contact</h2>
      <p>For legal inquiries contact <a href="mailto:${safePrivacyEmail}">${safePrivacyEmail}</a>.</p>
    `
  );
}
