# Cookie Policy

Last update: 2026-05-04  
Version: v1.1-final  
Owner: Privacy Office - Flight Suite

## 1. Controller and Contact
Controller: Clariter Group  
Registered office: Via del Corso 101, 00186 Roma, Italia  
Privacy contact: privacy@flightsuite.app  
DPO contact: dpo@flightsuite.app  
Internal privacy owner: Stefano Giustini, Founder

## 2. What Cookies and Local Storage Are
Cookies and local storage are browser-side technologies used to support website functionality, authentication, security, preferences, and, where consented, analytics or personalization.

## 3. Categories Used
- `necessary`: required for security, authentication, CSRF/session handling, consent proof, and core service operation. Always active.
- `functional`: local preferences and state persistence. Active only after consent.
- `analytics`: telemetry/funnel tracking and product measurement. Active only after consent.

Marketing cookies are not active in the current implementation unless a future provider is configured and documented before activation.

## 4. Legal Basis
- Necessary cookies/storage: contract performance and legitimate interest in secure operation.
- Functional and analytics cookies/storage: consent.

## 5. Consent Management
- Consent is collected through banner controls: accept, reject, customize.
- Consent preferences are stored with timestamp, schema version, and selected categories.
- Users can modify or revoke consent at any time through in-app cookie settings.
- Revocation removes disallowed functional/analytics local storage keys immediately where technically possible.

## 6. Third-Party Cookies and Transfers
The current codebase does not enable a third-party marketing cookie provider by default.  
Third-party technologies may be used only when the provider is listed in `docs/privacy/dpa-fornitori.md`, the relevant DPA/SCC review is complete, and the user has provided any required consent.

## 7. Retention
- Consent proof: retained until consent is changed, cleared, or the user requests erasure.
- Necessary session cookies: retained only for the configured session/auth period.
- Functional storage: retained until user deletion, consent revocation, or local browser clearing.
- Analytics storage/events: 180 giorni where consented, unless earlier deletion is requested.

## 8. How to Exercise Rights
Users can request access, erasure, rectification, restriction, portability, objection, or consent withdrawal by emailing privacy@flightsuite.app.  
Requests are answered within 30 giorni from receipt, unless GDPR permits an extension for complex requests.

## 9. Updates
This policy is versioned and may be updated as services or legal requirements evolve.

Approved by: Stefano Giustini
Role: Founder
Date: 2026-05-04
