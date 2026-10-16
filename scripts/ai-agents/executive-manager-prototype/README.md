# Executive Manager Agent — Phase 2 slice 1 synthetic prototype

Inert DRAFT executive rollup over synthetic status-report fixtures. It
reports; it never tasks agents, suppresses findings, approves/deploys,
or updates any actual tracker. Pure Node 24 ESM, zero runtime
dependencies, zero model calls, zero network.

Advisory only. Fixture-only. No real status reports, no real customer/
tenant/financial/production data. No activation.

## Deliverable

- Source-label-faithful per-report projections (`source_reports`).
- Cross-report **derived statements** on two independent axes:
  - **support strength** — minimum-wins across occurrences
    (`verified` > `attributed_only` > `unverifiable`; a flag-only source
    with no strength claim folds into `unverifiable`).
  - **flags** — set union across occurrences, never ranked or cleared
    into a strength level.
  - An unrecognized support label is always invalid. Differing KNOWN
    strengths across sources is the ordinary case min-wins exists to
    resolve — it is only promoted to "invalid, contradictory strengths"
    when at least one of the differing occurrences also carries the
    explicit `contradicted` flag (a source flagging real disagreement,
    not merely reporting with lower confidence).
- **Metric dedup** at full identity (`metric_key, population_id, unit,
  period, currency, line_item_id`): same identity + same value dedups
  to one fact; same identity + different value is a **contradiction**
  (both values shown, no averaging, excluded from totals).
- **Two-layer metric totals**: per-population (trivial sum of that
  population's own distinct line items), then per registered
  `population_group` — licensed to sum member populations ONLY when
  the group is registered `disjoint:true` and every member's own total
  is itself resolved. Unregistered or non-disjoint combinations are
  `unverifiable`, not silently summed.
- **Header comparisons** at their own grain: a header claim's
  `population_id` names either a real population (its own total) or a
  registered group (the licensed combined total). A header value is
  always a claim being checked — never an input to its own
  verification, and never itself fed into a total. A mismatch (claimed
  ≠ computed) is a successful, fully-resolved finding, not an error
  state; only an unresolved (`unverifiable`) comparison affects
  completeness.

## Budget discipline (two lessons carried forward in this program)

1. **Per-record incremental charging** (Financial Manager precedent):
   every report, statement, metric line and header claim is charged
   via `budget.countObject()` as the first statement of its loop
   iteration — attempt 65 refuses before that candidate, or any later
   one, is inspected at all. Byte-span verification is a separate
   charge (`countSpan()`).
2. **Trusted context is charged under the same budget** (Customer
   Success CS-001 / Document Agent DOC-002 precedent): the principal,
   criteria, population groups, read grants, and every registered
   source key + revision are charged — on BOTH dimensions, object
   count AND payload bytes — before any of their fields are read.
   `src/contextGuard.js` is the dedicated module for this; see its
   module doc for the exact reproduction this closes (one unused
   300,000-byte revision bypassing the 256 KiB cap entirely because
   only its *presence* was ever checked, never its *size*).

## Trust bootstrap

`EM_APPROVED_ROOT` (64-hex SHA-256) must be supplied externally by the
reviewer/CI invoking `npm test` / `npm run battery` — never by this
package's own scripts. `tests/run-tests.js` and `tests/run-battery.js`
recompute the full corpus digest (every pinned file, via
`node:fs`/`node:crypto` only) and refuse (exit 3) before importing any
scored code if it doesn't match. Run `node corpus/freeze-corpus.js`
after any corpus-affecting change to recompute the digest, then record
the new value as the reviewed root in CI/reviewer config.

## Layout

```
src/            agent implementation (schemas, resolver, contextGuard,
                injection, rollup, index)
fixtures/       make-fixtures.js (authoring tool) + store.json
corpus/         oracle.js (independent re-derivation), make-battery.js
                (authoring tool), freeze-corpus.js (authoring tool),
                battery.json, manifest.json, corpus_digest.txt
tests/          node:test suite + battery harness/watchdog
runner/         manual CLI runner
```

## Commands

- `EM_APPROVED_ROOT=<digest> npm test` — unit test suite.
- `EM_APPROVED_ROOT=<digest> npm run battery` — full frozen battery.
- `node corpus/freeze-corpus.js` — recompute the manifest/digest after
  a corpus change (authoring only, never run as part of scoring).
