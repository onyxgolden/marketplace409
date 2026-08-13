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
| Lease and rent schedule | Lifecycle and preparation controls implemented | Draft lease, activation, monthly schedule, effective-date guards, idempotent charge generation, auditable renewals/amendments, dated replacement schedules, and separately labeled proration charges exist. Structured business terms can be edited into immutable versions, owner-approved, and exposed to tenants for review. FORGE does not generate or reproduce a Texas REALTORS® form; legal execution still requires a licensed approved-forms integration or a separately attorney-reviewed FORGE template and compliant e-signature provider. |
| Online rent payments | Working Stripe sandbox slice | Card/ACH-capable Payment Element, connected landlord account, webhook reconciliation, balances, and payment history are proven in sandbox. Production credentials and operating procedures remain. |
| Offline payments | Working owner slice | Cash and cashier's-check recording exists. Receipt delivery and deposit reconciliation remain. |
| Maintenance requests | Implemented in this change | Tenant intake, priority, permission to enter, owner notes, and status tracking. Photos, vendors, appointments, costs, and notifications are next. |
| Renters insurance | Data foundation / visible placeholder | Requirement, policy, referral, and tenant-display foundations exist. Upload, verification, renewal reminders, and compliant provider activation remain. |
| Pet liability and pet fees | Data foundation / visible placeholder | Animal, policy, monthly fee, and assistance-animal human-review foundations exist. Owner workflow and verified tenant controls remain. |
| Credit reporting | Data foundation / not active | Enrollment and fee foundations exist. No provider is activated and the portal correctly says unavailable. |
| Lease documents / file library | Secure delivery and receipt implemented | Private uploads, lease scoping, explicit publication, signed downloads, tenant viewing, and first-receipt acknowledgement exist. Version history, e-signature, and provider delivery evidence remain. |
| Tenant communications | Auditable outbox foundation | Payment outcomes, maintenance updates, and document publication queue idempotent email messages for owner review. Provider delivery, reminders, retries, delivery history, and opt-out controls remain. |
| Recurring autopay | Missing | One-time Stripe payments work. Tenant consent, mandate management, saved payment methods, retry controls, and cancellation are required. |
| Late fees and delinquency | Manual assessment control implemented | Owner records jurisdiction, rule source, grace period, calculation, and cap; FORGE checks charge eligibility and requires explicit approval for each separately labeled fee. Texas legal review, notices, waivers, reversals, and automated delinquency sequences remain. |
| Deposits | Liability ledger implemented | Required amount, held balance, receipts, documented deductions, refunds, adjustments, evidence references, jurisdiction, and disposition dates are separated from rent/NOI. Legal deadline evaluation and bank reconciliation remain human-controlled. |
| Applications and screening | Missing | Listing/application intake, consent, screening-provider integration, adverse-action workflow, and fair-housing controls are required. |
| Vacancy marketing | Missing | Listings, syndication, inquiries, showing workflow, and application handoff are required. |
| Inspections | Structured workflow implemented | Move-in, move-out, and periodic room/area templates, condition and damage evidence, document references, estimates, final publication, and receipt-only tenant acknowledgement exist. Side-by-side change comparison, photo capture convenience, signatures, and jurisdiction-specific disposition guidance remain. |
| Accounting and bank reconciliation | Gross rent posting implemented | Succeeded payments post idempotently to property-scoped rental income and the owner sees unreconciled Stripe payments. Processor fees, balance transactions, payout matching, refunds, disputes, and deposit accounting remain. |
| Reports and tax support | Rent roll and ledger implemented | Owner reporting shows scheduled rent, collections, balances, occupancy, tenant ledger rows, and CSV export. Future scope explicitly includes printable accountant transaction packages, property/year filters, contractor W-9 records, payment totals, 1099 eligibility review, 1099 preparation/delivery/filing history, and invoice/work evidence. Owner statements and complete tax packages remain. |
| Owner portal / trust accounting | Out of first-landlord gate | Needed for third-party property management, not for the initial owner-operated property. Requires trust-account and client-money controls before activation. |
| Mobile access | Responsive web only | Native mobile applications and push notifications do not exist. Responsive portal remains the first target. |
| API and integrations | Shared FORGE strength | Connector architecture exists; rental-specific provider contracts and public API permissions remain. |

## Implementation Order

### Gate A — First real tenant

1. Maintenance request intake and owner workflow.
2. Complete document version history, approved email delivery evidence, and a separate compliant e-signature integration.
3. Activate approved email delivery, retries, reminders, and failed-payment operating controls on the receipt/outbox foundation.
4. Complete Stripe fee/balance/payout ingestion and bank matching on the gross-income posting foundation.
5. Production Stripe readiness, support procedures, and controlled pilot.

### Gate B — Reliable landlord replacement

1. Recurring autopay and reminders.
2. Deposits and move-in/move-out inspections.
3. Lease renewals, amendments, prorating, and jurisdiction-controlled late fees.
4. ~~Vendor assignment, work scheduling, costs, photos, and maintenance history.~~ Implemented with an owner-only contractor/W-9 readiness directory, work orders, appointment windows, public/private history, cost tracking, and invoice/completion document evidence. Contractor payout reconciliation and 1099 production remain in the reporting/tax backlog.
5. Tenant ledger, rent roll, delinquency, and tax-ready reports.

### Gate C — Leasing and portfolio growth

1. Vacancy marketing and applications.
2. Tenant screening with consent and adverse-action controls.
3. Co-tenants, household members, and role-based access.
4. Multi-property automation, bulk operations, and mobile notifications.
5. Owner portal and trust accounting only if FORGE manages property for third parties.

## Product Rule

Visible placeholders must state that they are unavailable. Features involving screening, insurance referrals, credit reporting, deposits, late fees, assistance animals, or trust funds require explicit legal/compliance review and human-controlled activation.
