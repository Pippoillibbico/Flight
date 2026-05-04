# Data Breach Procedure (72h)

Last update: 2026-05-04  
Version: v1.1-final  
Owner: Security & Privacy Incident Response Team

Controller: Clariter Group  
Registered office: Via del Corso 101, 00186 Roma, Italia  
Privacy contact: privacy@flightsuite.app  
DPO contact: dpo@flightsuite.app  
Internal incident owner: Stefano Giustini, Founder

## Purpose
Define the incident response and GDPR notification workflow for suspected or confirmed personal data breaches.

## 1. Detection and Escalation
- Report channel: `#security-incidents` internal channel and incident ticketing queue.
- Immediate triage owner: Security On-Call Engineer.
- Privacy/legal owner: Stefano Giustini, Founder, with DPO contact dpo@flightsuite.app.
- Open incident ticket with unique incident ID.
- Record awareness timestamp. The 72h GDPR authority-notification clock starts from breach awareness, not from ticket closure.

## 2. Initial Triage
- Affected systems and data categories.
- Estimated number of impacted data subjects.
- Confidentiality, integrity, and availability impact.
- Whether processors or independent controllers are involved.
- Whether extra-EEA providers or SCC-covered transfers are implicated.
- Ongoing risk status and immediate containment action.

## 3. Containment
- Revoke compromised sessions, tokens, API keys, webhook secrets, and credentials.
- Isolate affected services/components.
- Apply temporary mitigations such as rate limits, endpoint blocks, fail-safe modes, or rollback.
- Preserve forensic evidence before destructive remediation where feasible.

### Technical command examples
- Emergency rollback: `npm run ops:rollback:one-click`
- Start production readiness checks before restore/re-open: `npm run release:prod:gate`
- Export local audit evidence window: `rg "incident|auth|export|backoffice" data/audit-log*.ndjson`
- Run security verification after containment: `npm run test:security:go-live:gate`

## 4. GDPR Risk Assessment
- Assess risk to rights and freedoms of data subjects.
- Consider data sensitivity, exposure duration, identifiability, mitigation, and likely consequences.
- Record rationale for notification/no-notification decision.
- If a processor is involved, request incident details and processor assistance immediately.

## 5. Authority Notification
- Notify the competent supervisory authority without undue delay and, where required, within 72 hours from awareness.
- Include known facts, likely consequences, affected categories, approximate numbers, containment/remediation, and contact point.
- If full facts are unavailable within 72 hours, send an initial notification and supplement later.

## 6. Data Subject Communication
- Communicate directly to affected data subjects without undue delay if the breach is likely to result in high risk.
- Use clear language and practical mitigation steps.
- Avoid speculative or unverified claims.
- Record communication content, timestamp, and delivery channel.

## 7. Data Subject Rights During Incident
- Requests for access, erasure, rectification, restriction, objection, portability, or consent withdrawal continue to be received at privacy@flightsuite.app.
- Maximum response time: 30 giorni from receipt, unless GDPR permits extension.
- Incident-related preservation/legal holds may temporarily restrict erasure where legally justified; the reason must be documented.

## 8. Investigation and Remediation
- Root cause analysis.
- Permanent remediation plan with owner and deadline.
- Validate controls post-fix.
- Update retention, logging, DPA, and transfer records if the incident reveals a documentation mismatch.

## 9. Closure and Lessons Learned
- Incident closure report.
- Update policies/runbooks/controls.
- Track preventive actions to completion.
- Retain incident evidence for 365 giorni unless legal hold requires longer retention.

## Evidence to Retain
- Timeline and decisions.
- Technical logs, redacted as needed.
- Scope analysis and impact estimates.
- Processor communications.
- Notifications sent and timestamps.
- Closure report and remediation evidence.

Approved by: Stefano Giustini
Role: Founder
Date: 2026-05-04
