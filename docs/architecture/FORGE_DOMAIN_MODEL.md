# Forge Domain Model

**Version:** 1.0  
**Status:** Active  
**Project:** Financial Forge

---

# Purpose

The Forge Domain Model defines how Financial Forge separates domains, providers, adapters, operational activity, and accounting truth.

FORGE is an operational intelligence platform built on an immutable financial core.

---

# Core Truth Rule

The Ledger records financial truth.

Operational domains record business activity.

Providers supply data.

Adapters translate provider data into FORGE-owned domain objects.

Reports present truth.

The UI displays results.

---

# Provider Versus Domain

Providers are external systems.

Examples:

* Plaid
* Stripe
* Rentec
* CSV files
* Banks
* GPS systems
* Email systems
* ELD systems
* Mileage apps
* Payment processors

Domains are FORGE-owned business models.

Examples:

* Connection
* Business
* Risk
* Property
* Activity
* Vehicle
* Financial Event
* Ledger
* Tax
* Document
* CRM
* Inventory
* Compliance

Providers adapt to domains.

Domains never adapt to providers.

---

# Operational Truth Versus Financial Truth

Operational truth includes:

* Trips
* Inspections
* Meetings
* Maintenance
* Receipts
* Documents
* Communications
* AI observations

Financial truth includes:

* Financial Events
* Journal Entries
* Ledger balances
* Financial reports

Operational activity may enrich accounting, tax, analytics, automation, and reporting.

Operational activity is never accounting truth.

---

# Activity Model

Activity represents real-world business actions.

Examples:

* A landlord inspects a rental property.
* A contractor visits a customer.
* A truck travels through multiple states.
* A technician performs maintenance.
* A business owner uploads a receipt.
* An AI system observes a business event.

Activity can later support mileage deduction, IFTA reporting, IRP mileage allocation, property history, maintenance records, CRM history, tax documentation, risk intelligence, and automation.

Activity is not a ledger entry.

Activity may produce or enrich financial events.

---

# Speculative Schema Rule

Future capabilities belong in documentation before they belong in production schemas.

Do not add columns, tables, foreign keys, or persistence models merely because a future feature might need them.

A new domain enters implementation only after:

1. The business language is understood.
2. The domain boundary is documented.
3. The implementation objective is approved.
4. The first useful object can be built and tested.

Speculative schema design is prohibited.

---

# Current Rule

Do not implement the Activity domain yet.

Complete the ConnectionProviderRegistry first.

Then complete provider adapters.

Then ingest real-world data.

Only after real operational patterns emerge should FORGE implement the Activity domain.
---

# Architectural Evaluation Checklist

Before introducing any new capability, ask:

1. Is this a provider or a FORGE domain?
2. Is this financial truth or operational truth?
3. Does this belong in an existing domain?
4. Should a new domain be created?
5. Can the idea be documented before implementation?
6. Does the implementation preserve domain independence?
7. Does it reduce or increase long-term technical debt?

The objective is not to build features quickly.

The objective is to build durable architecture that can support decades of evolution.
