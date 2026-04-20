# Production Cutover Playbook

## Preconditions
1. Secrets loaded in production secret manager.
2. `DATABASE_URL` and `REDIS_URL` reachable from runtime.
3. `PROD_BASE_URL` points to live HTTPS domain.
4. Stripe live webhook configured on `/api/billing/webhook`.

## T-30 minutes (go/no-go)
1. Run:
   - `npm run ops:prod:readiness`
2. Ensure all blocking checks are green.

## Cutover execution
1. Deploy application image/revision with your standard deploy command.
2. Run post-deploy verification:
   - `PROD_BASE_URL=https://<your-domain> npm run test:prod:external`
3. Verify critical flows:
   - auth login/logout
   - search
   - Stripe checkout
   - webhook ingestion

## One-click rollback
Set rollback command for your platform and execute:

```bash
ROLLBACK_DEPLOY_COMMAND="kubectl rollout undo deploy/flight-api -n production && kubectl rollout undo deploy/flight-worker -n production" \
PROD_BASE_URL="https://<your-domain>" \
npm run ops:rollback:one-click
```

Optional explicit post-rollback verification command:

```bash
ROLLBACK_DEPLOY_COMMAND="your rollback command" \
ROLLBACK_POST_VERIFY_COMMAND="PROD_BASE_URL=https://<your-domain> npm run test:prod:external" \
npm run ops:rollback:one-click
```

## Post-rollback checks
1. `test:prod:external` green.
2. `billing_mock_mode` remains disabled.
3. No free-user access to AI endpoints.
4. Stripe webhook events continue processing (signature + idempotency).

