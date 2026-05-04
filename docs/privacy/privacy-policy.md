# Privacy Policy

Last update: 2026-05-04  
Version: v1.1-final  
Owner: Privacy Office - Flight Suite

This document is approved for go-live publication.

## 1. Data Controller
Controller: Clariter Group  
Registered office: Via del Corso 101, 00186 Roma, Italia  
Privacy contact: privacy@flightsuite.app  
DPO contact: dpo@flightsuite.app  
Internal privacy owner: Stefano Giustini, Founder

## 2. Scope
This policy applies to the SaaS web application Flight Suite, including user accounts, flight discovery, alerts, billing, admin backoffice, consent management, security logging, and optional AI-assisted features where enabled.

## 3. Personal Data Categories
- Account and identity data: name, email, authentication identifiers.
- Security data: login/session metadata, security event logs, pseudonymized IP/user-agent hashes where applicable.
- Service usage data: searches, watchlist entries, alert preferences, interaction metadata.
- Consent data: consent categories, policy version, timestamp, proof records.
- Billing-related data: Stripe customer, subscription, checkout, invoice, and payment references. Full card data is processed by Stripe and is not stored by Flight Suite.
- Support/admin audit data: admin access and actions for accountability.
- Optional AI data: minimized prompts and outputs only when an AI feature is enabled and requested.

## 4. Purposes and Legal Bases
- Account creation, authentication, and service delivery: contract performance.
- Flight search, discovery, saved routes, watchlist, and alerts: contract performance.
- Platform security, fraud prevention, abuse detection, auditability: legitimate interest.
- Billing, subscription management, invoices, and payment status: contract performance and legal obligation where applicable.
- Optional analytics, marketing, personalization: consent.
- Service emails and operational notifications: contract performance and/or legitimate interest.
- Optional AI features requested by the user: contract performance for requested functionality; any non-necessary processing only where a lawful basis exists.

## 5. Recipients, Roles, and Processors
The current provider matrix is maintained in `docs/privacy/dpa-fornitori.md`.

Summary:
- Internal self-managed application, database, Redis, and audit stores: Clariter Group acts as Data Controller.
- Stripe: independent Data Controller for regulated payment processing and Data Processor for limited processing performed under Stripe DPA.
- Email/SMTP, Google OAuth, Duffel, Travelpayouts, OpenAI, and Anthropic: not active for personal-data transfer unless configured with production credentials and a completed DPA/SCC review.
- Server-side analytics and telemetry: internal processing controlled by Clariter Group and gated by consent where non-necessary.

## 6. International Transfers
No extra-EEA transfer is permitted for a provider unless it is listed in the DPA register with country, DPA status, SCC/transfer safeguard status, and activation state.  
Where a provider processes data outside the EEA/UK, transfers must rely on applicable safeguards such as SCCs, UK IDTA/Addendum where relevant, and supplementary measures where required.

## 7. Retention
Data is retained only for the period necessary for each purpose and in line with `docs/privacy/data-retention-policy.md`.

Current go-live retention highlights:
- Auth/session/security events: 90 giorni.
- Client telemetry and consented analytics: 180 giorni.
- Outbound/click tracking events: 180 giorni.
- Search history: 180 giorni or earlier user deletion.
- Error/application logs: 90 giorni.
- Encrypted backups: 30 giorni.
- Billing records: 10 anni for accounting/tax compliance where legally required.

## 8. Data Subject Rights
Users may request access, rectification, erasure, restriction, portability, objection, and consent withdrawal by email to privacy@flightsuite.app.

Operational SLA:
- Identity and scope verification: as soon as reasonably possible after receipt.
- Response deadline: 30 giorni from receipt, unless GDPR permits an extension for complex requests.
- Access/export: handled through the data export workflow and internal support process.
- Erasure/account deletion: handled through account deletion and backend purge/anonymization procedures, subject to legal retention overrides.
- Rectification: handled through account/profile correction or support-assisted update.

Users may also lodge a complaint with the competent supervisory authority, including the Garante per la Protezione dei Dati Personali in Italy where applicable.

## 9. Automated Processing
The service may use automated scoring/ranking features to improve recommendations.  
No statement here should be interpreted as a guarantee that any automated output is complete, final, or legally binding.

## 10. Security
The platform applies technical and organizational controls designed to reduce confidentiality, integrity, and availability risks, including access control, logging, hardening, consent enforcement, redaction, and incident response processes.

## 11. Updates
This policy may be updated. Material updates are versioned and dated.

Approved by: Stefano Giustini
Role: Founder
Date: 2026-05-04
