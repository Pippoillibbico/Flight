# Threat Model (P0/P1)

Scope: backend API (`server/index.js` + routers), auth/session, billing webhook, outbound redirect, workers, CI/CD.

## Architettura e asset critici
- Asset A1: token/sessioni (`access`, `refresh`, MFA challenge, reset token).
- Asset A2: segreti runtime (`JWT_SECRET`, `AUDIT_LOG_HMAC_KEY`, payment keys, SMTP).
- Asset A3: dati utente (email, auth events, usage, subscription).
- Asset A4: integrita' billing (webhook, dedup eventi, stato abbonamento).
- Asset A5: disponibilita' API (rate-limit bypass, DoS applicativo).

## Attori di minaccia
- T1: attaccante internet anonimo (credential stuffing, brute-force, scraping).
- T2: utente autenticato malevolo (abuso API scope/quota, escalation).
- T3: insider o account compromesso (segreti, CI/CD, deploy).
- T4: terza parte compromessa (provider payment/email/dependency).

## Superfici d'attacco
- S1: endpoint auth (`/api/auth/*`), refresh e CSRF.
- S2: webhook billing (`/api/billing/webhook`).
- S3: outbound redirect (`/api/outbound/resolve`, `/go/:clickId`).
- S4: pipeline CI/CD e dipendenze npm.
- S5: storage locale/runtime JSON e SQLite durante test/job.

## P0 (bloccanti) e mitigazioni

### P0-1 Account takeover via auth/session abuse
Rischio:
- brute force, token replay, CSRF bypass, user enumeration.
Mitigazioni in codice:
- rate-limit auth/API, lockout login, refresh rotation, revoke family.
- CSRF token + origin check su cookie-auth.
- messaggi login uniformati per ridurre enumeration.
Gap residui:
- nessun antifrode esterno/IP reputation; valutare in fase scale.

### P0-2 Segreti deboli o mancanti in produzione
Rischio:
- firma JWT/audit compromessa, ingress non autorizzati.
Mitigazioni:
- preflight runtime blocking + startup fail-fast in produzione.
- audit readiness endpoint.
Gap residui:
- governance rotazione segreti dipende da processo ops.

### P0-3 Billing tampering o webhook spoofing
Rischio:
- modifica fraudolenta piano/abbonamento.
Mitigazioni:
- verifica firma webhook (Stripe/Braintree), dedup eventi, audit log.
- fallback `503 billing_not_configured` in prod se secret mancante.
Gap residui:
- manca test end-to-end con sandbox reale provider payment.

### P0-4 Open redirect/partner abuse
Rischio:
- phishing, redirect verso host malevoli.
Mitigazioni:
- allowlist host partner + token click firmato + TTL.
Gap residui:
- monitoraggio reputazione host esterni non automatico.

### P0-5 CI/CD supply-chain vulnerabile
Rischio:
- deploy di codice vulnerabile o dipendenza compromessa.
Mitigazioni:
- workflow security gate con `npm audit --omit=dev`.
- pipeline bloccante su test security/compliance/preflight.
Gap residui:
- manca firming provenance/SBOM automatica.

## P1 (importanti, non bloccanti) e mitigazioni

### P1-1 Logging e detection insufficienti
Rischio:
- incidenti non rilevati in tempo.
Mitigazioni attuali:
- log strutturati + request id + eventi security.
Raccomandato:
- alert automatici su 401/403/429/5xx e webhook anomalies.

### P1-2 Data retention/privacy drift
Rischio:
- conservazione eccessiva PII, non conformita' privacy.
Mitigazioni attuali:
- endpoint delete account + cleanup record.
Raccomandato:
- retention policy enforcement schedulata e verificabile.

### P1-3 Test concurrency e lock su storage locale
Rischio:
- falsi negativi security test, instabilita' pipeline.
Mitigazioni:
- DB file isolato per security scripts (`FLIGHT_DB_FILE`).
Raccomandato:
- migrare test concorrenti su store completamente ephemeral.

### P1-4 Trust boundary reverse proxy non esplicita
Rischio:
- spoof header e cookie security errata.
Mitigazioni:
- `TRUST_PROXY` esplicito + check readiness.
Raccomandato:
- validare configurazione LB/ingress in deploy automation.

## Priorita' operative (30/60/90 giorni)
- 30 giorni:
  - Attivare security-gate come required check in branch protection.
  - Collegare alerting su error rates e auth anomalies.
- 60 giorni:
  - Test e2e webhook sandbox (Stripe/Braintree) in staging.
  - Secret rotation automatica + evidenze audit.
- 90 giorni:
  - SBOM + dependency pinning policy + provenienza artefatti.
  - Tabletop incident exercise + restore drill documentato.

## Mappa rischio sintetica
- Alto: Auth/session, secrets, billing webhook, CI supply chain.
- Medio: outbound redirect abuse, retention/privacy process, observability gaps.
- Basso: UI leakage residuale (gia' mitigata da friendly error mapping).
