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
