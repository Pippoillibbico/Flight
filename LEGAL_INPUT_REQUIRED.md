# Legal Input Required (External to Code)

Last updated: 2026-04-03  
Scope: only residual items that cannot be closed by engineering changes alone.

| TODO Code | Description | Why External Input Is Required | Owner | Impact If Missing |
|---|---|---|---|---|
| `LEGAL_INPUT_REQUIRED[controller_identity]` | Final legal controller identity (registered company name, address, DPO/contact) for published policies. | Engineering cannot legally certify entity details. | Legal + Founder/Admin | Privacy policy and terms remain incomplete and legally weak. |
| `LEGAL_INPUT_REQUIRED[processors_registry]` | Definitive processor/subprocessor list, jurisdictions, and DPA/SCC references. | Requires contractual/vendor legal documentation and legal review. | Legal + Security/Procurement | Incomplete transparency obligations and weak compliance evidence. |
| `LEGAL_INPUT_REQUIRED[retention_signoff]` | Legal sign-off of retention durations configured in env and policy tables. | Retention legality depends on jurisdiction, contractual obligations, and business records requirements. | Legal + Data Owner + Founder/Admin | Risk of over-retention/under-retention and policy mismatch. |
| `LEGAL_INPUT_REQUIRED[international_transfers]` | Transfer mechanism per non-EEA processor (adequacy/SCC/other basis). | Requires legal basis mapping by vendor and geography. | Legal | Cross-border transfer section remains non-definitive. |
| `LEGAL_INPUT_REQUIRED[billing_terms]` | Subscription legal terms: cancellations, refunds, withdrawal rights, jurisdictional consumer rights. | Product/business policy decision plus legal drafting required. | Legal + Business/Founder | Monetization terms not enforceable and customer dispute risk rises. |
| `LEGAL_INPUT_REQUIRED[liability_and_indemnity]` | Final limitation of liability and indemnity clauses. | Requires counsel-approved contract language. | Legal | Terms lack core risk-allocation clauses. |
| `LEGAL_INPUT_REQUIRED[governing_law_and_venue]` | Governing law, venue, and mandatory consumer-law carve-outs. | Must be legally defined by operating entity and target markets. | Legal + Founder/Admin | Enforcement uncertainty and jurisdictional risk. |

## Notes
- These items are intentionally kept explicit in `server/lib/legal-pages.js`.
- They are not technical debt; they are legal/business dependencies.
