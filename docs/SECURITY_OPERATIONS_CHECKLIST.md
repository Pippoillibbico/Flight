# Security Operations Checklist (SOC2-like)

Questa checklist e' pensata per la gestione operativa continuativa (non solo go-live) con evidenze verificabili.

## 1) Governance e accessi
- [ ] MFA obbligatoria su tutti gli account cloud, repo Git, CI/CD, DNS, provider payment.
- [ ] Ruoli RBAC con principio del minimo privilegio (dev, ops, billing, read-only).
- [ ] Account condivisi proibiti; ogni azione deve essere attribuibile a una persona.
- [ ] Review trimestrale degli accessi + revoca immediata offboarding.
- [ ] Branch protection su `main/master` con PR review obbligatoria.

Evidenze:
- screenshot policy MFA, export IAM roles, audit log provider.

## 2) Secrets management
- [ ] Nessun segreto in repo o in immagini Docker.
- [ ] `.env` non versionato (gia' rimosso dall'indice git).
- [ ] Segreti ruotati almeno ogni 90 giorni (JWT, audit HMAC, ingest token, SMTP, payment keys).
- [ ] Segreti distinti per ambiente (`dev`, `staging`, `prod`).
- [ ] Alert su accesso anomalo al secret manager.

Evidenze:
- report rotazione, policy secret manager, output `npm run preflight:prod`.

## 3) SDLC sicuro (build/test)
- [ ] Pipeline CI standard verde (`npm run ci`).
- [ ] Pipeline security gate verde (`test:security`, `test:security:compliance`, `preflight:prod`, `npm audit`).
- [ ] Controlli lint provider esterni (`npm run lint:providers`) sempre attivi.
- [ ] Nessun deploy se security gate fallisce.

Evidenze:
- artefatti GitHub Actions (`ci.yml`, `security.yml`), badge/status run.

## 4) Hardening applicativo
- [ ] CORS allowlist stretta, niente wildcard con credentials.
- [ ] CSRF obbligatorio su mutazioni cookie-auth.
- [ ] Cookie auth `HttpOnly`, `Secure`, `SameSite=Lax`.
- [ ] Rate limiting attivo su auth e API.
- [ ] Header di sicurezza via Helmet + CSP in produzione.
- [ ] Fail-fast startup se mancano config bloccanti.

Evidenze:
- `GET /api/health/security`
- `GET /api/health/deploy-readiness`
- `npm run test:security:compliance`

## 5) Logging, monitoring, incident response
- [ ] Log strutturati con `request_id` su tutte le risposte.
- [ ] Alert su picchi 401/403/429/5xx.
- [ ] Alert su errori webhook billing e replay/dedup.
- [ ] Runbook incidenti aggiornato e testato almeno 2 volte/anno.
- [ ] Tempo target di triage incident P0 < 30 minuti.

Evidenze:
- dashboard alerting, log extract, verbale tabletop exercise.

## 6) Data protection e privacy
- [ ] Classificazione dati (PII, auth events, usage events).
- [ ] Cifratura in transito (TLS) e at-rest su DB/backups.
- [ ] Retention policy documentata e applicata.
- [ ] Backup cifrati + restore drill trimestrale.
- [ ] Data subject rights process (accesso/cancellazione) operativo.

Evidenze:
- report backup/restore, policy retention, ticket data requests.

## 7) Vendor e third-party risk
- [ ] Due diligence annuale su provider critici (cloud, email, payment).
- [ ] Verifica SLA/SLO e region compliance.
- [ ] Procedure di fallback per outage provider payment/email.
- [ ] Inventario dipendenze con controllo vulnerabilita' periodico.

Evidenze:
- vendor review doc, risultati `npm audit --omit=dev`.

## 8) Cadence operativa consigliata
- Giornaliera: monitor alert + stato health/readiness.
- Settimanale: review errori security + anomalie auth.
- Mensile: patching dipendenze e verifica vulnerabilita'.
- Trimestrale: rotation segreti, restore drill, access review.

## Comandi operativi rapidi
```bash
npm run ci
npm run test:security
npm run test:security:compliance
npm run preflight:prod
npm run show:report
```
