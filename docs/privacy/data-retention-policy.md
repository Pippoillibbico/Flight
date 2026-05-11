# Data Retention Matrix

Last update: 2026-05-04  
Version: v1.1-final  
Owner: Data Governance & Privacy Office

Controller: Clariter Group  
Registered office: Via Giana Anguissola, 38 00142 Roma, Italia  
Privacy contact: privacy@flightsuite.app  
DPO contact: dpo@flightsuite.app  
Internal privacy owner: Stefano Giustini, Founder

| Dataset | Esempi dati | Retention target | Rationale | Deletion/anonymization |
|---|---|---:|---|---|
| Account profile | nome, email, piano | durata account + 30 giorni | Erogazione servizio e supporto post-chiusura | Purge schedulato dopo chiusura account |
| Auth/session/security events | login metadata, session refs, auth events, security events | 90 giorni | Sicurezza, anti-abuso, investigazione incidenti recenti | Rotazione/purge schedulato |
| Admin audit logs | actor/action/target/correlationId | 365 giorni | Accountability, controlli interni, forensics | Retention con controlli di integrita |
| Client telemetry and analytics with consent | event type, pseudonymous IDs, funnel events | 180 giorni | Misurazione prodotto e miglioramento servizio con consenso | Delete/aggregation |
| Marketing events | attribution metadata | 180 giorni | Campagne e misurazione consenso marketing | Delete |
| Search history | query, date, route prefs | 180 giorni | Funzionalita prodotto, riuso ricerche e supporto utente | User-delete + TTL purge |
| Alerts/watchlist | preferenze utente, rotte monitorate | durata account o disattivazione + 30 giorni | Servizio richiesto dall'utente | Delete su richiesta/chiusura |
| Billing records | subscription/invoice refs, Stripe customer references | 10 anni | Obblighi fiscali/contabili locali | Blocco cancellazione anticipata quando obbligatorio; minimizzazione interna |
| Billing records after account deletion | hash irreversibile utente, Stripe customer/subscription refs minimi, piano/status contabile | 10 anni | Obblighi fiscali/contabili, chargeback, dispute e riconciliazione pagamenti | Subscription Stripe cancellata quando possibile; account app anonymized/deleted; nessun nome/email/password/token conservato nel record di retention |
| Outbound/click tracking events | redirect context, partner click metadata, economic event refs | 180 giorni | Anti-frode, riconciliazione economica, analytics consentita ove applicabile | TTL purge/anonymization |
| Error/application logs | code, route, correlationId, redacted diagnostics | 90 giorni | Reliability, sicurezza, debug incidenti | Rotazione |
| Temporary import/export files | file temporanei operativi | 24 ore | Minimizzazione e sicurezza operativa | Cleanup automatico |
| Ingestion jobs | job metadata, status, counters | 30 giorni | Osservabilita pipeline e retry operativo | TTL purge |
| Detected deals | offerte rilevate, route stats | 45 giorni | Freschezza prodotto e riduzione dati obsoleti | TTL purge |
| Encrypted backups | snapshot DB cifrati | 30 giorni | Disaster recovery | Expiry automatica |

## Governance Notes
- Le durate sono approvate per il go-live e soggette a revisione periodica Legal/Finance.
- Ogni modifica retention deve essere tracciata con versione e data efficacia.
- Le richieste privacy sono gestite via privacy@flightsuite.app con risposta entro 30 giorni.
- Cancellazione, accesso e rettifica devono rispettare i limiti di legge su conservazione contabile, sicurezza e difesa da abusi.

Approved by: Stefano Giustini
Role: Founder
Date: 2026-05-04
