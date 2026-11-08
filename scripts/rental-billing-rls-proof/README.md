# Rental billing RLS proof (scratch PostgreSQL 16)

Behavioral proof for `supabase/migrations/20261108000000_rental_billing_audit_insert_policies.sql`,
fix round 1 (ChatGPT verdict NEEDS CHANGES, drop `0ce90438`, P1: same-workspace
unauthorized-role bypass).

## What it proves

The seven new policies use `has_workspace_access(owner_id)` as their predicate. The P1
question was whether a same-workspace member without billing authority (manager,
bookkeeper, read-only member, invited/suspended co-owner) could bypass the RPCs'
owner checks with a direct SQL/PostgREST write, since `authenticated` holds
relation-level INSERT/UPDATE on these tables (Supabase default grants) and RLS is
the only gate.

Live catalog evidence (read from production 2026-11-08, read-only) says the bypass
is impossible, and this suite proves it behaviorally:

- `has_workspace_access(text)` (verbatim from live) returns true **only** for the
  primary owner (`auth.uid() = owner_id`) or an **active `co_owner`** member. It
  hard-codes `role = 'co_owner' AND status = 'active'`.
- The workspace model has no other billing actor: `invite_workspace_member`
  rejects any role other than `co_owner`, and live data holds exactly one
  `workspace_members` row (active co-owner). The live role CHECK constraint does
  permit `manager`/`bookkeeper`/`read_only` values to exist — so this suite seeds
  active rows of each and proves the predicate still returns false for them.
- All five billing RPCs (verbatim from live) gate on the **same**
  `has_workspace_access(p_owner_id)` predicate. The RPC gate and the policy gate
  admit exactly the same callers, so a direct write cannot reach anyone the RPCs
  exclude. Tightening the policies to owner-only would BREAK the live co-owner
  billing workflow (Brandy, the co-owner, is the one who activates billing) — the
  canonical billing-write authority is owner + active co-owner.

## Cases (~95 checks)

- Phase 0: `has_workspace_access` per persona (owner, active/invited/suspended
  co-owner, manager, bookkeeper, read-only, unrelated owner, anon).
- Phase 1: pre-fix state — owner and co-owner writes denied (bug reproduced).
- Migration applied twice (idempotency) with the already-live cutover INSERT
  policy pre-created by hand; all 7 policies present exactly once.
- Phase 2: direct INSERT matrix on all 5 audit tables × 9 personas; settings
  INSERT/UPDATE per persona (UPDATE denial proven by read-back, since RLS UPDATE
  fails silently); all 5 RPCs per persona; SELECT visibility per persona.

## Running it

Requires a local PostgreSQL 16 cluster. It uses the scratch database `rlsproof`
on socket `/tmp`, port 5444, and drops/recreates it on every run. Never point it
at production.

```bash
# one-time cluster setup (as an unprivileged user — initdb refuses root):
initdb -D /tmp/rlsproof2/pgdata -U postgres --auth=trust
pg_ctl -D /tmp/rlsproof2/pgdata -o "-k /tmp -p 5444" -l /tmp/rlsproof2/log start

# run (from anywhere; paths resolve from this script):
bash scripts/rental-billing-rls-proof/run.sh
# expected tail: --- RESULT: <N> passed, 0 failed ---
```

`setup.sql` is the fixture; `run.sh` is the suite. The migration file under test
is resolved relative to the repo root.
