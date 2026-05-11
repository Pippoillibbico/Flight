# DPA Fornitori - Register

Last update: 2026-05-11  
Version: v1.3-flight-provider-activation  
Owner: Privacy Office - Flight Suite

Titolare del trattamento: Clariter Group  
Sede legale: Via del Corso 101, 00186 Roma, Italia  
Contatto privacy: privacy@flightsuite.app  
DPO contact: dpo@flightsuite.app  
Responsabile interno: Stefano Giustini, Founder

## Provider Matrix

| Fornitore | Stato go-live | Ruolo GDPR | Categorie dati | Finalita | Country/region | DPA signed | SCC | Evidenza/Note |
|---|---|---|---|---|---|---|---|---|
| Clariter Group self-managed runtime | Active | Titolare | dati app, log, account, audit | runtime applicativo | EU/Italy | N/A | N/A | Trattamento interno sotto controllo del Titolare |
| PostgreSQL self-managed container / managed DB when configured | Active local/self-managed; no managed provider active | Titolare per self-managed; future managed DB provider must be Responsabile | dati account/app, eventi, audit | persistenza DB | EU/Italy for current self-managed environment | N/A for self-managed | N/A for self-managed | Nessun managed DB vendor attivo nel repo; managed provider blocked until DPA signed YES |
| Redis self-managed container / managed cache when configured | Active local/self-managed; no managed provider active | Titolare per self-managed; future managed cache provider must be Responsabile | cache/session/security state | cache e rate limiting | EU/Italy for current self-managed environment | N/A for self-managed | N/A for self-managed | Nessun managed Redis vendor attivo nel repo; managed provider blocked until DPA signed YES |
| Stripe | Active for billing configuration | Titolare autonomo per payment processing; Responsabile per servizi limitati sotto Stripe DPA | customer id, subscription id, checkout/session refs, invoice/payment refs | pagamenti e abbonamenti | US/EU operations per Stripe terms | YES | YES | Stripe DPA/terms and transfer safeguards reviewed; no full card data stored by Flight Suite |
| SMTP/email delivery provider | Not active in current env (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` empty) | Responsabile when activated | email, delivery metadata | account emails, reset password, alerts | N/A until provider selected | NO - not active | NO - not active | Activation blocked until DPA signed YES and SCC YES if extra-EEA |
| Google OAuth / Google Identity Services | Active when `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_IDS` is configured in staging/production; local `.env` may remain empty | Google acts as independent controller for the user's Google Account and as auth provider/recipient for OAuth sign-in data; processor terms reviewed where applicable to Google Cloud/Workspace services | Google account subject id, verified email, display name, profile picture URL, OAuth state/nonce metadata | optional account login and account linking | Global / US-EU operations under Google terms | Reviewed / accepted where applicable | YES where applicable under Google transfer terms | Code gates runtime on `GOOGLE_CLIENT_ID(S)`; app requests `openid email profile`; evidence: Google API Services User Data Policy and Google Cloud Data Processing Addendum reviewed |
| Internal analytics datastore | Active only for server-side/internal telemetry | Trattamento interno del Titolare | pseudonymous events, funnel data, consent state | analytics prodotto | EU/Italy current runtime | N/A | N/A | Consent required for non-necessary analytics |
| Kiwi Tequila API | Active for flight data ingestion when `ENABLE_PROVIDER_KIWI=true` and `KIWI_API_KEY` is configured | Responsabile/sub-processor for provider API processing; no account identity sent by design | route/date/search parameters: origin IATA, destination IATA, departure/return dates, adults count, cabin class, currency; no name, email, account id, IP, payment data, or user free-text | flight fare search, availability/pricing ingestion, route baseline enrichment | EU/Czech Republic / global Kiwi.com operations | Reviewed / accepted via partner/API terms where applicable | YES where applicable under Kiwi.com transfer terms and GDPR safeguards | Separate from Travelpayouts affiliate. Runtime must keep payload minimized to route/date params only. Public references reviewed: Kiwi.com Privacy Policy and Tequila/partner API documentation |
| Duffel | Active as secondary flight data provider when `ENABLE_PROVIDER_DUFFEL=true` and `DUFFEL_API_KEY` is configured | Responsabile/sub-processor under Duffel Services Agreement DPA for travel-services API processing | route/date/search parameters: origin IATA, destination IATA, departure/return dates, adults count, cabin class, currency; optional supplier/offer ids; no name, email, account id, IP, payment data, or card data in search ingestion | GDS/provider fare search, availability/pricing ingestion, route baseline enrichment | UK / subsidiaries and subprocessors listed by Duffel | YES / accepted through Duffel Services Agreement where applicable | YES under Duffel DPA/UK GDPR transfer safeguards where applicable | Duffel Services Agreement includes a DPA for personal data processed for offering Travel Services and creating Orders. Current Jetly ingestion uses search/offer data only, not booking/order traveller data |
| Travelpayouts affiliate layer | Not active for identified personal-data transfer (`AFFILIATE_TRAVELPAYOUTS_MARKER` empty) | Not active; planned role before activation: Titolare autonomo for destination/affiliate service after outbound click | outbound click metadata if enabled | affiliate redirect/booking | to be verified before activation | NO - not active | NO - not active | Contract pack required before transmitting personal data; separate from Kiwi Tequila API |
| OpenAI | Not active in current env (`OPENAI_API_KEY` empty) | Responsabile when API processing is enabled under business/API DPA | minimized prompts/outputs | optional AI features | EU entity for EEA customer / US operations possible | NO - not active | NO - not active | OpenAI DPA/SCC publicly available; execute/accept before activation |
| Anthropic | Not active in current env (`ANTHROPIC_API_KEY` empty) | Responsabile when API processing is enabled under commercial/API DPA | minimized prompts/outputs | optional AI features | US | NO - not active | NO - not active | Anthropic DPA/SCC publicly available; execute/accept before activation |

## Activation Rule
No inactive provider may receive personal data until:
- DPA signed/accepted and archived.
- Country/region and subprocessor list reviewed.
- SCC or equivalent transfer safeguard confirmed for every extra-EEA transfer.
- `docs/privacy/registro-trattamenti.md`, this register, and user-facing privacy/cookie disclosures updated.

## Public DPA/SCC Verification Notes
- Stripe: public Stripe legal materials identify a Data Processing Agreement including a Data Transfers Addendum and Data Security Exhibit.
- Google OAuth / Identity: Google API Services User Data Policy reviewed at https://developers.google.com/terms/api-services-user-data-policy; Google Cloud Data Processing Addendum reviewed at https://cloud.google.com/terms/data-processing-addendum; Google Privacy Policy reviewed at https://policies.google.com/privacy.
- OpenAI: public OpenAI DPA includes SCC-based transfer terms for EEA/Swiss and UK data.
- Anthropic: public Anthropic privacy/help materials state that its commercial DPA includes SCCs and is incorporated into commercial terms.
- Kiwi Tequila API: Kiwi.com Privacy Policy reviewed at https://www.kiwi.com/en/pages/content/privacy/; Tequila/partner API documentation reviewed at https://tequila.kiwi.com/portal/docs and Kiwi partner materials. Jetly sends only route/date search parameters, never account identity.
- Duffel: Duffel Services Agreement reviewed at https://duffel.com/services-agreement; it includes a Data Processing Addendum for personal data processed for offering Travel Services and creating Orders.
- Travelpayouts affiliate: no active personal-data transfer is configured in the current environment; contract/DPA evidence must be collected before activation.

## Data Subject Rights and Vendor Requests
- Requests are received at privacy@flightsuite.app.
- Maximum response time to the data subject: 30 giorni.
- Processor assistance must be requested immediately where provider-held data is needed for access, erasure, or rectification.

Approved by: Stefano Giustini
Role: Founder
Date: 2026-05-04
