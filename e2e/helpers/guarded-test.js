import { test as base, expect } from '@playwright/test';

const IGNORED_CONSOLE_ERRORS = [/download the react devtools/i];
const IGNORED_REQUEST_FAILURES = [/ERR_ABORTED/i, /NS_BINDING_ABORTED/i, /\bcancelled\b/i, /\bcanceled\b/i];
const IGNORED_ASSET_PATHS = ['/favicon.ico', '/apple-touch-icon.png', '/manifest.webmanifest'];

function shouldIgnoreConsoleError(text) {
  const value = String(text || '').trim();
  if (!value) return true;
  if (/Failed to load resource/i.test(value)) return true;
  return IGNORED_CONSOLE_ERRORS.some((pattern) => pattern.test(value));
}

function shouldIgnoreRequestFailure(message) {
  const value = String(message || '').trim();
  if (!value) return false;
  return IGNORED_REQUEST_FAILURES.some((pattern) => pattern.test(value));
}

function isAppUrl(url, baseURL) {
  try {
    const target = new URL(url);
    if (!baseURL) return target.protocol === 'http:' || target.protocol === 'https:';
    const base = new URL(baseURL);
    return target.host === base.host;
  } catch {
    return false;
  }
}

function truncateItems(items, max = 12) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, max);
}

export const test = base.extend({
  _runtimeGuard: [
    async ({ page, baseURL }, use, testInfo) => {
      const consoleErrors = [];
      const pageErrors = [];
      const requestFailures = [];
      const apiServerErrors = [];
      const criticalAssetErrors = [];

      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        const text = message.text();
        if (shouldIgnoreConsoleError(text)) return;
        const location = message.location();
        consoleErrors.push({
          text,
          url: location?.url || null,
          lineNumber: location?.lineNumber || null
        });
      });

      page.on('pageerror', (error) => {
        pageErrors.push({
          message: String(error?.message || error || 'unknown_page_error'),
          stack: String(error?.stack || '')
        });
      });

      page.on('requestfailed', (request) => {
        const url = request.url();
        if (!isAppUrl(url, baseURL)) return;
        const failureText = request.failure()?.errorText || 'request_failed';
        if (shouldIgnoreRequestFailure(failureText)) return;
        requestFailures.push({
          method: request.method(),
          url,
          failureText
        });
      });

      page.on('response', (response) => {
        const url = response.url();
        if (!isAppUrl(url, baseURL)) return;
        const status = response.status();
        if (url.includes('/api/')) {
          if (status >= 500) {
            apiServerErrors.push({
              status,
              url
            });
          }
          return;
        }
        if (status < 400) return;
        const pathname = (() => {
          try {
            return new URL(url).pathname;
          } catch {
            return '';
          }
        })();
        if (IGNORED_ASSET_PATHS.includes(pathname)) return;
        const resourceType = response.request()?.resourceType?.() || 'unknown';
        if (['script', 'stylesheet', 'fetch', 'xhr'].includes(resourceType)) {
          criticalAssetErrors.push({ status, url, resourceType });
        }
      });

      await use();

      const hasViolations =
        consoleErrors.length > 0 ||
        pageErrors.length > 0 ||
        requestFailures.length > 0 ||
        apiServerErrors.length > 0 ||
        criticalAssetErrors.length > 0;
      if (!hasViolations) return;

      const payload = {
        test: testInfo.title,
        file: testInfo.file,
        consoleErrors: truncateItems(consoleErrors),
        pageErrors: truncateItems(pageErrors),
        requestFailures: truncateItems(requestFailures),
        apiServerErrors: truncateItems(apiServerErrors),
        criticalAssetErrors: truncateItems(criticalAssetErrors)
      };

      await testInfo.attach('runtime-guard-report', {
        contentType: 'application/json',
        body: Buffer.from(JSON.stringify(payload, null, 2), 'utf8')
      });

      const summary = [
        `Runtime guard detected real issues in "${testInfo.title}":`,
        `consoleErrors=${consoleErrors.length}`,
        `pageErrors=${pageErrors.length}`,
        `requestFailures=${requestFailures.length}`,
        `apiServerErrors=${apiServerErrors.length}`,
        `criticalAssetErrors=${criticalAssetErrors.length}`,
        `firstConsole=${consoleErrors[0]?.text || '-'}`,
        `firstPageError=${pageErrors[0]?.message || '-'}`,
        `firstRequestFailure=${requestFailures[0] ? `${requestFailures[0].method} ${requestFailures[0].url} :: ${requestFailures[0].failureText}` : '-'}`,
        `firstApiServerError=${apiServerErrors[0] ? `${apiServerErrors[0].status} ${apiServerErrors[0].url}` : '-'}`,
        `firstCriticalAssetError=${criticalAssetErrors[0] ? `${criticalAssetErrors[0].status} ${criticalAssetErrors[0].url} (${criticalAssetErrors[0].resourceType})` : '-'}`
      ].join(' | ');

      expect(hasViolations, summary).toBe(false);
    },
    { auto: true }
  ]
});

export { expect } from '@playwright/test';
