# Finance Agent — Phase 2 slice 1 synthetic prototype

Pure Node 24 ESM, zero runtime dependencies, zero model calls, offline,
fixture-only. Synthetic transaction classifier, BigInt minor-unit
arithmetic audit, anomaly register and period summary.

## Layout

- `src/index.js` — `run(task, context)` public entry; deterministic pipeline.
- `src/canonical.js` — BigInt minor-unit math, exact rationals, half-away-from-zero rounding, canonical JSON.
- `src/schemas.js` — strict runtime validation. `validateContext(context, budget)` charges every context candidate BEFORE reading fields (the CS-001/DOC-002/FM-005 bug class).
- `src/resolver.js` — SourceRef Git-blob verification, read grants, per-task monotonic budget (64 objects / 512 spans / 256 KiB).
- `src/classifier.js` — exact chart-of-accounts code lookup; no keyword interpretation.
- `src/injection.js` — seeded instruction-family detection; quarantines text, capability absence is the defense.
- `fixtures/` — synthetic object store (`make-fixtures.js` authoring tool, `store.json` output).
- `corpus/` — frozen 120-case battery (`make-battery.js` independent oracle, `battery.json`, `manifest.json`, `corpus_digest.txt`).
- `runner/run-manual.js` — manual host launcher (not scored).
- `tests/` — `node:test` suite; `run-tests.js` authenticates `FIN_APPROVED_ROOT` before any scored import.

## Budget discipline

Every candidate object — chart source, transaction bundle source, EACH
transaction, and EVERY element of the injected trusted context (sources,
revisions, read grants, principal, criteria) — is charged via
`budget.countObject()` as the FIRST statement before any of its fields
are read. Attempt 65 refuses before that candidate is inspected at all.

Real boundary: 8 context charges + 2 fixture resolutions + 54
transactions = 64 (cap). 55 transactions refuse `BUDGET_EXCEEDED`.

## Money rules

- All amounts BigInt minor units (cents for USD scale2).
- Quantity/rate/tax as decimal strings → exact rationals (≤6 places, |num| ≤ 10^18).
- Line extension = quantity × unit_price, rounded once half-away-from-zero.
- Line tax = extension × rate, rounded once half-away-from-zero.
- IN adds signed amount; OUT subtracts signed amount; TRANSFER nets zero only when paired IDs match in amount and currency.
- Closing = claimed opening + verified movement ("derived from claimed opening").
- Duplicate IDs: both retained in diagnostics, no authoritative summary.
- Opposite-sign nonzero claimed vs computed net income → SEVERE_INTEGRITY_CONFLICT, PARTIAL, summary null.

## Running

```sh
FIN_APPROVED_ROOT=$(cat corpus/corpus_digest.txt) npm test
FIN_APPROVED_ROOT=$(cat corpus/corpus_digest.txt) npm run battery
```
