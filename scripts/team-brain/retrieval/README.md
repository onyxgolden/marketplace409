# Team Brain P5 — immutable episode capture + deterministic retrieval

Logical operation: `search_memory(query, scope, as_of) → ranked results`.

Scope: GS-P5 (ChatGPT GO on fix round 1, drop `4050f760`) as an addendum
to the parent persistence-and-queue contract (Jason-approved 2026-10-14).
Baseline: marketplace409 main `9313e75d` (post-#693, post-#695/#696).

## Layout

| Path | Responsibility |
|---|---|
| `schema.sql` | P5-only tables (episodes, grants, pins, working set, revision counter). Does not touch migration 001 or its pinned snapshot. |
| `repository.mjs` | Capture + search + pins + working set over any `query(sql, params)` handle (PGlite in tests, pg in production). |
| `errors.mjs` | P5 typed codes on the shared `TeamBrainError`. |
| `fixtures/labeled-queries.json` | 40 independently labeled queries with expected citations over 21 synthetic episodes. |

## Retrieval contract (fixed, not open)

- PostgreSQL full-text search (`to_tsvector` / `plainto_tsquery` /
  `ts_rank` / `ts_headline`), exact-ID lookup, scope retrieval.
- Maximum 20 candidates. `truncated` + `totalAuthorized` reported.
- Historical pins: a pin name binds one revision; repointing to a
  different revision is refused. `as_of` is a revision number; `as_of`
  and `pin` together are refused.
- Four-slot durable-reference working set, per principal.
- Cosine / vector-store selection is NOT built and NOT an open
  decision for this slice.

## Ranking (deterministic, total order)

Score DESC, `captured_at_ms` DESC, `episode_id` ASC. An exact-ID hit
scores 1e9 (above any `ts_rank`) and therefore sorts first. Episode
ids are unique, so the chain is total: same store + same query always
yields byte-identical results.

## Authorization order (enforced in SQL, not in prose)

Grants, visibility, forbidden scopes, scope, and the as_of revision
filter in the query itself, before ranking and limiting. The reported
count is the authorized count only. Denied episodes are invisible to
snippets, counts, and diagnostics. A caller principal is required;
anonymous retrieval is refused.

## Result binding

Every result carries: `episodeId`, `scope`, `title`, `snippet`,
`score`, `capturedAt`, `revision`, `state`, `freshness` (`current`
when the episode revision equals the latest revision, else
`historical`), `provenanceStatus`, `hasConflict` + `conflictWith`
(other members of its conflict group at the same as_of revision),
`uncertainty`, `citation` (episode id + full source identity +
revision + watermark), `dbRevision` (the as_of revision used), and
`sourceWatermark`. Missing provenance yields `snippet: null`,
`body: null`, `provenanceStatus: UNAVAILABLE`,
`unavailableReason: MISSING_PROVENANCE` — an explicit unavailable
result, never an unattributed hit.

## Exclusion

Scopes `tenant`, `ledger`, `financial`, `enrollment`, `scheduling`
are refused at capture and excluded from search even on direct
inserts. Exclusion is scope-based by design: a keyword scan would
false-positive on engineering text that merely mentions ledgers or
schedules.

## Bounds (inherited service bounds)

20 results max; 500-character snippets; 64 KiB episode bodies;
500-character titles; parameterized queries only (no interpolation —
injection-hostile content is covered by tests).

## Gates (never in this slice)

No DB role LOGIN/password provisioning, no authority registrations,
no worker install/activation, no P8 cutover, no production migration,
no spend. Cross-process fencing is NOT claimed (001A holds in-process
only): the revision bump is one transaction on one connection, and
two concurrent writers may interleave revisions. Archive flips only
the state flag; content, source, and revision never change, and
archived episodes stay retrievable.

## Tests

`scripts/team-brain/__tests__/tbp5Retrieval.test.mjs` — PGlite
in-memory, no network, no live database, no credentials. Run:

```bash
npx vitest run scripts/team-brain/__tests__/tbp5Retrieval.test.mjs --testTimeout=30000
```
