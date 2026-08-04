# FORGE Platform Capabilities

**Status:** Foundational Draft

## Purpose

Define the canonical capability catalog for the FORGE platform.

This document identifies:

- what FORGE can do;
- which product domain owns each capability;
- how capabilities are reused across domains;
- how product architecture connects to research, roadmaps, customer journeys, engineering architecture, and FORGE OS execution.

Every capability, roadmap item, customer journey, research initiative, engineering effort, and AI work assignment should map to one or more capabilities defined in this catalog.

---

## Depends On

- `FORGE_NORTH_STAR.md`
- `FORGE_PRODUCT_CONSTITUTION.md`
- `FORGE_PRODUCT_OPERATING_SYSTEM.md`
- `FORGE_VISION_MAP.md`
- `FORGE_PRODUCT_DOMAIN_MODEL.md`
- `FORGE_PRODUCT_DOMAIN_GOVERNANCE.md`
- `FORGE_PRODUCT_INTERACTION_MODEL.md`

---

## Referenced By

- Product research
- Product architecture
- Product roadmap
- Customer journeys
- Product decisions
- Engineering architecture
- Repository gap analysis
- AI-worker assignments
- Validation evidence
- Production-readiness reviews

---

# Capability Architecture

FORGE capabilities follow this hierarchy:

    Product Domain
        ↓
    Capability Area
        ↓
    Capability
        ↓
    Feature

## Product Domain

A major business responsibility within the FORGE platform.

Examples:

- Financial Operations
- Rental Operations
- Project Controls
- Maintenance & Reliability

## Capability Area

A coherent group of related capabilities within a product domain.

Examples:

- Banking
- Lease Management
- Cost Management
- Work Management

## Capability

A reusable business ability owned by one canonical product domain.

Examples:

- Bank Connection Management
- Rent Collection
- Cost Forecasting
- Preventive Maintenance

## Feature

A specific user-facing or system-facing implementation of a capability.

Examples:

- Connect a financial account.
- Generate a rent invoice.
- Calculate estimate at completion.
- Create a preventive-maintenance schedule.

---

# Capability Governance

## Canonical Ownership

Every capability has exactly one canonical owning domain.

The owning domain is responsible for:

- business rules;
- product requirements;
- authoritative information;
- capability evolution;
- customer outcomes;
- validation expectations;
- cross-domain interfaces.

Supporting domains may consume a capability through explicit interfaces but do not duplicate its canonical ownership.

## Cross-Domain Consumption

A domain may consume a capability owned by another domain.

Examples:

- Rental Operations consumes Financial Operations for payments and reporting.
- Project Controls consumes Financial Operations for actual costs.
- Maintenance & Reliability consumes Enterprise Asset Management for asset and work records.
- Capital Projects consumes Project Controls for cost, schedule, progress, and forecasting.
- Decision Intelligence consumes authoritative information from every business domain.
- FORGE OS executes governed workflows without owning product-domain business rules.

## Shared Capabilities

A capability may be reused by many domains while retaining one canonical owner.

Shared use does not transfer ownership.

## AI Authority

AI workers must:

- identify the owning domain before proposing changes;
- preserve authoritative information ownership;
- avoid duplicating capabilities;
- use defined cross-domain interfaces;
- record dependencies;
- produce evidence supporting recommendations and actions;
- respect approval boundaries before changing authoritative records.

---

# Capability Maturity Model

Each capability should be assigned one maturity level.

- **Concept** — Preserved idea without approved research or implementation.
- **Research** — Under product, customer, market, operational, or technical investigation.
- **Planned** — Approved for future delivery.
- **Prototype** — Experimental implementation exists.
- **Operational** — Implemented in an internal or limited workflow.
- **Production** — Implemented, validated, and available in a production workflow.
- **Shared Platform** — Production capability intentionally reused across multiple domains.
- **Legacy** — Existing capability scheduled for replacement or retirement.

---

# Capability Metadata Standard

Each mature capability should eventually identify:

