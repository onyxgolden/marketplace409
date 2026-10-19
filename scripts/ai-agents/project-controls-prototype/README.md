# Project Controls Agent — Phase 2 slice 1 prototype

SYNTHETIC PROTOTYPE. Offline, invented fixtures only. All "forecast" values are
**SYNTHETIC ARITHMETIC EXERCISE** — not a project forecast, not financial advice.

## What it does

Arithmetic controls audit over invented work packages: traceable PV/EV/AC,
indices (CPI/SPI), variances (CV/SV), contingency accounting, and named-formula
EAC exercises (`controls-v1`: `BAC_OVER_CPI`, `AC_PLUS_REMAINING_BUDGET`,
`AC_PLUS_REMAINING_OVER_CPI_SPI`, `BOTTOM_UP_ETC`). Exact rational minor-unit
math (BigInt); money displays round half-away-from-zero to cents; ratios display
4 decimals. Zero denominators yield typed `UNVERIFIABLE`/`ZERO_DENOMINATOR` —
never infinity. Claimed progress is never upgraded to physical completion.

## Layout

- `src/index.js` — `run(task, context)` entry; builds the advisory envelope.
- `src/controls.js` — earned-value domain arithmetic.
- `src/schemas.js` — runtime validation (rejects unknown fields, bad types,
  duplicate IDs, malformed pins).
- `src/resolver.js` — fixture resolver with monotonic budget (64 objects,
  512 spans, 256 KiB in/out); git-blob-SHA1 provenance pins.
- `src/injection.js` — seeded injection-family recognizer (quarantine only;
  structural capability absence is the real defense).
- `src/canonical.js` — deterministic encoding + exact rational rounding.
- `fixtures/` — 20 invented work packages (`make-fixtures.js` regenerates).
- `corpus/` — frozen 120-case battery + SHA-256 manifest (`make-battery.js`,
  `freeze-corpus.js`).
- `runner/run-manual.js` — manual host launcher (canonical JSON to stdout).
- `tests/` — focused `node:test` suites + `run-battery.js` scorer.

## Run

```sh
node --test tests/*.test.js   # focused suites
node tests/run-battery.js     # 120-case frozen battery (verifies manifest first)
node runner/run-manual.js task.json
```

## Envelope

`{schema_version:"1", agent:"project-controls", task_id, advisory:true,
fixture_only:true, authorization_granted:false, complete, status,
source_refs, diagnostics, quarantined_sources, routing_flags, report}`.
Status: `REPORT_READY` / `PARTIAL` / `REFUSED` / `EMPTY`.

## Boundaries (enforced)

- Reads only registered synthetic fixtures through the scoped resolver.
- No filesystem/shell/browser/network/send/write capability.
- No live tenant/financial/production data. No model calls. No spend.
- Unsupported operations return `REFUSED`; unknown EAC variants return
  `UNSUPPORTED_FORMULA`; missing formulas return `UNVERIFIABLE`.
