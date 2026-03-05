# Incident Runbook

## Severity levels
- SEV-1: login/billing/outage for all users.
- SEV-2: critical feature degraded (alerts, engine windows/deals).
- SEV-3: partial degradation or non-blocking error spikes.

## First 10 minutes
1. Check `/health`, `/health/db`, `/health/engine`.
2. Run `npm run show:report` and inspect `error.log` + `security.log`.
3. Confirm DB/Redis connectivity and resource usage.
4. If auth failures spike, rotate/revalidate JWT and OAuth settings.
5. If billing failures spike, verify Stripe webhook signature and event delivery.

## Containment actions
- Toggle non-essential jobs/workers temporarily.
- Rate-limit attack vectors harder if suspicious 401/403/429 spikes.
- Freeze rollout if issue began after deploy.

## Recovery
1. Roll back to last known good build if needed.
2. Re-run smoke checks:
   - `npm run test:security`
   - `npm run test:go-live`
3. Validate end-user flows: login, search, set alert, billing status.

## Postmortem template
- What happened
- User impact window (UTC timestamps)
- Root cause
- Corrective actions (done)
- Preventive actions (next sprint)
