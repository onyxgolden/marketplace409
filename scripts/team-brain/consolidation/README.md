# Team Brain P6 — consolidation / replay engine

Scope: GS-P6 (ChatGPT GO Oct 29 as a design addendum) + parent
contract §4 limits and §6 starting settings (four-slot working set,
70/30 replay mix). Baseline: P5 branch tip `f579db6` (post-#693,
post-#695/#696 — the scope's "integrate only after #693 merges"
condition is satisfied). This slice is stacked on the P5 branch; it
does not touch the P5 branch itself.

## Layout

| Path | Responsibility |
|---|---|
| `schema.sql` | P6-only tables (runs, lease, facts, proposals, checkpoints, audit). Does not touch the P5 schema, migration 001, or their snapshots. Requires the P5 schema first (facts reference `tb_episodes`); `migrateP6` refuses with `MISSING_PREREQUISITE` otherwise. |
| `engine.mjs` | The six ordered steps + role gate + lease + receipts + audit export. |
| `scheduling.mjs` | Pure due-slot logic: 03:00 America/Chicago per civil date, DST-aware via Intl. |
| `errors.mjs` | P6 typed codes on the shared `TeamBrainError`. |

## Ordered steps

1. **Snapshot source watermark.** The run's watermark is a deterministic
   fingerprint over the authorized episodes at the snapshot revision
   (episode id + episode revision + source watermark, sorted), plus
   the authorized count. Denied episodes contribute nothing — not to
   the fingerprint, not to the count.
2. **Bounded deterministic recent/older replay selection.** 70/30
   mix (parent §6 starting setting): 70% of the limit from episodes
   captured within 30 days before the slot instant, 30% older. Each
   side orders `captured_at_ms` DESC, `episode_id` ASC; a short side
   is filled from the other; the total never exceeds the limit
   (default 50). Only ACTIVE-at-snapshot, authorized, allowed-scope
   episodes are selected.
3. **Source/grant verification and typed duplicate/conflict
   detection.** An episode promotes only when it passes every gate:
   complete provenance, no multi-member authorized conflict group,
   not a later duplicate. Duplicates normalize title+body (trim,
   collapse whitespace, lowercase); the first episode in selection
   order is canonical. Conflict counterparts pass the same
   authorization boundary as retrieval — a denied counterpart is
   invisible, never a conflict.
4. **Closed-schema proposed actions.** CONFLICT proposals (one per
   group, authorized member list) and DUPLICATE proposals
   (canonical + duplicates) are persisted OPEN. Re-filing an
   identical proposal replays. The engine never closes a proposal.
5. **Guarded permitted apply through `tb_consolidator`.** Only role
   `tb_consolidator` may apply. Any other role fails fast with
   `ROLE_DENIED` before any write, and the apply step re-checks the
   role before writing a fact row. Promotion inserts fact rows
   idempotently; reverify archives facts whose source episode is
   ARCHIVED at the snapshot (state flag + note only, never DELETE).
6. **Fenced checkpoints, counts/receipts, audit export.** Each step
   writes its checkpoint before the next starts. The run receipt
   (deterministic id = sha256 over the canonical receipt body)
   is stored on the run row and replays byte-identically. Audit
   export reads the append-only audit rows in sequence order.

## What promotes, what proposes, what never happens

- **Promoted (auto-applied):** verified uncontested typed event
  facts only. Every promoted episode earns `EPISODE_RECORDED`,
  `SOURCE_VERIFIED`, `SCOPE_CLASSIFIED`, `CONFLICT_FREE`; a
  duplicate-set canonical additionally earns `DUPLICATE_CANONICAL`.
- **Proposed (for Jason, never auto-applied):** conflicts,
  duplicates, standing rules, permission changes.
- **Never from replay:** `STANDING_RULE` and `PERMISSION_CHANGE`
  proposals. Episode text is evidence, never authority. The explicit
  filing path for those two types requires an authorization record
  (`{ id, note }`); without it the filing is refused with
  `AUTHORIZATION_REQUIRED`. The engine records the claimed
  authorization; verifying the claim is out-of-engine (Jason's word
  is verified by humans, same as verdicts). `CONFLICT`/`DUPLICATE`
  are replay-only through the explicit path.
