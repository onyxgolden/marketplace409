# Brandy receptionist RLS + FK proof (fix round 2)

Behavioral proof for `supabase/migrations/20261108000000_rental_receptionist_calls_events_drafts.sql`
on a real PostgreSQL 16 scratch cluster. Mirrors
`scripts/rental-billing-rls-proof/` (#753) — same persona matrix, same
`auth.uid()` stub, same live-faithful `has_workspace_access`.

## Run

```bash
# the scratch cluster must be up (socket /tmp, port 5444):
#   ls /tmp/.s.PGSQL.5444  — if missing, start it as the postgres user:
#   sudo -u postgres /usr/lib/postgresql/16/bin/pg_ctl -D /tmp/rlsproof2/pgdata \
#     -o "-k /tmp -p 5444" -l /tmp/rlsproof2/logfile start
bash scripts/brandy-receptionist-rls-proof/run.sh
```

Exits non-zero on any failed case. The script drops and recreates the
`rlsproof` database — never point it at production.

## What it proves

- **P0** — the predicate itself: owner and active co-owner admitted;
  invited/suspended co-owner, manager, bookkeeper, read-only, unrelated
  owner denied.
- **P1-1** — the migration applies cleanly on real Postgres; calls has
  `UNIQUE(owner_id, id)`; all three composite FKs exist; a FK without a
  matching unique fails (why the unique matters); cross-owner event/draft
  inserts fail the FK.
- **P1-2** — service_role can upsert a call twice on `provider_call_sid`
  (one row) and can update `maintenance_draft_id`.
- **P1-5 / hardening** — authenticated SELECT sees only the caller's own
  workspace rows (owner/co-owner 1 row, everyone else 0); authenticated
  INSERT/UPDATE/DELETE on calls, INSERT on events/drafts/alerts all
  denied; owner UPDATE on drafts (review notes) succeeds, manager's does
  not.
- **P1-6** — `callback_e164_encrypted` is `bytea`, not `text`; a service
  blob stores. (The encrypt/decrypt roundtrip, access, log and rotation
  tests live in `src/lib/receptionist/__tests__/callbackCrypto.test.js`.)
- **P2-1** — the nonce lifecycle (fix round 2, P1-2): claim returns
  fresh / retry / committed / hash_mismatch; complete commits only from
  IN_PROGRESS or FAILED with the matching hash and stores the result;
  fail marks IN_PROGRESS failed and never un-completes; the old
  commit-before-write consume RPC is gone; all three lifecycle RPCs are
  service-only; stale rows are purged by the claim.
- **P1-3** — a conflict-ignored draft upsert returns zero rows (the
  `.single()` trap); the owner-scoped fallback SELECT finds exactly the
  one existing draft and the conflict path does not reset its state.
- **P2-2** — duplicate draft upsert keeps exactly one draft; a plain
  duplicate insert fails the unique; owner APPROVE is a preliminary
  decision with `maintenance_request_id` still null (no canonical record).
- **Append-only events** — UPDATE/DELETE on events fail the trigger even
  for service_role.
- **Grants + policy inventory** — authenticated has SELECT-only on calls;
  service has SELECT/INSERT/UPDATE (no DELETE); anon has nothing; the
  nonce RPC is service-only; exactly the 5 expected policies exist and no
  policy references `app.current_owner_id`.
