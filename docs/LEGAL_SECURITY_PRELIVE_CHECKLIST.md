# Legal + Security Pre-Live Checklist

## P0 - Blocking
- [ ] `FRONTEND_URL`, `FRONTEND_ORIGIN`, `CORS_ALLOWLIST` set to final production domain(s) only.
- [ ] `JWT_SECRET`, `OUTBOUND_CLICK_SECRET`, `AUDIT_LOG_HMAC_KEY`, `INTERNAL_INGEST_TOKEN` set with strong random values.
- [ ] `TRUST_PROXY` configured correctly for real reverse proxy chain.
- [ ] Stripe production values configured: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_CREATOR`.
- [ ] Stripe webhook endpoint live, signature verified, livemode test passed.
- [ ] `ALLOW_MOCK_BILLING_UPGRADES=false` in production.
- [ ] Privacy Policy, Cookie Policy and Terms pages publicly reachable and linked from UI footer.
- [ ] Cookie consent banner working on first visit; optional categories disabled by default.
- [ ] Backup and restore process verified for production database.

## P1 - Required for healthy launch
- [ ] SMTP fully configured (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`) for account and recovery emails.
- [ ] Push webhook (`PUSH_WEBHOOK_URL`) configured or explicitly disabled with documented impact.
- [ ] Affiliate config finalized (`ENABLE_TRAVELPAYOUTS_AFFILIATE`, marker/shmarker, Kiwi wrapper settings).
- [ ] Outbound redirect flow verified end-to-end with click tracking and sanitized logs.
- [ ] Security headers verified in production response (Helmet, HSTS, CSP, X-Powered-By disabled).
- [ ] Incident logging/monitoring connected (request/security events + alerting).
- [ ] Data retention env values reviewed against policy and legal requirements.
- [ ] Data Subject Request workflow documented (access/erasure/export handling).

## P2 - Strongly recommended soon after launch
- [ ] Legal review by qualified counsel for jurisdiction-specific clauses.
- [ ] DPA/subprocessor register finalized and published internally.
- [ ] Periodic secret rotation policy implemented.
- [ ] Privacy/cookie wording localized in all supported app languages.
- [ ] Quarterly review of retention windows vs business and legal needs.

## Runtime verification commands
- [ ] `npm run preflight:prod`
- [ ] `npm run test:security`
- [ ] `npm run test:go-live`
- [ ] `npm run ops:prod:readiness`
- [ ] `npm run release:prod:gate`

