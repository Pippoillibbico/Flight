# DPA Fornitori - Register

Last update: 2026-05-04  
Version: v1.1-final  
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
| Google OAuth | Not active in current env (`GOOGLE_CLIENT_ID(S)` empty) | Titolare autonomo for Google account service; possible Responsabile for limited processing depending terms | OAuth identifiers, email/profile if enabled | optional login | N/A until activated | NO - not active | NO - not active | Activation blocked until role/transfer review completed |
| Internal analytics datastore | Active only for server-side/internal telemetry | Trattamento interno del Titolare | pseudonymous events, funnel data, consent state | analytics prodotto | EU/Italy current runtime | N/A | N/A | Consent required for non-necessary analytics |
| Duffel | Not active for transfer (`DUFFEL_API_KEY` empty) | Not active; planned role before activation: Responsabile for API/order processing under Duffel DPA | search/booking metadata if enabled | flight provider integration | UK | NO - not active | NO - not active | Duffel DPA/UK transfer addendum publicly available; execute/archive before sending personal data |
| Travelpayouts / Kiwi affiliate layer | Not active for identified transfer (`AFFILIATE_TRAVELPAYOUTS_MARKER` empty) | Not active; planned role before activation: Titolare autonomo for destination/affiliate service after outbound click | outbound click metadata if enabled | affiliate redirect/booking | to be verified before activation | NO - not active | NO - not active | Contract pack required before transmitting personal data |
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
- OpenAI: public OpenAI DPA includes SCC-based transfer terms for EEA/Swiss and UK data.
- Anthropic: public Anthropic privacy/help materials state that its commercial DPA includes SCCs and is incorporated into commercial terms.
- Duffel: public Duffel Services Agreement includes a Data Processing Addendum for order/travel-services processing.
- Travelpayouts/Kiwi: no active personal-data transfer is configured in the current environment; contract/DPA evidence must be collected before activation.

## Data Subject Rights and Vendor Requests
- Requests are received at privacy@flightsuite.app.
- Maximum response time to the data subject: 30 giorni.
- Processor assistance must be requested immediately where provider-held data is needed for access, erasure, or rectification.

Approved by: Stefano Giustini
Role: Founder
Date: 2026-05-04