- Capability name
- Capability identifier
- Purpose
- Canonical domain owner
- Capability area
- Supporting domains
- Customer personas
- Customer journeys served
- Shared services consumed
- Interfaces exposed
- Dependencies
- Repository implementation
- Maturity
- Roadmap phase
- Validation evidence
- Data authority
- Security implications
- Operating cost
- AI authority rules
- Planned evolution

Recommended identifier pattern:

    DOMAIN-AREA-NUMBER

Examples:

    FIN-BNK-001
    REN-LSE-001
    IAM-AST-001
    EAM-WRK-001
    PCT-CST-001
    MNR-REL-001
    CAP-GAT-001
    DIN-RSK-001
    FOS-GOV-001

Identifiers should be introduced incrementally as capabilities mature. They should not be assigned merely to create artificial precision.

---

# Financial Operations

**Canonical Owner:** Financial Operations

## Purpose

Manage financial information, banking, transactions, accounting, budgeting, forecasting, reporting, tax readiness, and financial decision support.

## Banking

### Connection Management

- Provider registration
- Credential references
- Connection provisioning
- Provider capability discovery
- Connection health
- Connection history
- Reauthorization workflows
- Import status

### Financial Accounts

- Bank accounts
- Credit accounts
- Loan accounts
- Investment accounts
- Cash accounts
- Account ownership
- Account status
- Balance history

### Financial Data Import

- Account import
- Balance import
- Transaction import
- Import history
- Import reconciliation
- Duplicate detection
- Import failure handling
- Source traceability

## Financial Records

### Canonical Financial Events

- Income events
- Expense events
- Transfer events
- Liability events
- Asset events
- Adjustment events
- Source lineage
- Idempotent event storage

### Transaction Management

- Transaction normalization
- Categorization
- Classification
- Splitting
- Matching
- Property resolution
- Business-purpose resolution
- Review workflows
- Audit history

### Accounting Foundation

- Chart of Accounts
- General Ledger
- Journal Entries
- Accrual Accounting
- Cash Accounting
- Reconciliation
- Period Close
- Financial Controls

## Budgeting and Planning

### Budget Management

- Proposed budgets
- Approved budgets
- Actual vs Budget
- Rolling forecasts
- Department budgets
- Property budgets
- Project budgets

### Financial Forecasting

- Cash Flow Forecasting
- Revenue Forecasting
- Expense Forecasting
- Scenario Planning
- Variance Forecasting
- Liquidity Forecasting
- Runway Forecasting

## Financial Reporting

### Core Statements

- Income Statement
- Balance Sheet
- Cash Flow Statement
- Statement of Financial Position
- Trial Balance

### Executive Reporting

- KPI Reporting
- Portfolio Reporting
- Trend Analysis
- Variance Analysis
- Executive Dashboards
- Financial Workspace

## Tax Readiness

- Tax Categorization
- Schedule E Support
- Depreciation
- Mileage Tracking
- CPA Collaboration
- Audit Traceability

## Cross-Domain Relationships

Financial Operations provides authoritative financial information to:

- Rental Operations
- Business Operations
- Marketplace
- Property Intelligence
- Project Controls
- Construction Management
- Maintenance & Reliability
- Capital Projects
- Decision Intelligence

Financial Operations does not own:

- Project schedules
- Maintenance strategies
- Asset hierarchies
- Construction progress
- Rental lifecycle rules

---

# Rental Operations

**Canonical Owner:** Rental Operations

## Purpose

Support owners and property managers throughout the complete rental lifecycle.

## Portfolio Management

- Rental Properties
- Units
- Ownership Structures
- Portfolio Organization
- Property Assignments
- Operating Status

## Tenant Management

- Tenant Records
- Household Records
- Contact Information
- Tenant Screening
- Communication History
- Move-In Management
- Move-Out Management
- Tenant Status

## Lease Management

- Lease Creation
- Lease Renewals
- Lease Amendments
- Rent Schedules
- Deposits
- Fees
- Concessions
- Lease Documents
- Lease Termination

## Rent Collection

