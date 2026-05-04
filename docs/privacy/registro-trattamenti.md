# Registro dei Trattamenti (GDPR Art. 30)

Last update: 2026-05-04  
Version: v1.1-final  
Owner: Privacy Office - Flight Suite

Titolare del trattamento: Clariter Group  
Sede legale: Via del Corso 101, 00186 Roma, Italia  
Contatto privacy: privacy@flightsuite.app  
DPO contact: dpo@flightsuite.app  
Responsabile interno: Stefano Giustini, Founder

## Trattamenti principali

| Trattamento | Finalita | Categorie dati | Base giuridica | Interessati | Destinatari e ruolo GDPR | Trasferimenti extra-SEE | Retention | Misure sicurezza |
|---|---|---|---|---|---|---|---|---|
| Gestione account e autenticazione | Registrazione, login, sessione, MFA, recupero account | email, identificativi account, credenziali hash, metadata sessione | Contratto; legittimo interesse per sicurezza | Utenti registrati | Clariter Group come Titolare; DB/cache self-managed come trattamento interno | No, salvo futuro hosting esterno approvato in DPA register | Account: durata account + 30 giorni; auth/session/security events: 90 giorni | Access control, cookie hardening, CSRF, rate limit, logging redatto |
| Ricerca voli e discovery | Erogazione funzionalita core e risultati di ricerca | query di ricerca, preferenze viaggio, route prefs | Contratto | Utenti | Clariter Group come Titolare; Duffel/Travelpayouts solo se attivati e approvati come fornitori | No se provider esterni non attivi; extra-SEE solo con SCC/DPA | Search history: 180 giorni; detected deals: 45 giorni | Minimizzazione, segregazione, provider gating |
| Alert e notifiche | Notifiche operative e alert prezzo | email, preferenze alert, metadata invio | Contratto; legittimo interesse per notifiche operative | Utenti | Clariter Group come Titolare; SMTP provider solo se configurato come Responsabile | No se SMTP non configurato; extra-SEE solo con SCC/DPA | Alert/watchlist: durata account o disattivazione + 30 giorni | Anti-abuso, rate limit, opt-out/delete |
| Billing e abbonamenti | Checkout, pagamenti, stato abbonamento, riconciliazione | Stripe customer/subscription/payment/invoice refs; no full PAN storage | Contratto; obbligo legale | Clienti | Stripe come Titolare autonomo per payment processing e Responsabile per limitati servizi sotto Stripe DPA | US/EU operations con SCC/Stripe DPA per trasferimenti extra-SEE | Billing records: 10 anni dove richiesto da obblighi fiscali/contabili | Webhook signature verification, no PAN storage, audit |
| Tracking analytics consensato | Misurazione prodotto e funnel | eventi pseudonimizzati, consent timestamp, hash IP/UA ove applicabile | Consenso | Utenti/visitatori | Clariter Group come Titolare; analytics esterni non attivi senza DPA/SCC | No per analytics interni; extra-SEE solo con provider approvato | Client telemetry/analytics: 180 giorni | Consent gate, revoca immediata, minimizzazione |
| Backoffice admin | Supporto operativo, governance, audit | dati minimi necessari, admin action logs, correlation IDs | Legittimo interesse; obbligo legale ove applicabile | Utenti/admin | Clariter Group come Titolare; team interno autorizzato | No | Admin audit logs: 365 giorni | RBAC, allowlist, audit log, redaction |
| Sicurezza e incident response | Prevenzione abusi, investigazione, notifica incidenti | eventi auth, log sicurezza, request IDs, correlation IDs | Legittimo interesse; obbligo legale | Utenti/visitatori | Clariter Group come Titolare; eventuale security tooling solo dopo DPA review | No se tooling esterno non attivo | Security/auth events: 90 giorni; error/application logs: 90 giorni | Redaction, integrity controls, incident runbook 72h |
| Data subject rights | Accesso, export, rettifica, cancellazione, opposizione | dati account e dati di servizio necessari a evadere la richiesta | Obbligo legale | Utenti/interessati | Clariter Group come Titolare | No | Ticket/evidenza richiesta: 365 giorni | Identity verification, audit trail, least privilege |

## Gestione diritti interessato
- Canale richieste: privacy@flightsuite.app.
- Tempo massimo risposta: 30 giorni dal ricevimento, salvo estensione GDPR per complessita.
- Accesso/export: workflow di esportazione dati e supporto privacy.
- Cancellazione: account deletion, purge/anonymization backend e cancellazione storage consentita, salvo obblighi legali.
- Rettifica: aggiornamento dati account o correzione assistita dal supporto.

## Note operative
- Provider esterni non configurati non devono ricevere dati personali.
- Ogni attivazione di nuovo provider richiede aggiornamento preventivo di questo registro e di `docs/privacy/dpa-fornitori.md`.
- Retention dichiarata qui deve restare allineata a `docs/privacy/data-retention-policy.md` e alle variabili runtime.

Approved by: Stefano Giustini
Role: Founder
Date: 2026-05-04
