import { buildApiKeysRouter } from '../routes/apikeys.js';
import { buildBillingRouter } from '../routes/billing.js';
import { buildUsageRouter } from '../routes/usage.js';
import { buildFreeRouter } from '../routes/free.js';
import { buildDealEngineRouter } from '../routes/deal-engine.js';
import { buildDiscoveryRouter } from '../routes/discovery.js';
import { buildOpportunitiesRouter } from '../routes/opportunities.js';
import { buildUserExportRouter } from '../routes/user-export.js';
import { buildPushRouter } from '../routes/push.js';
import { buildEmailPreferencesRouter } from '../routes/email-preferences.js';
import { buildUnsubscribeRouter } from '../routes/unsubscribe.js';

function isBrowserPushEnabled() {
  return String(process.env.BROWSER_PUSH_ENABLED || 'false').trim().toLowerCase() === 'true';
}

export function registerSaasRoutes(app, deps) {
  const {
    adminGuard,
    appendImmutableAudit,
    attachUserConsent,
    authGuard,
    canTrack,
    csrfGuard,
    fetchCurrentUser,
    optionalAuth,
    outboundRepo,
    quotaGuard,
    readDb,
    requireApiScope,
    requireSessionAuth,
    withDb
  } = deps;

  app.use(
    '/api/push',
    buildPushRouter({
      authGuard,
      csrfGuard,
      enabled: isBrowserPushEnabled()
    })
  );
  app.use('/api', buildEmailPreferencesRouter({ authGuard, csrfGuard, withDb }));
  app.use('/', buildUnsubscribeRouter({ withDb }));
  app.use('/api/keys', buildApiKeysRouter({ authGuard, csrfGuard }));
  app.use('/api/billing', buildBillingRouter({ authGuard, requireSessionAuth, csrfGuard }));
  app.use('/api/usage', buildUsageRouter({ authGuard }));
  app.use('/api/free', buildFreeRouter());
  app.use('/api', buildUserExportRouter({
    authGuard,
    requireSessionAuth,
    quotaGuard,
    withDb,
    readDb,
    fetchCurrentUser,
    appendImmutableAudit
  }));
  app.use('/', buildDealEngineRouter({
    authGuard,
    optionalAuth,
    requireSessionAuth,
    adminGuard,
    attachUserConsent,
    canTrack,
    outboundRepo
  }));
  app.use('/api/discovery', buildDiscoveryRouter({ authGuard, csrfGuard, quotaGuard, requireApiScope }));
  app.use('/api/opportunities', buildOpportunitiesRouter({
    authGuard,
    requireSessionAuth,
    adminGuard,
    csrfGuard,
    requireApiScope,
    quotaGuard,
    withDb,
    optionalAuth
  }));
}
