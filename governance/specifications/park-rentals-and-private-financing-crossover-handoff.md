# FORGE Park Rentals — Deferred Product and Private Financing Crossover Handoff

## Status and priority

**Owner decision (2026-08-29): preserve Park Rentals as a future Rental Manager product expansion.**

This is a planning-awareness handoff, not an instruction to interrupt or expand the active FORGE Private
Financing assignment. Claude should read it during the current Private Financing architecture work only to
avoid hard-coding incompatible assumptions. Do not implement Park Rentals, modify Rental Manager for parks,
add migrations, or broaden the current checkpoint unless the owner explicitly activates this work.

Current priority remains completing the approved Private Financing checkpoints safely. After that work reaches
its owner-approved stopping point, inspect current repository reality and propose a separate Park Rentals
phase plan.

## Product opportunity

FORGE Rental Manager should eventually support:

1. Long-term manufactured/mobile-home parks.
2. Long-term RV parks.
3. Mixed parks with mobile-home lots, monthly RV sites, and park-owned rental homes.
4. A later transient RV/campground layer with reservations, check-in, and nightly/weekly stays.

The first Park Rentals release should focus on long-term monthly operations. Transient reservations are a
separate later product because they introduce hospitality-style availability, pricing, taxes, cancellations,
check-in/out, and site-turn workflows.

## Core park hierarchy

Repository inspection must determine how to extend the existing property/unit model without breaking ordinary
rentals. The conceptual hierarchy is:

- Park/property
- Space, site, lot, or park-owned home
- Occupancy agreement/lease
- Resident household
- Resident-owned or park-owned dwelling/RV
- Vehicles and authorized occupants

Required site concepts may include:

- mobile-home lot;
- long-term RV site;
- short-term RV site;
- park-owned manufactured home;
- mixed-use or other validated type;
- site number/name;
- occupancy status;
- hookup type and capacity;
- RV/manufactured-home dimensions where useful;
- utility meters;
- accessibility or site attributes.

Do not rename or rewrite existing Rental Manager records merely to support new display terminology. Prefer an
additive property/site classification and presentation layer after inspecting current schema reality.

## Ownership and obligation distinctions

The product must distinguish:

1. **Resident-owned home on rented lot** — lot rent and services only.
2. **Park-owned home** — home rent plus applicable lot/services as rental obligations.
3. **Seller-financed home on rented lot** — a Private Financing obligation plus a separate rental lot
   obligation.
4. **Transient RV occupancy** — reservation/stay charges, not a long-term lease by default.

These relationships may be shown together for convenience, but accounting and ledgers must remain separate:

- lot/home rent is rental income;
- utilities and services retain their own charge classifications;
- security deposits remain rental liabilities;
- financing principal reduces a note receivable;
- financing interest is interest income;
- financing concessions/credits and processor fees remain separate;
- no loan payment may enter rental NOI or rent-delinquency calculations;
- no lot-rent payment may reduce a financing balance.

## Private Financing crossover constraints to preserve now

The active Private Financing work should remain generic enough that a later park-owned or seller-financed
manufactured home can use it without redesigning the ledger. Preserve these boundaries:

- A financing account may optionally link to a property and, later, a site/space, but Personal Loans must
  remain valid with no property relationship.
- Do not assume every seller-financed property is a single-family house.
- Borrower identity remains separate from rental-tenant/resident identity.
- A future explicit relationship may connect the same authenticated person to both a borrower membership and
  a rental resident membership; do not merge the underlying records or permissions.
- The tenant/resident portal and borrower portal may later share a shell or consolidated obligations view,
  but each ledger keeps independent authorization and accounting.
- A combined payment experience may later accept lot rent and loan payment together only if it creates
  separately authorized, separately idempotent allocations and receipts. Failure in one obligation must not
  corrupt or partially disguise the other.