- Rent Invoicing
- Payment Collection
- Partial Payments
- Late Fees
- Delinquency Tracking
- Payment Plans
- Owner Distributions

## Maintenance Operations

- Maintenance Requests
- Work Triage
- Vendor Assignment
- Scheduling
- Cost Tracking
- Completion Evidence
- Tenant Communication
- Owner Approval

## Leasing

- Property Listings
- Applications
- Screening
- Approval Workflow
- Lease Preparation
- Move-In Coordination

## Portals

### Owner Portal

- Portfolio Performance
- Financial Statements
- Maintenance Approvals
- Documents
- Property Status

### Tenant Portal

- Payments
- Maintenance Requests
- Lease Information
- Documents
- Communications

## Rental Reporting

- Occupancy
- Rent Roll
- Delinquency
- Lease Expiration
- Turnover
- Property Performance
- Maintenance Performance

## Cross-Domain Relationships

Rental Operations consumes:

- Financial Operations
- Property Intelligence
- Marketplace
- Maintenance & Reliability
- Decision Intelligence
- FORGE OS

---

# Business Operations

**Canonical Owner:** Business Operations

## Purpose

Provide the operational foundation used by organizations across every FORGE product domain.

## Capability Areas

### Customer Relationship Management

- Organizations
- Contacts
- Leads
- Opportunities
- Sales Activities
- Relationship History

### Vendor Management

- Vendors
- Qualifications
- Insurance
- Contracts
- Performance
- Approved Vendor Lists

### Purchasing

- Purchase Requests
- Purchase Orders
- Approvals
- Receiving
- Vendor Invoices
- Commitment Tracking

### Inventory

- Inventory Items
- Warehouses
- Stock Levels
- Transfers
- Reorder Points
- Cycle Counts

### Workforce

- Employees
- Roles
- Teams
- Labor Records
- Certifications
- Availability

### Document Management

- Documents
- Version History
- Classification
- Search
- Retention
- Evidence Attachments

### Workflow Management

- Assignments
- Queues
- Notifications
- Escalations
- Approvals
- Operational Status

---

# Marketplace

**Canonical Owner:** Marketplace

## Purpose

Connect customers with products, contractors, suppliers, financing, incentives, and trusted providers.

## Provider Network

- Contractor Profiles
- Supplier Profiles
- Service Areas
- Qualifications
- Licensing
- Insurance
- Availability
- Performance History
- Verified Outcomes

## Service Marketplace

- Service Discovery
- Provider Matching
- Scope Requests
- Estimates
- Comparison
- Scheduling
- Completion Evidence
- Reviews

## Product Marketplace

- Product Discovery
- Product Comparison
- Pricing
- Compatibility
- Total Cost of Ownership
- Warranty Information
- Supplier Matching

## Opportunity Intelligence

- Rebates
- Incentives
- Financing
- Contractor Discounts
- Bulk Purchasing
- Sponsored Opportunities
- Disclosure Controls

## Marketplace Transactions

- Quotes
- Orders
- Invoices
- Payments
- Refunds
- Provider Settlements

---

# Property Intelligence

**Canonical Owner:** Property Intelligence

## Purpose

Maintain a complete digital understanding of every managed property, structure, system, and installed asset.

## Property Passport

- Property Identity
- Address
- Ownership
- Construction Details
- Systems
- Documents
- Inspections
- Improvements
- Historical Events

## Asset Passport

- Installed Equipment
- Manufacturer
- Model
- Serial Number
- Specifications
- Installation Date
- Warranty
- Maintenance History
- Condition
- Expected Useful Life
- Replacement History

## Property Health

- Condition Scoring
- Deferred Maintenance
- Risk Indicators
- Inspection Findings
- Compliance Status
- Health Trends

## Capital Planning

- Replacement Forecasting
- Useful Life Modeling
- Capital Reserve Planning
- Improvement Planning
- Cost Scenarios
- Priority Ranking

## Property Context Services

- Property Resolution
- Equipment Context
- Warranty Context
- Service History
- Contractor Context
- Financial References

---

# Industrial Asset Management

