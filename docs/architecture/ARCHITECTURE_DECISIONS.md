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