- **Never at all in this slice:** deleting anything; closing a
  proposal; closing an obligation; changing a standing rule;
  granting or expanding a permission; backfilling a missed slot.

## Scheduling

One logical 03:00 America/Chicago run per civil date. Due-slot logic
only: a run for a date executes only when its slot instant has
arrived (`SLOT_NOT_DUE` otherwise). A date whose slot passed with
no run is recorded `MISSED` when a later run walks back over it
(30-day lookback, stops at the first existing row; a first-ever run
marks nothing — it establishes the baseline). A `COMPLETED` run
replays its stored receipt on re-invocation: no re-apply, no
duplicate facts.

## Lease, restart, two workers (in-process boundary only)

The lease row is cooperative, not cross-process fencing (001A holds:
no fencing claim). A normal run takes only a FREE lease (atomic
`UPDATE ... WHERE holder IS NULL`). A crashed holder's lease stands
until an explicit recovery with the same holder id
(`recover: true`); a different holder is refused with `LEASE_HELD`,
and a run without `recover` against a held lease is refused too.
Recovery recomputes every step from the store; all writes are
`ON CONFLICT DO NOTHING`, so resumed work writes nothing new. A
second worker contending for the same run gets `LEASE_HELD` with no
partial work.

## Exclusion

Scopes `tenant`, `ledger`, `financial`, `enrollment`, `scheduling`
are refused and excluded, same list as P5 (single-sourced from the
P5 repository module). Exclusion is scope-based by design.

## Gates (never in this slice)

No DB role LOGIN/password provisioning, no authority registrations,
no worker install/activation, no P8 cutover, no production
migration, no spend. Real PostgreSQL role enforcement is a P7
deployment concern; the engine enforces the same matrix in code
(role check before any write + re-check at apply), and the tests
prove lesser roles get zero persisted effects in an isolated
database. Cross-process fencing is NOT claimed.

## Determinism notes

- Same store + same principal + same run date + same limit always
  yields the same selection, verification, proposals, facts, and
  receipt id. Wall-clock values (`now`) are inputs, not reads, so
  tests pass fixed instants.
- 03:00 always exists on both DST transition days in
  America/Chicago (spring forward skips 02:00–02:59; fall back
  repeats 01:00–01:59). The conversion still round-trips through
  Intl and refuses if it does not read back as 03:00 on the
  requested date.

## Tests

`scripts/team-brain/__tests__/tbp6Consolidation.test.mjs` — PGlite
in-memory, no network, no live database, no credentials. Run:

```bash
npx vitest run scripts/team-brain/__tests__/tbp6Consolidation.test.mjs --testTimeout=30000
```

`scripts/team-brain/__tests__/tbp6FixRound1.test.mjs` — fix-round
partners for ChatGPT findings TBP6-001..007 (verdict 2026-10-31),
same PGlite setup. Run both files together for the full battery.

## Fix round 1 (ChatGPT TBP6-001..007, 2026-10-31)

- **Principal binding (001).** Every run is bound to a principal
  (`tb_consolidation_run_bindings.principal`) and a slot. A
  COMPLETED replay, `getRunReceipt`, and `exportAudit` all require
  the same principal; the argument is required, there is no
  implicit reader. Reverify joins facts to authorized episodes, so
  a denied principal's facts are never scanned, archived, or
  reported. MISSED-row audit exports carry no episode data and any
  principal may read them.
- **Restart fences (002).** The binding (principal, slot, settings,
  source revision) is written before any step work. A retry with no
  run row but an existing binding resumes that binding instead of
  overwriting it; a retry with different principal, limit, or
  budgets is refused (`PRINCIPAL_MISMATCH` /
  `RUN_BINDING_MISMATCH`). Step checkpoints stay insert-only; only
  the INCOMPLETE checkpoint upserts. The final run row +
  RUN_COMPLETED audit commit in one explicit transaction, and a
  replay reconciles a missing RUN_COMPLETED row to exactly one.
  Step transactions were deliberately NOT used: single-connection
  sequencing plus idempotent writes plus binding convergence give
  the same single-logical-outcome guarantee without risking
  aborted-transaction poisoning on crash-injection handles. A
  binding with no row is never marked MISSED by a later run's
  missed walk (its own resume owns it).
