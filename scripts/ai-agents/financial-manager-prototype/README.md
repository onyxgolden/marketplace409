# Financial Manager Agent — Phase 2 slice 1 prototype

Draft summary reporting assembler with **exact variance recomputation**
(BigInt / exact rational arithmetic — no float money) and
**evidence-label-preserving narrative checks**. Advisory only: synthetic
fixtures in, draft JSON out.

> DRAFT — SYNTHETIC FIXTURE DATA — NOT A FINANCIAL STATEMENT

Every result carries that watermark; the Markdown renderer repeats it in the
document head, every rendered section, and the footer.

## What it does

`run(task, context)` assembles a draft summary report from fixture sections:

- **Input.** `{task_id, bundle_refs:[SourceRef], period_ids:[],
  requested_action:"assemble_draft"}`. A fixture section carries
  `{section_id, currency, minor_unit_scale, population_id, period_start,
  period_end, lines, claimed_totals, narrative_claims}`.
- **Amounts** are signed integer decimal strings parsed as BigInt — negative
  amounts are credits/reversals, never abs-normalized. The fractional-minor
  variant uses exact rational `{numerator, denominator}` strings;
  accumulation is rational and rounding to integer minors happens **once**
  at the displayed section total, **half-away-from-zero**. The integer model
  remains preferred.
- **Percentages** are exact ratios displayed at two decimals with the same
  rounding; a zero budget yields `NOT_COMPARABLE`, never infinity or 0%.
- **Variance** = actual − budget for both categories. Favorability: revenue
  +/− = favorable/unfavorable; expense +/− = unfavorable/favorable; zero =
  neutral. Mixed-category net income = revenue − expense, reported
  separately — favorability labels are never summed or attached to it.
- **Dedup.** Identity = (population_id, line_id, period_start, period_end,
  currency, minor_unit_scale, category). Identical copies merge (all source
  labels retained verbatim); conflicting copies → contradiction with no
  single aggregate (alternatives shown with provenance). Duplicate line_ids
  are therefore allowed past schema validation — the dedup stage owns them;
  duplicate claim_ids/section_ids (no dedup semantics) are still rejected.
- **Narrative checks.** Movement claims are arithmetically verifiable; cause
  claims are **never** supported by coincident arithmetic alone — only an
  explicit verified fixture basis for a bounded causal fact supports a
  causal explanation. Unsupported macro stories are quoted as unsupported
  attribution at most, never repeated as verified cause. Missing source
  labels block the section; the package is never presented complete over
  missing sections. Different currencies/scales or overlapping period
  populations block the combined aggregate — no FX or overlap guesses.
- **Output.** `{status: ASSEMBLED|PARTIAL|BLOCKED|REFUSED, watermark,
  sections:[...], package_complete, exceptions, rollup}` inside the common
  envelope (`advisory:true, fixture_only:true`, sorted diagnostics,
  quarantined sources, routing flags).

## Refusals

- Seeded instruction-injection in narrative text → `REFUSED /
  INSTRUCTION_INJECTION`; quarantine exposes IDs + family only, never the
  raw payload.
- Live-ledger refs (any repo outside the approved synthetic fixture roots),
  issuance actions (`requested_action` other than `assemble_draft`), and
  malformed schemas → `REFUSED` with `ACTION_DENIED` / `INVALID_INPUT`.
- Prototype budgets: 256 KiB input, 64 resolutions / 512 spans, 256 output
  records → `INPUT_LIMIT` / `BUDGET_EXCEEDED` / `OUTPUT_LIMIT`.

## Layout

- `src/` — `index.js` (`run`), `money.js` (exact math), `schemas.js`
  (runtime validation), `injection.js` (seeded-family recognizer),
  `resolver.js` (scoped fixture resolver, Git blob SHA-1 pins),
  `canonical.js` (deterministic JSON), `markdown.js` (renderer).
- `fixtures/store.json` — 52 registered synthetic fixtures (12 named
  discovery + 40 variants), each pinned by Git blob SHA-1 over canonical
  content bytes. `fixtures/make-fixtures.js` regenerates it (authoring).
- `corpus/battery.json` — 52 frozen cases: canonical input + expected
  output authored by the **independent oracle** (`corpus/oracle.js`),
  written separately from `src/` directly against the brief. `make-battery.js
  --diff` adjudicates oracle-vs-implementation divergence (0/52 at freeze).
- `corpus/derivation-notes.md` — hand-derived figures for the 12 named
  fixtures and design notes for the 40 variants.
- `corpus/manifest.json` + `corpus_digest.txt` — SHA-256 pins of every file
  and the corpus digest (the separately trusted root).
- `runner/run-manual.js` — manual single-fixture run (`--md` for Markdown).
- `runner/measure-latency.js` — per-case timing vs the 5s watchdog.
- `tests/` — `run-tests.js` (bootstrap: verifies the full corpus digest
  against the host-supplied `FM_APPROVED_ROOT` with node builtins only,
  then spawns `node --test`); battery, schemas, injection, limits,
  determinism, mutation, markdown suites.

## Run

```sh
FM_APPROVED_ROOT=<host-fixed-root> npm test   # trust-verified full suite
npm run battery  # battery suite only (dev shortcut; not the trust-verified path)
node runner/run-manual.js fm-06
node runner/run-manual.js fm-04 --md
node runner/measure-latency.js
```

`npm test` requires the separately trusted approval root as a host-supplied
`FM_APPROVED_ROOT` environment variable and fails closed (exit 3) when it is
absent or does not match the pinned corpus. The root is never carried in the
candidate tree (`package.json` carries no root); the authoritative value lives
outside this package (recorded in forge-ai-drop with the review).

**Trust boundary.** The authenticated entrypoint is
`node tests/run-tests.js` invoked directly with `FM_APPROVED_ROOT` set.
`tests/run-tests.js` imports node builtins only and authenticates every
pinned file — including `package.json` and every executable entrypoint —
against the host-supplied root *before* any scored helper is imported, so a
tampered helper can never execute pre-verification. `npm test` merely
delegates to that file; npm itself authenticates nothing, so
candidate-controlled npm metadata (`package.json` scripts) is **not** a
trust entrypoint. A host that delegates to npm MUST authenticate the
candidate package bytes first (e.g. by running the launcher above, whose
digest covers `package.json`).

Zero runtime dependencies, zero model calls, pure Node 24 ESM.

## Limitations (non-goals)

No real ledger/database/banking API/FORGE accounting access; no issued
statements, external transmission, filing, money movement, or
investment/tax/legal advice; no transaction-level classification or audit;
summary inputs only (transaction auditing is the Finance Agent's lane). The
host renders synthetic preview only. The injection recognizer flags seeded
families; security rests on the absence of capabilities (no shell, network,
file writes, or execution of submitted strings), not on regex claims.