- External payments (Venmo, Cash App, Zelle, PayPal, cash, check, bank transfer, money order) may be recorded
  for either obligation only after seller/manager confirmation. A payer-submitted “I paid” notice never
  changes a balance by itself.
- Stripe or other processor fees never silently reduce the amount credited to the applicable obligation.
- Do not create a second processor account merely because obligations have different accounting
  classifications; processor-account architecture remains a separately verified decision.

Reading this section during Private Financing work does not authorize changes for parks. If a current schema
choice would prevent these boundaries, flag it for owner review; otherwise keep Park Rentals deferred.

## Long-term Park Rentals requirements

### Flexible recurring charges

A resident statement may include:

- lot rent;
- park-owned home rent;
- water;
- sewer;
- electricity;
- trash;
- cable/internet or other service;
- pet charge;
- additional vehicle charge;
- storage or amenity charge;
- prior balance;
- seller-approved credit or correction.

Charges must remain separately classified. Partial and extra payments require an explicit, explainable
allocation policy. Nothing may disappear into an undifferentiated “rent” total.

### Metered utilities

Potential requirements:

- meter identifier;
- utility type;
- previous/current reading;
- reading and service-period dates;
- consumption;
- unit/rate structure;
- meter photograph;
- actual versus estimated reading;
- correction/reversal;
- owner-provided versus third-party utility;
- borrower/resident-visible explanation.

Utility billing, submetering, rate pass-through, disclosures, and local legality require later jurisdictional
review. Do not assume every park may rebill every utility in the same way.

### Resident, dwelling, RV, and vehicle information

Support only information needed for operations:

- authorized residents;
- emergency and contact data following existing privacy rules;
- resident-owned versus park-owned home;
- manufactured-home/RV make, model, year, size, identifiers where justified;
- vehicle and parking authorization;
- pets;
- insurance requirements;
- park-rule acknowledgments;
- move-in/site condition evidence.

Minimize sensitive data. Do not introduce full SSNs or unnecessary birth dates.

### Operational workflows

Potential guided workflows include:

- prepare a vacant site;
- onboard a resident-owned home;
- onboard a park-owned rental home;
- set recurring lot and utility charges;
- record meter readings;
- review unpaid obligations;
- manage move-in/move-out;
- record external payment;
- reconcile combined lot-rent and financing obligations without mixing ledgers.

Reuse the Guided Workflow Engine only after repository inspection. Guidance must never autonomously post a
charge, payment, adjustment, financing event, or lease change.

## Later transient RV/campground layer

Defer the following to a separate phase:

- availability calendar;
- online reservations;
- nightly, weekly, monthly, seasonal, and event rates;
- reservation deposits;
- cancellation/refund rules;
- check-in/check-out;
- site transfers during a stay;
- occupancy and RV-size constraints;
- hookup compatibility;
- taxes and tourism charges;
- housekeeping/site-turn tasks;
- channel/booking integrations.

Do not force transient stays into long-term lease semantics merely to reuse existing screens.

## Future inspection phase: PR-0

When the owner activates Park Rentals, begin with read-only inspection and return:

1. Current Rental Manager property/unit/lease/tenant/charge/payment schema and UI reality.
2. Existing property-type and unit-type extensibility.
3. How recurring rent schedules can or cannot represent itemized park charges.
4. Current utilities, meters, vehicles, pets, insurance, inspections, documents, and portal capabilities.
5. Payment allocation, external-payment, receipt, reconciliation, and accounting reuse points.
6. Private Financing linkage points after its then-current implementation.
7. Primary-owner, co-owner, manager, bookkeeper, read-only, resident, and borrower authorization boundaries.
8. Long-term park MVP versus transient-RV scope.
9. Required jurisdictional review for utility rebilling, fees, deposits, park rules, and transient taxes.
10. Smallest proposed implementation slices, migrations, tests, and live-verification plan.

Stop for owner review after PR-0. Do not commit, push, merge, deploy, migrate, or touch Production without the
owner's explicit instruction for each action.
