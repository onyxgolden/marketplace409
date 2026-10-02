# ADR-003 — Readiness is deterministic and evidence-based; no opaque scores

Date: 2026-10-02
Status: Accepted (Rung 0)

## Context

"Can this work start?" is the most valuable question Work Management
answers. The easy implementation is a single readiness percentage blended
from signals — which is also the implementation nobody trusts, because no
one can say what 63% means or what would make it 100%.

## Decision

- Readiness is a set of named gates, each evaluating to `ready | not_ready |
  unknown | not_applicable`, each with a reason, evidence reference,
  timestamp, and responsible source (`readiness-model.md`).
- `unknown` is a first-class outcome: missing data stays missing, never
  inferred ready or not-ready from absence (program plan non-negotiable
  rule 8).
- The package's readiness statement is the plain-language list of what is
  not ready and what would clear it — never a blended score.
- Overrides are explicit, attributed, reasoned, and expiring.

## Consequences

- Reporting aggregates (program S-curve, ready-count) are computed from gate
  states, so they are auditable down to the evidence.
- The Brain may *explain* readiness ("not ready because…") but may not
  *decide* it; evaluation is a deterministic function over gates and links.
- Gate sets come from package templates; adding a gate type is a reviewed
  product decision, not a per-package improvisation.
