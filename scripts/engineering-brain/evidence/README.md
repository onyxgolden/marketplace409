# Evidence adapters — Slice 2

## What this is

Read-only, fail-closed adapters that fetch a capability's durable evidence
from its source. Slice 1 inventoried *what* executes and *what would prove
it*; this slice builds the typed readers Slice 3's coverage evaluation will
call. No evaluation happens here — only gathering.

## Files

- `evidence/adapterTypes.mjs` — the two adapter implementations:
  `supabase-table` (latest-row time + row count in a window, SELECT only)
  and `github-actions` (latest workflow run, GET only). Every adapter
  returns `{ ok: true, evidence }` or `{ ok: false, error }`; nothing
  throws, nothing returns partial data as success.
- `evidence/evidenceAdapters.mjs` — per-capability adapter specs:
  `ADAPTER_SPECS` plus `UNSPECIFIED_CAPABILITIES` (the honest absence
  list). `validateAdapterSpecs()` fails closed on unknown capability ids,
  unknown adapter types, and duplicates.
- `evidence/collectEvidence.mjs` — `collectEvidence(capabilityId, { now,
  deps })`: runs a capability's adapters and returns the normalized
  report. One failed adapter fails the collection; per-adapter results are
  preserved so the caller sees which source failed.
- `evidence/__tests__/evidenceAdapters.test.mjs` — 18 tests, all I/O
  faked.

## Read-only guarantee

- The Supabase adapter's chain uses only `.select()`; a test asserts the
  fake client never sees `insert`/`update`/`delete`/`rpc`.
- The GitHub adapter's fake exposes only a GET-style
  `listWorkflowRuns`; there is no write path to call.
- Adapters take no credentials themselves — `deps` are injected by the
  caller, so the read-only boundary is structural, not conventional.

## Fail-closed rules

- Missing client, DB error, malformed run, thrown exception → `ok: false`
  with the reason. Never an exception, never silent empty success.
- Zero rows / zero runs is *evidence* (`ok: true`, count 0), not failure —
  "nothing ran" is a finding for Slice 3, not an adapter error.
- Unknown capability, capability with no adapters, invalid spec table →
  `ok: false` with an explicit reason.
- `now` is injected (epoch ms), so window arithmetic is deterministic in
  tests; live callers pass `Date.now()`.

## Honest absence

Four capabilities have no adapters: three webhooks whose evidence tables
were never traced (`unable-to-verify`), and the rental payment webhook
(`uncovered`). They are listed in `UNSPECIFIED_CAPABILITIES` with reasons,
and a test pins that every registry capability is either specified or
explicitly unspecified. Capabilities whose evidence *is* verifiable keep
their adapters even when another field (like the watchdog's trigger) is
unable-to-verify — uncertainty stays exactly where it belongs.

## Known limits for Slice 3 (evaluation)

- A successful GitHub workflow run proves the workflow executed, not that
  every job inside it succeeded. The 11 rental schedules share one
  workflow file; Slice 3 must not treat one green run as proof all 11
  jobs ran — it should consult the per-capability Supabase evidence first
  and treat the Actions run as corroboration.
- `rowCount` is an exact count from a head-only query (no row cap), and
  the count/latest queries must agree or the adapter fails. Two queries
  can race in theory; a disagreement fails closed rather than reporting
  a half-truth.

## Slice 3 — coverage evaluation

`evaluateCoverage.mjs` turns collected evidence into per-capability
verdicts: `covered`, `gap`, or `unknown`. The attribution restriction is
the core rule — **only evidence attributable to the specific capability
can produce `covered`**:

| Attribution | Can cover? | Meaning |
|---|---|---|
| `sweep-exclusive` | yes | Table written only by this sweep |
| `discriminator` | yes | Shared table + filters isolating this capability's rows |
| `workflow-exclusive` | yes | One workflow file per capability |
| `corroborating-only` | no | Reported, never flips a verdict |
| `unverified` | no | Reported, never flips a verdict |

- `covered`: attributable evidence shows execution inside the expected
  interval (daily → 30h, twice daily → 16h).
- `gap`: attributable evidence exists but shows nothing recent — the
  capability missed its expected run.
- `unknown`: evidence unavailable, unattributable, or malformed. Adapter
  failure is `unknown`, never `gap`; zero attributable rows is `gap`,
  never `unknown`.
- Discriminator filters (`eq`/`like`) are applied to both Supabase
  queries and recorded in the evidence; malformed filters fail closed.
- `evaluateCoverageCli.mjs` runs the evaluation live (`--all` or
  `--capability <id>`, `--out <file>`); read-only, fails closed without
  `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `GITHUB_TOKEN`.
