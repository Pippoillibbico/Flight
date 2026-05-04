import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const APP_NAME = String(process.env.APP_NAME || 'Flight').trim();
const APP_URL = String(process.env.FRONTEND_URL || 'http://localhost:8080').trim();
const COMPANY = String(process.env.LEGAL_COMPANY_NAME || 'Clariter Group').trim();
const ADDRESS = String(process.env.LEGAL_COMPANY_ADDRESS || 'Via del Corso 101, 00186 Roma, Italia').trim();
const PRIVACY_EMAIL = String(process.env.LEGAL_PRIVACY_EMAIL || 'privacy@flightsuite.app').trim();

const LEGAL_DOCS = {
  privacy: 'docs/privacy/privacy-policy.md',
  cookie: 'docs/privacy/cookie-policy.md',
  retention: 'docs/privacy/data-retention-policy.md',
  dpa: 'docs/privacy/dpa-fornitori.md',
  breach: 'docs/security/data-breach-72h-procedure.md'
};

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function readDoc(relativePath) {
  const abs = resolve(process.cwd(), relativePath);
  if (!existsSync(abs)) {
    throw new Error(`legal_source_document_missing:${relativePath}`);
  }
  return readFileSync(abs, 'utf8');
}

function inlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

function renderMarkdownTable(lines, startIndex) {
  const rows = [];
  let index = startIndex;
  while (index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index])) {
    rows.push(lines[index]);
    index += 1;
  }
  if (rows.length < 2) return { html: '', nextIndex: startIndex };

  const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => inlineMarkdown(cell.trim()));
  const header = cells(rows[0]);
  const bodyRows = rows.slice(2).map(cells);
  const html = [
    '<table>',
    '<thead><tr>',
    ...header.map((cell) => `<th>${cell}</th>`),
    '</tr></thead>',
    '<tbody>',
    ...bodyRows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`),
    '</tbody></table>'
  ].join('');
  return { html, nextIndex: index };
}

function markdownToHtml(markdown) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let listOpen = false;

  const closeList = () => {
    if (!listOpen) return;
    html.push('</ul>');
    listOpen = false;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      closeList();
      continue;
    }

    if (/^\s*\|.*\|\s*$/.test(trimmed) && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
      closeList();
      const table = renderMarkdownTable(lines, i);
      if (table.html) {
        html.push(table.html);
        i = table.nextIndex - 1;
        continue;
      }
    }

    if (trimmed.startsWith('# ')) {
      closeList();
      html.push(`<h1>${inlineMarkdown(trimmed.slice(2))}</h1>`);
      continue;
    }
    if (trimmed.startsWith('## ')) {
      closeList();
      html.push(`<h2>${inlineMarkdown(trimmed.slice(3))}</h2>`);
      continue;
    }
    if (trimmed.startsWith('### ')) {
      closeList();
      html.push(`<h3>${inlineMarkdown(trimmed.slice(4))}</h3>`);
      continue;
    }
    if (trimmed.startsWith('- ')) {
      if (!listOpen) {
        html.push('<ul>');
        listOpen = true;
      }
      html.push(`<li>${inlineMarkdown(trimmed.slice(2))}</li>`);
      continue;
    }

    closeList();
    html.push(`<p>${inlineMarkdown(trimmed)}</p>`);
  }
  closeList();
  return html.join('\n');
}

function css() {
  return `
    *, *::before, *::after { box-sizing: border-box; }
    body { margin: 0; background: #f3f6fb; color: #12233f; font: 15px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 24px 12px 48px; }
    .wrap { max-width: 920px; margin: 0 auto; background: #fff; border: 1px solid #dfe8f5; border-radius: 14px; padding: 28px; box-shadow: 0 8px 28px rgba(13, 35, 72, 0.08); }
    .brand, .back { color: #1f4f9d; font-weight: 700; text-decoration: none; }
    .brand { display: inline-flex; margin-bottom: 18px; font-size: 16px; }
    .back { display: inline-block; margin: 0 0 22px; font-size: 13px; }
    h1 { margin: 0 0 10px; font-size: 28px; color: #0d2142; }
    h2 { margin: 28px 0 8px; font-size: 20px; color: #0f2f60; }
    h3 { margin: 18px 0 6px; font-size: 16px; color: #184582; }
    p { margin: 0 0 12px; }
    ul { margin: 8px 0 14px 20px; }
    li { margin: 4px 0; }
    code { background: #eef4ff; border: 1px solid #d5e3ff; border-radius: 6px; padding: 1px 5px; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0 18px; font-size: 14px; }
    th, td { border: 1px solid #d9e4f6; padding: 8px 10px; text-align: left; vertical-align: top; }
    th { background: #edf4ff; color: #183f75; }
    tr:nth-child(even) td { background: #f9fbff; }
    .source-note { margin: 18px 0; padding: 10px 12px; background: #f7fbff; border: 1px solid #d9e4f6; border-radius: 8px; color: #486184; font-size: 13px; }
    .related-docs { margin-top: 30px; padding-top: 16px; border-top: 1px solid #d9e4f6; }
    footer { margin-top: 34px; padding-top: 14px; border-top: 1px solid #d9e4f6; color: #5a7195; font-size: 13px; }
  `;
}

function relatedDocs() {
  return `
    <section class="related-docs" aria-label="Related legal documents">
      <h2>Related source documents</h2>
      <ul>
        <li><code>${escapeHtml(LEGAL_DOCS.privacy)}</code></li>
        <li><code>${escapeHtml(LEGAL_DOCS.cookie)}</code></li>
        <li><code>${escapeHtml(LEGAL_DOCS.retention)}</code></li>
        <li><code>${escapeHtml(LEGAL_DOCS.dpa)}</code></li>
        <li><code>${escapeHtml(LEGAL_DOCS.breach)}</code></li>
      </ul>
    </section>
  `;
}

function page(title, sourcePath, body) {
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
  <article class="wrap" data-legal-source="${escapeHtml(sourcePath || 'inline')}">
    <a class="brand" href="${safeAppUrl}">${safeAppName}</a>
    <a class="back" href="${safeAppUrl}">Back to app</a>
    ${sourcePath ? `<p class="source-note">Public page generated from source document: <code>${escapeHtml(sourcePath)}</code></p>` : ''}
    ${body}
    ${relatedDocs()}
    <footer>
      <p>${safeAppName} is operated by ${safeCompany}, ${safeAddress}.</p>
      <p>Privacy contact: <a href="mailto:${safePrivacyEmail}">${safePrivacyEmail}</a></p>
      <p><a href="${safeAppUrl}/privacy-policy">Privacy Policy</a> | <a href="${safeAppUrl}/cookie-policy">Cookie Policy</a> | <a href="${safeAppUrl}/terms">Terms</a></p>
    </footer>
  </article>
</body>
</html>`;
}

function renderSourceDocument(title, sourcePath) {
  return page(title, sourcePath, markdownToHtml(readDoc(sourcePath)));
}

export function renderPrivacyPolicy() {
  return renderSourceDocument('Privacy Policy', LEGAL_DOCS.privacy);
}

export function renderCookiePolicy() {
  return renderSourceDocument('Cookie Policy', LEGAL_DOCS.cookie);
}

export function renderTermsOfService() {
  return page(
    'Terms and Conditions',
    null,
    markdownToHtml(`# Terms and Conditions

Last update: 2026-05-04

## 1. Scope
${APP_NAME} is a travel opportunity discovery service. The service does not directly sell airline tickets and is not the airline, travel agency, or payment institution for third-party bookings.

## 2. Soft-launch transparency
When LAUNCH_MODE=soft, the product focuses on public cached deals, basic route insights, cached radar preview, signup/login, pricing, outbound handoff, GDPR/cookie controls, and Stripe readiness. Live scans, instant alert delivery, and AI tools are available only when the relevant paid-plan and provider configuration is active.

## 3. Third-party services
Payments are handled by Stripe when billing is configured. Outbound booking links lead to third-party services governed by their own terms and policies.

## 4. Privacy and data protection
Privacy, cookie, retention, DPA, and incident-response source documents are linked on this page and govern the corresponding data-processing practices.

## 5. Contact
For legal or privacy questions, contact ${PRIVACY_EMAIL}.`)
  );
}
