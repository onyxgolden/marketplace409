# FORGE Platform Capabilities

**Status:** Foundational Draft

## Purpose

Define the canonical reusable capabilities shared across FORGE products.

This catalog helps product teams, engineers, and AI agents determine whether a capability already exists, should be extended, or belongs in the shared platform rather than one product.

## Depends On

- `FORGE_NORTH_STAR.md`
- `FORGE_PRODUCT_CONSTITUTION.md`
- `FORGE_PRODUCT_OPERATING_SYSTEM.md`
- `FORGE_VISION_MAP.md`

## Referenced By

- Product research
- Product architecture
- Engineering architecture
- Roadmap planning
- Repository gap analysis
- AI-agent work assignments

## Capability Maturity Model

- **Concept** — Preserved idea without approved implementation.
- **Research** — Under product or technical investigation.
- **Planned** — Approved for future implementation.
- **Prototype** — Experimental implementation exists.
- **Production** — Implemented and available in a production workflow.
- **Shared Platform** — Production capability intentionally reused across products.
- **Legacy** — Existing capability scheduled for replacement or retirement.

## Current Shared Foundations

### Identity and Access

- Authentication
- Owner identity
- Authorization
- Multi-tenant isolation

### Connection Platform

- Provider registration
- Credential references
- Connection provisioning
- Provider capabilities
- Account import
- Balance import
- Transaction import
- Import history
- Connection health

### Financial Platform

- Canonical financial events
- Financial accounts
- Account balances
- Transaction normalization
- Property resolution
- Financial aggregation
- Financial workspaces
- Read models
- Reporting
- Dashboard intelligence
- Traceability

### Engineering Platform

- FORGE OS
- Runtime governance
- Evidence validation
- Lifecycle coordination
- Context evolution
- Repository intelligence
- Conversation continuity
- Mutation Firewall
- Automated validation

### Product Platform

- Product North Star
- Product Constitution
- Product Operating System
- Product research standards
- Feature Investment Cards
- Product decisions
- Product roadmap
- Idea Incubator
- Design principles
- Product glossary

## Planned Shared Capabilities

### Billing

- Billing-provider interface
- Stripe provider
- Customer records
- Checkout
- Payment execution
- Webhook processing
- Refunds
- Receipts
- Subscription support
- Financial-event generation

### Rental Operations

- Units
- Tenants
- Leases
- Rent schedules
- Invoices
- Payments
- Deposits
- Maintenance requests
- Owner portal
- Tenant portal

### Property and Asset Intelligence

- Property Passport
- Asset Passport
- Equipment specifications
- Installation history
- Warranty tracking
- Maintenance history
- Expected useful life
- Replacement forecasting
- Capital reserve planning
- Property health scoring

### Opportunity Intelligence

- Opportunity detection
- Rebate discovery
- Incentive discovery
- Product comparison
- Total-cost-of-ownership analysis
- Trusted-provider matching
- Contractor discounts
- Clearly disclosed sponsored opportunities

### Contractor Platform

- Contractor profiles
- Service areas
- Verified job outcomes
- Property context before service calls
- Equipment and warranty context
- Estimates
- Invoices
- Scheduling
- Job documentation
- FORGE Financial adoption path

### Community Platform

- Feature suggestions
- Duplicate-request clustering
- Voting
- Following
- Public status
- Decision explanations
- Community recognition
- Feature outcome reporting

### Education and Tax

- FORGE Academy
- Financial-literacy courses
- Contextual learning
- Tax-ready categorization
- Schedule E preparation support
- CPA workspace
- Mileage tracking
- Depreciation records
- Tax-document organization

## Capability Record Requirements

Each mature capability should eventually identify:

- Purpose
- Product owner
- Engineering owner
- Customer journeys served
- Product consumers
- Dependencies
- Repository implementation
- Maturity
- Validation evidence
- Operating cost
- Security implications
- Planned evolution

## Reuse Rules

1. Inspect the catalog and repository before creating a new capability.
2. Prefer extending a shared capability over duplicating it.
3. Keep product-specific business rules inside the owning product domain.
4. Move infrastructure into the shared platform only when reuse is proven.
5. Do not force unrelated products into an abstraction merely to claim reuse.
6. Record capability ownership and dependencies explicitly.

## Guiding Principle

Build once and reuse wherever doing so preserves clear ownership, lowers lifetime cost, and improves the customer experience.