- **Missed slots are terminal (003).** A MISSED row refuses ordinary
  execution (`SLOT_MISSED`); a fresh date that is not the current
  Chicago civil date refuses (`SLOT_EXPIRED`). Same-day late
  execution still succeeds. A run with no COMPLETED row in the
  30-day lookback but an older row records the window as MISSED
  plus an `outageBaseline` and a `RUN_OUTAGE_NOTED` audit entry
  (the old code wrongly treated it as first-ever). A bound
  continuation (INCOMPLETE row or orphan binding) is exempt from
  the same-day gate: it completes bound work, it does not execute
  a new historical date.
- **Conflict currency (004).** A newly multi-member authorized group
  supersedes the members' ACTIVE `CONFLICT_FREE` facts (state
  `SUPERSEDED`, row retained, never auto-reinstated). Other fact
  types stay ACTIVE; neither side is resolved; both sides go to
  Jason via the CONFLICT proposal. Historical receipts are
  unchanged.
- **Typed duplicates (005).** The duplicate key is
  scope + source (repo, path, commit, blob, exactly — never
  lowercased) + visibility + grants + normalized prose. Prose
  normalization is case-insensitive + whitespace-collapsed; source
  and identifier fields are compared exactly. Equal text with
  different typed identity promotes both facts and files a
  `similarityOnly` DUPLICATE proposal that suppresses nothing.
  True typed duplicates collapse to the canonical, which earns a
  fifth fact type, `DUPLICATE_CANONICAL`.
- **Real role boundary (006).** The per-run `role` option is REMOVED.
  Engine creation takes trusted config `{consolidatorRole}` (default
  `tb_consolidator`); execution identity is `SELECT current_user`
  at run start and re-checked before finalize. A mismatch refuses
  with `ROLE_DENIED` before any write. The receipt `role` is the
  verified database user. Proven in PGlite with real roles:
  postgres superuser denied, SELECT-only reader denied with zero
  writes, PUBLIC grants and inherited membership do not bypass,
  direct writes as a lesser role are denied by the database itself,
  and the strict-grant consolidator positive performs only Section
  4 effects (SELECT on P5 tables, full rights only on P6 tables).
- **Trusted budgets (007).** Budgets are engine-creation config
  (`{version, selectionLimitMax, consultedObjectMax,
  consultedByteMax, deadlineMs}`); a per-run limit above the cap
  refuses with `LIMIT_EXCEEDED` before any write, and per-run
  budget options are ignored. All consulted work is charged before
  processing (rows materialized plus rows written, objects plus
  `stableStringify` bytes). A stop persists an INCOMPLETE run row,
  an upserted INCOMPLETE checkpoint, and a `RUN_INCOMPLETE` audit
  entry, and returns `{incomplete: true}`; the next attempt resumes
  from binding cursors with a fresh per-attempt charge. Progress
  persists after EVERY row of a paged scan (snapshot, selection
  sides, reverify): per-page persistence would stall whenever a
  page exceeds a tiny budget. Documented exceptions: a single row
  larger than the byte budget is processed anyway, and a single
  conflict group larger than the object budget is processed whole
  — otherwise either could never complete. The deadline uses an
  injected clock (default `Date.now`); recorded timestamps still
  come from the caller's `now` input.

## Disclosed judgments (builder's calls, not scope text)

- The "snapshot source watermark" is a fingerprint over authorized
  episodes, not a single stored watermark string: P5 episodes each
  carry their own watermark, and no single one represents a run.
- The 30-day recent/older boundary operationalizes the contract's
  70/30 mix (the contract names the mix, not the window).
- Duplicate normalization is case-insensitive + whitespace-collapsed
  for prose (title/body) only; source and identifier fields
  (repo, path, commit, blob) and authorization fields (visibility,
  grants) are compared exactly — case-only differences in a commit
  hash are distinct facts, not duplicates (fix round 1, TBP6-005).
- A sole authorized member of a conflict group promotes (its
  contrary statements, if any, are denied to this principal and
  therefore invisible — same boundary as P5 conflict metadata).
- First-ever runs mark no missed dates (no history to judge
  against); the missed-slot rule applies once a baseline row
  exists.
