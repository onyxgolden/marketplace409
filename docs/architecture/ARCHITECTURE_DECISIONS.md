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
