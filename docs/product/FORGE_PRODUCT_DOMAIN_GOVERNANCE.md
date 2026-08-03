# FORGE Product Domain Governance

**Status:** Foundational Draft

## Purpose

The Product Domain Governance model establishes ownership, responsibilities, decision authority, and collaboration rules for every FORGE product domain.

This document ensures every capability has a canonical owner while encouraging reuse through well-defined interfaces.

---

# Governance Principles

1. Every business capability belongs to a primary domain.
2. Every domain has a designated product owner.
3. Cross-domain collaboration is preferred over duplicated functionality.
4. Shared capabilities remain reusable but retain clear ownership.
5. Engineering implementation follows approved product ownership.
6. AI agents must respect domain ownership when proposing or implementing changes.

---

# Domain Ownership Matrix

| Domain | Primary Responsibility | Examples |
|---------|------------------------|----------|
| Financial Operations | Financial workflows | Transactions, budgets, reporting |
| Rental Operations | Property lifecycle | Units, leases, tenants |
| Business Operations | Internal business management | CRM, vendors, purchasing |
| Marketplace | External providers | Contractors, suppliers, incentives |
| Property Intelligence | Property knowledge | Property Passport, Asset Passport |
| Industrial Asset Management | Industrial assets | Equipment, maintenance planning |
| Enterprise Asset Management | Enterprise lifecycle | Preventive maintenance, compliance |
| Project Controls | Planning and execution | Cost, schedule, forecasting |
| Construction Management | Field execution | RFIs, submittals, punch lists |
| Maintenance & Reliability | Asset performance | PM, PdM, RCA |
| Capital Projects | Major investments | Stage gates, commissioning |
| Decision Intelligence | Cross-domain insights | Recommendations, dashboards |
| Education | Customer enablement | Academy, learning |
| FORGE OS | Runtime execution | Orchestration, governance, evidence |

---

# Cross-Domain Rules

When work spans multiple domains:

- The originating domain owns the business outcome.
- Supporting domains provide reusable capabilities.
- Shared information should not be duplicated.
- Interfaces should remain explicit.

---

# AI Governance

AI workers should:

- identify the owning domain before making recommendations;
- avoid introducing duplicate capabilities;
- preserve domain boundaries;
- document cross-domain dependencies;
- support governance with evidence.

---

# Future Evolution

As FORGE grows, every new domain should be added to this governance model before major implementation begins.

---

# Authority Boundaries

Domain ownership does not imply authority over every related capability.

Each domain owns its primary business responsibilities while respecting the authority of other domains.

Examples:

| Domain | Owns | Does Not Own |
|---------|------|--------------|
| Financial Operations | Financial records, reporting, budgeting | Project schedules, maintenance planning |
| Project Controls | Cost forecasting, progress, earned value | Accounting ledger, banking |
| Maintenance & Reliability | Maintenance strategies, PM/PdM, reliability | Financial reporting |
| Decision Intelligence | Cross-domain analysis and recommendations | Business data ownership |
| FORGE OS | Runtime execution, orchestration, governance | Product business rules |

When multiple domains participate in one workflow:

- Each domain remains authoritative for its own information.
- Shared capabilities expose interfaces rather than transferring ownership.
- Cross-domain recommendations never change authoritative business data without approval.
