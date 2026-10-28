# Team Brain P1 — Postgres persistence service layer

## What P1 builds

P1 establishes the production PostgreSQL persistence foundation for the Team
Brain service. It does NOT build the worker daemon, Git transport, or
consolidation engine — those are later slices.

### Deliverables

1. **Production migration** (`migrations/production/001_team_brain_production.sql`)
   - Private `team_brain` schema; all relations from the brief Section 3 data model.
   - Six least-privilege roles: `tb_owner` (NOLOGIN), `tb_ingest`,
     `tb_coordinator`, `tb_consolidator`, `tb_reader`, `tb_admin`.
   - Explicit grants; `REVOKE ALL FROM PUBLIC` on schema and objects.
   - History/event tables: no UPDATE/DELETE grants to worker roles.
   - **NOT APPLIED to production by any code path.** Production apply requires
     Jason's explicit migration word, a database backup, and an exact-head
     receipt (brief Section 8, gate 3).

2. **Transactional repository adapter** (`postgres/repository.mjs`)
   - Same API as the prototype `ledger/repository.mjs`.
   - Every lifecycle transition runs in an explicit `BEGIN`/`COMMIT`/`ROLLBACK`
     on a single dedicated `pg` connection. The prototype's sequential-await
     fallback is removed.
   - Row locks (`SELECT ... FOR UPDATE`) on lifecycle transitions.
   - Bounded retry (3x) on serialization (`40001`) and deadlock (`40P01`)
     with the SAME operation ID — a retry never creates a duplicate.
   - Per-transaction `statement_timeout = 5s`, `lock_timeout = 1s`.
   - Event idempotency via `idempotency_key` unique constraint.

3. **Tests** (`__tests__/postgres-persistence.test.mjs`)
   - 30+ tests against a REAL PostgreSQL server (not PGlite).
   - Migration: fresh install, idempotent replay, schema snapshot, no public tables.
   - Grants: least-privilege per role, negative grants on domain tables,
     append-only enforcement.
   - Transactions: rollback on error, concurrent same-ID winner, row_version
     increments, statement timeouts.
   - Idempotency, prototype API parity, auth override rejection at write.

### Boundaries (hard)

- NO Git network access in this slice.
- NO daemon/worker process.
- NO production migration apply.
- NO credentials in code or in the migration (passwords are `CHANGEME_*`
  placeholders for operator provisioning).
- Synthetic fixtures only in tests.

### Running the P1 tests

```bash
# Start a local PostgreSQL (or set TEST_POSTGRES_URL)
# The test creates and drops its own database.
TEST_POSTGRES_URL=postgresql://localhost:5432/postgres \
  npx vitest run scripts/team-brain/__tests__/postgres-persistence.test.mjs
```

### Prototype compatibility

The 68 existing prototype tests (`ledger`, `handoffs`, `queue`, etc.) run
unchanged against the PGlite backend. The `pg` adapter mirrors the prototype
API so behavior is identical; the P1 test suite spot-checks parity for the
core lifecycle operations.

---

# Team Brain P4 — Verified end-to-end handoffs

## What P4 builds

P4 composes the reviewed slice-1 handoff state machine and the reviewed
slice-3 coordination outbox into the brief Section 5 chain, replacing
caller attestation with independently produced evidence at every step.
It adds no migration, no worker daemon, no send adapter, and no
production write. Slice-1 and slice-3 modules are used unmodified.

### Deliverables

1. **Outcome publisher** (`service/verifiedHandoff.mjs`,
   `publishOutcome`) — one immutable outcome path per operation,
   written through the outbox with expected-blob CAS and a structural
   operation_id stamp (canonical envelope bytes). A retry reuses the
   same path and intent; a changed intent is a conflicting replay,
   never a second result path. A lost write reply yields
   DELIVERY_UNKNOWN — never "failed", never "delivered".
2. **Independent readback receipts** (`service/readback.mjs`,
   `service/gitIdentity.mjs`) — a separate Git read adapter fetches
   the pinned commit/path bytes; the blob SHA-1 is recomputed here
   from those bytes and compared byte-for-byte. There is no `verified`
   input: passing one is refused (INVALID_READBACK_CLAIM).
3. **Queue receipts** (`recordQueueAnswer`) — the queue export is
   itself an outbox delivery, read back independently, and bound into
   a revisioned receipt (handoff + outcome + queue Git identity + row
   versions) BEFORE the machine advances to QUEUE_UPDATED. This state
   is explicitly not complete.
4. **COMPLETE+close** (`completeVerified`) — rechecks outcome,
   readback, queue receipt, provenance, head currency, and the
   row-version chain before mutating anything; any gap refuses with
   zero closes. A moved head with the outcome intact recovers by a
   fresh readback at the new head; a moved head with the outcome gone
   refuses as STALE_HEAD. The machine's COMPLETE commit and the ledger
   close are bridged by idempotent reconcile (see below), because the
   brief itself states this is a durable state machine across two
   systems, not a distributed atomic transaction.
5. **Restart reconciliation** (`reconcile`) — from any intermediate
   state, driven by Git truth and outbox state. Same identity/content
   resumes; divergent content halts as CONFLICTING_REPLAY; unknown
   states report NEEDS_EVIDENCE or BLOCKED, never a guess. Worker
   fencing (workerId + monotonic generation) refuses stale workers;
   a strictly greater generation takes over.
6. **Worker fencing and provenance gating** — every mutation checks
   the bound worker/generation, and readback + complete require a
   host-injected provenance adapter reporting VERIFIED. Absent or
   non-VERIFIED provenance blocks; it never defaults to verified.

### Composition points (host wiring, not this slice)

- `git` adapter: `{ head(repo), read({ repo, commit, path }),
  write({ repo, path, expectedPriorBlob, bytes }) }` with
  TeamBrainError codes GIT_NOT_FOUND, GIT_UNAVAILABLE,
  GIT_CAS_CONFLICT, GIT_LOST_REPLY. The read adapter must be
  independent of the writer's buffers.
- `provenanceFor({ handoffId, taskId, artifact })` returning
  `{ status: "VERIFIED" | ... }`. P2's registry adapter supplies this
  at activation; P4 only defines the callback shape and fails closed
  without it.
- Receipt ledger: the plain JSON-serializable object from
  `createHandoffLedger()`, persisted by the host across restarts. A
  fresh driver over the same ledger IS a restart.
- Task records: the host-owned slice-3 controller list, passed per
  call. The driver's close marker is `handoffClose` on the task; it
  never fabricates an agent result.

### Tests (`__tests__/tbp4VerifiedHandoffs.test.mjs`)

57 tests, all synthetic (sandbox Git, PGlite machine, pure outbox):
crash after every external/local boundary, lost Git success (outcome
and queue-export), wrong repo/path/blob/head/time/actor/reason replay,
stale worker (older generation, same-generation other worker,
takeover), head moves before consumption (intact and gone), missing
and revoked provenance, queue receipt mismatch, evidence gaps, CAS
conflict recovery, payload drift, and a zero-unverified-closes
meta-test. One test reopens a real PGlite data directory to prove
machine state survives a backend restart.

### Running the P4 tests

```bash
npx vitest run scripts/team-brain/__tests__/tbp4VerifiedHandoffs.test.mjs
```

### Boundaries (hard)

- NO migration, migration apply, or production write.
- NO worker install, activation, cutover, role LOGIN/password
  provisioning, or authority registration changes.
- NO notification, browser, or send capability.
- NO P5+ scope. Slice-1 and slice-3 modules are not modified.
- Synthetic fixtures only in tests; no live tenant/domain data.
