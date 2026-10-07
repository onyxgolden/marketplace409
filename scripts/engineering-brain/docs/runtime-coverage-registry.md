# Runtime Coverage Registry — Slice 1

## What this is

A deterministic inventory of every production capability FORGE actually
executes — scheduled jobs, event-triggered endpoints, and webhooks — plus a
fail-closed contract each entry is validated against. It answers "what does
FORGE do in production?" so later slices can answer "is it monitored?".

**This is inventory, not monitoring.** Nothing here changes what the Brain
indexes, how it ranks answers, or what it watches. Slice 1 is discovery
only. Evidence adapters (Slice 2) and coverage evaluation against live
evidence (Slice 3) build on this registry.

## Files

- `runtimeCoverageRegistry.mjs` — the inventory: 21 capabilities, sorted by
  id, every value a literal (no environment, network, or clock reads).
- `validateRuntimeCoverageRegistry.mjs` — the contract. Fails closed: any
  violation invalidates the whole registry.
- `runtimeCoverageReport.mjs` — CLI view: `node
  scripts/engineering-brain/runtimeCoverageReport.mjs [--json]`. Exit code
  1 when validation fails. Deterministic output, no timestamps.
- `__tests__/runtimeCoverageRegistry.test.mjs` — registry + contract tests.

## The contract (per entry)

| Field | Rule |
|---|---|
| `id` / `name` | non-empty strings, unique across the registry |
| `execution_path` | non-empty string: where it runs |
| `trigger` | `{ kind: "schedule", cron, chicago_label }` or `{ kind: "event", description }`; cron must be a strict 5-field UTC expression |
| `moves_money` | boolean; `true` requires non-empty `durable_evidence` |
| `durable_evidence` | non-empty array of non-empty strings (tables, logs); `"unverified"` markers where the survey could not trace a write |
| `expected_cadence` | non-empty string |
| `monitoring_status` | exactly one of `covered`, `partially-covered`, `uncovered`, `unable-to-verify` |
| unknown fields | rejected — strict shape |

## What "unable-to-verify" means

Uncertainty is recorded, never upgraded. Four entries carry it: the
autopay-sweep watchdog's independent scheduler lives outside this repo, and
three Stripe webhooks' write targets were not traced. Slice 2 may resolve
these; until then they stay marked.

## What "covered" would require

An independent check that verifies executions against durable evidence.
Slice 1 performs no such checks, so no entry claims `covered`. The 16
`partially-covered` entries have some verification today (usually: firing
is checked, outcome is not). The claim is the registry's, recorded for
Slice 3 to evaluate — not a verdict.

## Money-moving capabilities

Five entries move money (two Stripe autopay sweeps, the watchdog recovery
path, charge generation, late-fee posting). They are flagged, never acted
on: this slice initiates no charges, sends no money, and changes no
financial state. The flag exists so later slices treat them with the
highest verification bar.

## Determinism

Same commit → same registry → same report. Entries are sorted by id, the
validator sorts its error list, and the report emits no timestamps. The
`determinism` test convention in `__tests__/` covers this like the other
Brain scripts.
