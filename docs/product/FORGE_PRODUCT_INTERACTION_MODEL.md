# FORGE Product Interaction Model

**Status:** Foundational Draft

## Purpose

The Product Interaction Model defines how FORGE product domains collaborate to deliver end-to-end customer workflows.

While the Product Domain Model defines ownership boundaries, this document describes how information, decisions, and workflows flow between domains.

---

# Guiding Principles

- Domains own business responsibilities.
- Domains collaborate through shared capabilities.
- Customer workflows may span multiple domains.
- Data should be captured once and reused.
- AI should understand domain ownership before making recommendations.

---

# Domain Relationships

```
                        FORGE Platform
                               │
     ┌─────────────────────────┼─────────────────────────┐
     │                         │                         │
Business Ops            Financial Ops             Marketplace
     │                         │                         │
     └──────────────┬──────────┴──────────┬──────────────┘
                    │                     │
            Rental Operations      Property Intelligence
                    │                     │
                    └──────────┬──────────┘
                               │
                    Industrial Asset Management
                               │
                    Enterprise Asset Management
                               │
                 Maintenance & Reliability
                               │
                       Project Controls
                               │
                      Capital Projects
                               │
                   Decision Intelligence
                               │
                           FORGE OS
```

---

# Customer Workflow Philosophy

Customers should experience one unified platform.

Internal domain boundaries should organize engineering rather than create disconnected user experiences.

---

# Shared Information

Information commonly shared between domains includes:

- Customer identity
- Organization
- Financial events
- Assets
- Properties
- Vendors
- Contractors
- Work history
- Maintenance history
- Documents
- Budgets
- Schedules
- Risks
- KPIs

---

# Cross-Domain Examples

## Rental Operations

Uses:

- Financial Operations
- Property Intelligence
- Marketplace
- Decision Intelligence
- FORGE OS

---

## Industrial Asset Management

Uses:

- Enterprise Asset Management
- Maintenance & Reliability
- Project Controls
- Capital Projects
- Decision Intelligence
- FORGE OS

---

## Capital Projects

Uses:

- Financial Operations
- Project Controls
- Marketplace
- Maintenance & Reliability
- Decision Intelligence
- FORGE OS

---

# Decision Intelligence

Decision Intelligence is intentionally cross-domain.

It should combine information from every participating domain to generate explainable recommendations.

---

# FORGE OS

FORGE OS coordinates intelligent execution across every product domain.

FORGE OS does not own business workflows.

It owns:

- orchestration;
- AI coordination;
- runtime governance;
- context evolution;
- evidence;
- execution lifecycle.

---

# Future Evolution

As additional domains are introduced, they should integrate through this interaction model rather than creating isolated workflows.

The objective is one connected platform composed of clearly owned domains.
