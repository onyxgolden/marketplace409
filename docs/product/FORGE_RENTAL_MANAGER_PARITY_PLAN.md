# FORGE Rental Manager Parity Plan

**Updated:** 2026-08-12  
**Goal:** Safely replace the current property-management platform for the first FORGE-managed rental, then expand without overstating incomplete capabilities.

## Replacement Gate

FORGE is ready for a real tenant only when the complete operating loop is proven with production credentials and real-dollar controls:

1. owner and tenant identity isolation;
2. executed lease and rent schedule;
3. rent charge generation and payment reconciliation;
4. receipts, balances, and payment history;
5. maintenance intake and owner follow-through;
6. lease/document delivery;
7. notifications and auditable communication;
8. accounting reconciliation and export;
9. support, incident, refund, and failed-payment procedures.

## Capability Matrix

| Capability | FORGE state | Evidence / next boundary |
| --- | --- | --- |
| Property and unit records | Working sandbox slice | Owner-scoped unit persistence and lease relationship exist. Portfolio-scale editing and vacancy state transitions need expansion. |
| Tenant records and portal identity | Working sandbox slice | Invitation email claim, authenticated tenant portal, and route-level landlord/tenant separation are implemented. Co-tenants and household roles remain. |
| Lease and rent schedule | Working sandbox slice | Draft lease, activation, monthly schedule, effective-date guards, and idempotent charge generation exist. Renewal, amendments, deposits, prorating, and late-fee rules remain. |
| Online rent payments | Working Stripe sandbox slice | Card/ACH-capable Payment Element, connected landlord account, webhook reconciliation, balances, and payment history are proven in sandbox. Production credentials and operating procedures remain. |
| Offline payments | Working owner slice | Cash and cashier's-check recording exists. Receipt delivery and deposit reconciliation remain. |
| Maintenance requests | Implemented in this change | Tenant intake, priority, permission to enter, owner notes, and status tracking. Photos, vendors, appointments, costs, and notifications are next. |
| Renters insurance | Data foundation / visible placeholder | Requirement, policy, referral, and tenant-display foundations exist. Upload, verification, renewal reminders, and compliant provider activation remain. |
| Pet liability and pet fees | Data foundation / visible placeholder | Animal, policy, monthly fee, and assistance-animal human-review foundations exist. Owner workflow and verified tenant controls remain. |
| Credit reporting | Data foundation / not active | Enrollment and fee foundations exist. No provider is activated and the portal correctly says unavailable. |
| Lease documents / file library | Implemented secure first slice | Private uploads, lease scoping, explicit tenant publication, signed downloads, and tenant viewing exist. Version history, acknowledgement, e-signature, and delivery notices remain. |
| Tenant communications | Auditable outbox foundation | Payment outcomes, maintenance updates, and document publication queue idempotent email messages for owner review. Provider delivery, reminders, retries, delivery history, and opt-out controls remain. |
| Recurring autopay | Missing | One-time Stripe payments work. Tenant consent, mandate management, saved payment methods, retry controls, and cancellation are required. |
| Late fees and delinquency | Missing | Requires jurisdiction-aware rules, grace periods, notices, waiver controls, and audit history. Must never be inferred silently. |
| Deposits | Missing | Security-deposit ledger, permitted deductions, disposition deadlines, evidence, and reconciliation are required. |
| Applications and screening | Missing | Listing/application intake, consent, screening-provider integration, adverse-action workflow, and fair-housing controls are required. |
| Vacancy marketing | Missing | Listings, syndication, inquiries, showing workflow, and application handoff are required. |
| Inspections | Partial outside rental workspace | Property condition/HVAC evidence foundations exist. Move-in, move-out, periodic inspection templates and tenant acknowledgement remain. |
| Accounting and bank reconciliation | Strong shared FORGE foundation, not fully joined | Financial events, imports, transactions, and property performance exist. Rental payment/fee/deposit posting and bank settlement reconciliation need a formal bridge. |
| Reports and tax support | Partial shared foundation | Property financial reporting exists. Tenant ledger, rent roll, delinquency, deposit liability, owner statement, 1099, and tax packages remain. |
| Owner portal / trust accounting | Out of first-landlord gate | Needed for third-party property management, not for the initial owner-operated property. Requires trust-account and client-money controls before activation. |
| Mobile access | Responsive web only | Native mobile applications and push notifications do not exist. Responsive portal remains the first target. |
| API and integrations | Shared FORGE strength | Connector architecture exists; rental-specific provider contracts and public API permissions remain. |

## Implementation Order

### Gate A — First real tenant

1. Maintenance request intake and owner workflow.
2. Complete document acknowledgements, delivery notices, and version history on the secure lease library.
3. Activate approved email delivery, retries, reminders, and failed-payment operating controls on the receipt/outbox foundation.
4. Rental-to-financial posting and settlement reconciliation.
5. Production Stripe readiness, support procedures, and controlled pilot.

### Gate B — Reliable landlord replacement

1. Recurring autopay and reminders.
2. Deposits and move-in/move-out inspections.
3. Lease renewals, amendments, prorating, and jurisdiction-controlled late fees.
4. Vendor assignment, work scheduling, costs, photos, and maintenance history.
5. Tenant ledger, rent roll, delinquency, and tax-ready reports.

### Gate C — Leasing and portfolio growth

1. Vacancy marketing and applications.
2. Tenant screening with consent and adverse-action controls.
3. Co-tenants, household members, and role-based access.
4. Multi-property automation, bulk operations, and mobile notifications.
5. Owner portal and trust accounting only if FORGE manages property for third parties.

## Product Rule

Visible placeholders must state that they are unavailable. Features involving screening, insurance referrals, credit reporting, deposits, late fees, assistance animals, or trust funds require explicit legal/compliance review and human-controlled activation.
