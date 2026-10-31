# Team Brain P5 — immutable episode capture + deterministic retrieval

Logical operation: `search_memory(query, scope, as_of) → ranked results`.

Scope: GS-P5 (ChatGPT GO on fix round 1, drop `4050f760`) as an addendum
to the parent persistence-and-queue contract (Jason-approved 2026-10-14).
Baseline: marketplace409 main `9313e75d` (post-#693, post-#695/#696).

## Layout

| Path | Responsibility |
|---|---|
| `schema.sql` | P5-only tables (episodes, grants, pins, working set, revision counter, episode events). Does not touch migration 001 or its pinned snapshot. |
| `repository.mjs` | Capture + search + pins + working set over any `query(sql, params)` handle (PGlite in tests, pg in production). |
| `citation.mjs` | Pure citation oracle/scorer: full citation identity vs the labeled fixture, never vs a second renderer call. |
| `errors.mjs` | P5 typed codes on the shared `TeamBrainError`. |
| `fixtures/labeled-queries.json` | 40 independently labeled queries with expected citations over 21 synthetic episodes. |
| `fixtures/labeled-queries.receipt.json` | Fixture authentication receipt: sha256 + counts + oracle/scorer rule. Re-issue on any fixture change. |

## Retrieval contract (fixed, not open)

- PostgreSQL full-text search (`to_tsvector` / `plainto_tsquery` /
  `ts_rank` / `ts_headline`), exact-ID lookup, scope retrieval.
- Maximum 20 candidates. `truncated` + `totalAuthorized` reported.
- Historical pins: a pin name binds one revision; repointing to a
  different revision is refused. `as_of` is a revision number; `as_of`
  and `pin` together are refused. A pin or `as_of` above the admitted
  high-water mark is refused with `FUTURE_REVISION`, never silently
  clamped; revision 0 (empty store) stays valid.
- Four-slot durable-reference working set, per principal. Displacement
  validates before writing: the episode must exist, be in an allowed
  scope, and be readable by the slot owner, and the revision must be
  exactly the episode's version. Reads revalidate eligibility; a
  withheld reference reads back as null and discloses no identity. A
  denied displacement preserves the prior valid slot.
- Capture identity includes visibility, grants as a set,
  provenanceStatus, and state. A capture differing in any of them is a
  new episode, never a silent replay of different authority. Exact
  replays still replay.
- Archive appends an explicit event row (revision + note/actor/time)
  and bumps the retrieval revision; the episode row never changes. A
  latest-state query projects ARCHIVED while an earlier pin projects
  the original state. Archive replay is idempotent.
- Concurrency: every operation on one connection serializes through a
  connection-scoped promise chain shared by all repository instances
  on that handle. In-process only; no cross-process fencing is claimed.
- Citation evidence: the scorer compares every result's full citation
  (episode, repo, path, commit, blob, revision, watermark) against the
  labeled fixture oracle. The fixture receipt binds the fixture bytes
  by sha256; the scorer test proves invented commit/blob pins fail.
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
snippets, counts, and diagnostics — including conflict metadata:
conflict counterparts pass the same authorization, allowed-domain,
scope, and revision boundary as retrieval (the FTS keyword match is
not applied to counterparts, so an authorized contrary statement is
never hidden by keyword mismatch).

## Result binding

Every result carries: `episodeId`, `scope`, `title`, `snippet`,
`score`, `capturedAt`, `revision`, `state`, `freshness` (`current`
when the episode revision equals the query's as_of revision — the
latest revision for an unpinned search — else `historical`), `provenanceStatus`, `hasConflict` + `conflictWith`
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
only): operations on one connection serialize through a shared
promise chain, and two concurrent writers in different processes may
still interleave revisions. Episode rows are never updated; archive
appends an event, and archived episodes stay retrievable.

## Tests

`scripts/team-brain/__tests__/tbp5Retrieval.test.mjs` — PGlite
in-memory, no network, no live database, no credentials. Run:

```bash
npx vitest run scripts/team-brain/__tests__/tbp5Retrieval.test.mjs --testTimeout=30000
```