**Canonical Owner:** Industrial Asset Management

## Purpose

Manage industrial facilities, equipment, and operational assets throughout their lifecycle.

## Facility Structure

- Sites
- Plants
- Areas
- Units
- Systems
- Subsystems
- Functional Locations

## Equipment Registry

- Equipment Records
- Asset Hierarchy
- Tags
- Specifications
- Manufacturer Data
- Model Data
- Serial Numbers
- Criticality
- Operating Status

## Industrial Asset History

- Installation
- Commissioning
- Operations
- Inspections
- Failures
- Repairs
- Modifications
- Replacements
- Decommissioning

## Industrial Work Coordination

- Notifications
- Work Requests
- Work Orders
- Job Plans
- Labor Requirements
- Material Requirements
- Permit Management
- Completion Records

## Shutdown and Turnaround Support

- Scope Development
- Worklist Management
- Equipment Isolation
- Job Packages
- Resource Planning
- Material Readiness
- Cost Integration
- Schedule Integration
- Progress Tracking
- Completion Evidence
- Startup Readiness

## Industrial Compliance

- Inspection Requirements
- Regulatory Records
- Certifications
- Safety-Critical Equipment
- Environmental Compliance
- Audit History
- Compliance Evidence

## Cross-Domain Relationships

Industrial Asset Management collaborates with:

- Enterprise Asset Management
- Maintenance & Reliability
- Project Controls
- Construction Management
- Capital Projects
- Financial Operations
- Decision Intelligence

---

# Enterprise Asset Management

**Canonical Owner:** Enterprise Asset Management

## Purpose

Deliver enterprise-scale asset lifecycle and work-management capabilities comparable to SAP and IBM Maximo while preserving FORGE governance and domain ownership.

## Enterprise Asset Lifecycle

- Asset Creation
- Asset Classification
- Asset Hierarchy
- Asset Location
- Ownership
- Status
- Transfers
- Modifications
- Retirement
- Disposal

## Work Management

- Work Requests
- Notifications
- Work Orders
- Job Plans
- Task Lists
- Labor Planning
- Material Planning
- Tool Planning
- Contractor Planning
- Scheduling
- Execution
- Completion
- Closeout

## Preventive Maintenance

- Time-Based Maintenance
- Meter-Based Maintenance
- Condition-Based Maintenance
- Maintenance Plans
- Inspection Routes
- Compliance Tasks

## Predictive Maintenance

- Condition Monitoring
- Sensor Integration
- Failure Prediction
- Alert Thresholds
- Inspection Recommendations
- Intervention Recommendations

## Materials Management

- Spare Parts
- Equipment Bills of Material
- Storerooms
- Inventory
- Reservations
- Returns
- Critical Spares
- Obsolescence Tracking

## Service Contracts

- Service Agreements
- Warranty Claims
- Contractor Qualifications
- Service Levels
- Performance Tracking

## Cross-Domain Relationships

Enterprise Asset Management consumes:

- Maintenance strategy from Maintenance & Reliability
- Financial records from Financial Operations
- Schedule services from Project Controls
- Equipment context from Industrial Asset Management
- Recommendations from Decision Intelligence

---

# Project Controls

**Canonical Owner:** Project Controls

## Purpose

Provide integrated planning, cost, schedule, progress, forecasting, productivity, and change control for projects, maintenance programs, shutdowns, turnarounds, and capital investments.

## Cost Management

- Original Budget
- Current Budget
- Control Budget
- Commitments
- Purchase Orders
- Contracts
- Actual Costs
- Accruals
- Forecasts
- Estimate to Complete
- Estimate at Completion
- Cost Variance
- Contingency
- Management Reserve

## Cost Breakdown Structures

- Work Breakdown Structure (WBS)
- Cost Breakdown Structure (CBS)
- Organizational Breakdown Structure (OBS)
- Control Accounts
- Cost Codes
- Resource Codes
- Funding Structures
- Portfolio Structures

## Schedule Management

