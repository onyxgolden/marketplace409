# Architectural Decision Records (ADR)

**Project:** Financial Forge

Architectural Decision Records document significant engineering decisions that affect the long-term architecture of Financial Forge.

The Forge Constitution defines **how we build**.

Architectural Decision Records explain **why specific architectural decisions were made**.

---

# ADR-0001

## Title

Transitional Report Composition

---

## Status

Accepted

---

## Date

2026-06-21

---

## Context

Financial reports were originally modeled as flat collections of `ReportLine` objects.

As reporting requirements expanded, the architecture needed to support reusable report sections while preserving backward compatibility for existing reports and consumers.

A large-scale refactor would have introduced unnecessary architectural risk and violated the incremental development strategy adopted after the Forge #20 rollback.

---

## Decision

`FinancialReport` shall temporarily support both:

* `lines`
* `sections`

During the migration period:

* Existing reports continue exposing `lines()`.
* New architecture composes reports using `ReportSection`.
* Reports are migrated individually.
* External APIs remain unchanged.

No report is migrated until its own dedicated tests exist.

---

## Rationale

This approach allows:

* Small validated architectural changes.
* Continuous green builds.
* Zero breaking changes.
* Incremental migration.
* Reduced engineering risk.

The bridge architecture intentionally favors stability over immediate simplification.

---

## Consequences

### Positive

* Existing consumers continue working.
* New reports can adopt composition.
* Migration can occur one report at a time.
* Architecture remains continuously deployable.

### Negative

* Temporary duplication of report structure.
* Slightly increased implementation complexity during migration.

This duplication is intentional and temporary.

---

## Retirement Criteria

The compatibility bridge may be evaluated for removal only after:

* Every report composes `ReportSection`.
* All consumers operate correctly using the composed architecture.
* Dedicated migration tests exist.
* The change can be performed without breaking external behavior.

---

## Related Commits

* Support report sections in financial reports
* Compose trial balance report section

---

## References

* Forge Constitution v1.0
* Ledger Domain Blueprint
* Forge #20 retrospective

---

# ADR-0002

## Title

Report Builder Separation

---

## Status

Accepted

---

## Date

2026-06-21

---

## Context

Financial reports were beginning to mix two responsibilities:

* representing immutable report output
* constructing report lines and sections from calculated domain results

This was acceptable during early report migration, but it would not scale cleanly to future export engines, financial analytics, AI CFO workflows, or multi-company consolidation.

The architecture needs a dedicated layer that can assemble reports without making report objects responsible for construction logic.

---

## Decision

Financial report construction shall be separated from financial report representation.

Report builders are responsible for converting calculated domain results into presentation-ready report structures.

Reports are responsible for representing immutable report output.

The standard flow is:

Ledger history

↓

Calculators and domain services

↓

Report builders

↓

Report sections

↓

Financial reports

↓

Export engines and analytics

Builders may create:

* `ReportLine`
* `ReportSection`
* statement-specific financial reports

Reports must not calculate accounting.

Reports should avoid becoming orchestration objects.

---

## Rationale

This separation supports:

* immutable reports
* reusable builders
* multiple export formats
* AI CFO analysis
* future consolidation reports
* cleaner testing boundaries
* safer incremental migration

The first accepted implementation is `TrialBalanceBuilder`.

It establishes the pattern without forcing all reports to migrate at once.

---

## Consequences

### Positive

* Report construction has a dedicated home.
* Financial report objects remain simple and immutable.
* Builders can depend on calculators and domain services.
* Export engines can consume stable report objects.
* Future AI systems can reason over consistent report structures.

### Negative

* Temporary duplication remains during migration.
* Some reports may temporarily support backward-compatible construction.
* Builder abstraction should not be generalized too early.

---

## Migration Rule

Migrate one report builder at a time.

Do not introduce a shared builder base class until at least two concrete builders prove the common abstraction.

Each builder must have dedicated tests before being exported publicly.

Each new builder must pass:

* targeted tests
* full test suite
* production build
* public export inspection

---

## Related Commits

* Add trial balance report builder

---

## References

* Forge Constitution v1.0
* ADR-0001 Transitional Report Composition
* Ledger Domain Blueprint

---

# ADR-0003

## Title

Horizontal Domain Expansion

---

## Status

Accepted

---

## Date

2026-06-25

---

## Context

The Financial Forge accounting foundation has matured into stable infrastructure.

The ledger, chart of accounts, posting engine, rollup services, reporting pipeline, production report service, and financial engine now provide a reliable source of financial truth.

Earlier phases focused on building the vertical accounting foundation.

Future product growth now requires new business capabilities that should not destabilize the ledger or force unrelated responsibilities into the accounting domain.

---

## Decision

Future Forge capabilities shall expand primarily through horizontal sibling domains.

The financial engine remains stable infrastructure.

New domains should consume the richest stable domain object available.

Presentation objects are not architectural integration points.

Domains should depend on stable public APIs and domain summaries rather than internal ledger structures or report presentation objects.

When a new domain needs financial truth, it should consume a stable domain-level object that preserves the meaning required for that domain.

Financial Insights demonstrates this pattern by consuming `FinancialMetricsSummary` instead of depending directly on ledger internals or financial reports.

---

## Rationale

This decision protects the accounting foundation from becoming a catch-all product layer.

Financial reports are presentation objects.

They are useful outputs, but they discard some domain meaning and should not become the primary integration surface for unrelated domains.

Horizontal expansion allows Forge to grow into business intelligence, insights, investor tooling, valuation, forecasting, and operational decision support without weakening the ledger.

Each domain can own its own language, tests, and public API while still consuming trusted financial truth.

---

## Consequences

### Positive

* The ledger remains stable infrastructure.
* New capabilities can be added without destabilizing accounting.
* Domains remain independently testable.
* Business concepts can evolve in their own bounded contexts.
* Presentation layers remain outputs, not dependency roots.
* Future AI and analytics workflows can consume richer domain objects.

### Negative

* New domains require intentional API design.
* Some data may need adapter or summary objects before it can be safely consumed.
* It may be slower than directly reusing report output.
* Architectural discipline is required to prevent convenience coupling.

---

## Long-Term Constraint

Every new domain should consume the richest stable domain object available, not the most convenient presentation object.

Reports may be displayed, exported, or analyzed as outputs.

Reports should not become the default integration boundary between domains.

---

## Related Commits

* Document horizontal domain expansion in Forge roadmap

---

## References

* Forge Constitution
* Forge Roadmap v4.0
* ADR-0001 Transitional Report Composition
* ADR-0002 Report Builder Separation