- Primavera P6 Integration
- Microsoft Project Integration
- FORGE Scheduling Integration
- Schedule Import
- Schedule Versioning
- Activities
- Milestones
- Calendars
- Logic Relationships
- Baselines
- Critical Path
- Float
- Schedule Variance

## Progress Management

- Quantity Progress
- Milestone Progress
- Physical Percent Complete
- Schedule Percent Complete
- Cost Percent Complete
- Progress Validation
- Progress Approval

## Productivity

- Labor Hours
- Earned Hours
- Installed Quantities
- Planned Productivity
- Actual Productivity
- Crew Performance
- Equipment Productivity
- Trend Analysis

## Earned Value

- Planned Value
- Earned Value
- Actual Cost
- Cost Performance Index
- Schedule Performance Index
- Estimate at Completion
- Variance at Completion

## Forecasting

- Cost Forecasting
- Schedule Forecasting
- Completion Date Forecasting
- Quantity Forecasting
- Labor Forecasting
- Cash Flow Forecasting
- Scenario Forecasting

## Change Management

- Change Requests
- Change Orders
- Budget Transfers
- Scope Changes
- Schedule Impacts
- Cost Impacts
- Approval Workflow
- Change History

## Risk and Opportunity

- Risk Register
- Opportunity Register
- Probability
- Impact
- Mitigation
- Contingency
- Quantitative Risk Analysis

## Executive Reporting

- Cost Reports
- Schedule Reports
- Progress Reports
- Productivity Reports
- Forecast Reports
- Risk Reports
- Executive Dashboards
- Portfolio Dashboards

## Cross-Domain Relationships

Project Controls consumes:

- Financial Operations
- Construction Management
- Enterprise Asset Management
- Industrial Asset Management
- Capital Projects
- Decision Intelligence

Project Controls owns project-control calculations but does not own accounting records or maintenance strategy.

---

# Construction Management

**Canonical Owner:** Construction Management

## Purpose

Support engineering, procurement, construction, commissioning, and field execution.

## Field Execution

- Work Packages
- Crew Assignments
- Daily Reports
- Installed Quantities
- Labor Hours
- Equipment Hours
- Constraints
- Completion Evidence

## Engineering Coordination

- RFIs
- Technical Queries
- Submittals
- Drawing Registers
- Engineering Changes
- Design Clarifications

## Quality Management

- Inspection and Test Plans
- Quality Records
- Nonconformance Reports
- Corrective Actions
- Punch Lists
- Turnover Documentation

## Material Management

- Material Requirements
- Procurement Status
- Delivery Status
- Receiving
- Storage
- Material Traceability

## Contractor Management

- Contractor Scope
- Mobilization
- Workforce Reporting
- Productivity
- Safety
- Quality
- Progress Claims

---

# Maintenance & Reliability

**Canonical Owner:** Maintenance & Reliability

## Purpose

Optimize asset availability, reliability, maintainability, lifecycle cost, and operational performance.

## Maintenance Strategy

- Asset Criticality
- Preventive Maintenance
- Predictive Maintenance
- Condition-Based Maintenance
- Inspection Strategy
- Spare Parts Strategy

## Reliability Engineering

- Root Cause Analysis
- Reliability Centered Maintenance
- FMEA
- FMECA
- Bad Actor Analysis
- Reliability Growth
- Defect Elimination

## Maintenance Planning

- Job Scoping
- Job Plans
- Labor Estimates
- Material Requirements
- Tool Requirements
- Contractor Requirements
- Permit Requirements
- Readiness Reviews

## Maintenance Scheduling

- Backlog Management
- Weekly Scheduling
- Daily Scheduling
- Resource Leveling
- Constraint Management
- Schedule Compliance
- Break-In Work Tracking

## Condition Monitoring

- Inspections
- Vibration Analysis
- Thermography
- Oil Analysis
- Ultrasound
- Process Indicators
- Alarm Trends

## Reliability Performance

- Availability
- Utilization
- MTBF
- MTTR
- Planned Maintenance %
- Schedule Compliance
- Emergency Work %
- Maintenance Cost

---

# Capital Projects

**Canonical Owner:** Capital Projects

## Purpose

Manage capital investments from business case through commissioning, startup, and benefits realization.

## Capability Areas

### Business Case

- Opportunity Identification
- Strategic Alignment
- Alternatives Analysis
- Economic Evaluation
- ROI
- NPV
- IRR
- Funding Strategy

### Stage-Gate Governance

- Gate Reviews
- Approval Criteria
- Readiness Reviews
- Executive Decisions
- Funding Authorization
- Scope Approval

### Execution Governance

- Baseline Approval
- Change Control
- Forecast Reviews
- Risk Reviews
- Executive Escalation
- Recovery Planning

### Commissioning

- Completion Systems
- Startup Planning
- Operational Readiness
- Handover
- Performance Testing

### Portfolio Management

- Capital Portfolio
- Prioritization
- Funding Allocation
- Portfolio Forecasting
- Portfolio Risk
- Executive Reporting

---

# Decision Intelligence

**Canonical Owner:** Decision Intelligence

## Purpose

Transform authoritative information from every FORGE domain into explainable recommendations, forecasts, risks, opportunities, and executive decision support.

## Capability Areas

- Forecast Intelligence
- Risk Intelligence
- Opportunity Intelligence
- Executive Dashboards
- Portfolio Intelligence
- Explainable AI
- Natural Language Analysis
- Recommendation Services
- Scenario Planning

Decision Intelligence analyzes information.

It does **not** own authoritative business information.

---

# Education

**Canonical Owner:** Education

## Capability Areas

- FORGE Academy
- Financial Education
- Property Education
- Industrial Education
- Contextual Learning
- Certifications
- Guided Learning

---

# FORGE OS

**Canonical Owner:** FORGE OS

## Purpose

Provide the governed AI operating system coordinating intelligent execution across the FORGE platform.

FORGE OS owns platform execution services.

It does **not** own business-domain rules.

## Platform Services

### Runtime

- Runtime Composition
- Request Execution
- Workflow Coordination
- Manager Dispatch

### Governance

- Authority Evaluation
- Policy Enforcement
- Delegation
- Approval Management
- Decision Recording

### Evidence

- Evidence Production
- Validation
- Evidence Lineage
- Replay Support

### Lifecycle

- Lifecycle Coordination
- State Management
- Transition Validation
- Context Evolution

### Knowledge

- Repository Intelligence
- Documentation Intelligence
- Capability Intelligence
- Research Intelligence

### AI Coordination

- AI Managers
- AI Workers
- Domain Awareness
- Capability Awareness
- Work Assignment

### Automation

- Scheduled Workflows
- Triggered Workflows
- Human Approval
- Escalation
- Recovery

### Observability

- Runtime Events
- Workflow Status
- Traceability
- Execution Replay

---

# Capability Lifecycle

Every capability should progress through this lifecycle:

Research

↓

Capability Proposal

↓

Ownership Review

↓

Architecture Review

↓

Capability Catalog

↓

Roadmap

↓

Engineering Architecture

↓

Implementation

↓

Validation

↓

Production Readiness

↓

Production

↓

Measured Evolution

---

# Capability Creation Rules

1. Research before implementation.
2. Every capability has one canonical owner.
3. Prefer reuse over duplication.
4. Preserve domain boundaries.
5. Define cross-domain interfaces.
6. Add capabilities to this catalog before adding them to the roadmap.
7. Connect engineering work to approved capabilities.
8. Validate before declaring production ready.
9. Record evidence supporting capability maturity.
10. Continuously evolve capabilities using customer and operational feedback.

---

# Repository Traceability

Every mature capability should eventually trace to:

Vision

↓

Product Domain

↓

Capability Area

↓

Capability

↓

Roadmap

↓

Engineering Architecture

↓

Repository Implementation

↓

Validation Evidence

↓

Production Outcome

---

# Guiding Principle

Build each capability once under clear canonical ownership, reuse it through explicit interfaces, validate it with evidence, and evolve it using real customer and operational outcomes.
