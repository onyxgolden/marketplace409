# Rental admin permissions — slice 1: real-PostgreSQL proof

Runs the slice-1 migration against a scratch PostgreSQL 16 cluster and
proves, on real Postgres (not PGlite):

- The migration applies on top of the REAL prior definitions (the R17
  NO-GO fix functions and the real #753 billing policies), not stubs.
- The legacy R17 branch is unchanged by the `has_rental_permission`
  replacement.
- The #753 billing gates still enforce after this migration.
- Concurrent role edits with the same expected version: exactly one wins.
- Audit failure rolls the role change back entirely (atomicity).
- RLS tenant/maintenance spot checks per role (the full matrix is in the
  PGlite migration test,
  `supabase/migrations/__tests__/20261110010000_rental_admin_roles_slice1.migration.test.js`).
- Effective ACL / RLS / function EXECUTE receipts
  (`proof-receipts.json`, written next to this script).
- The proof sets Supabase-like default privileges before applying the
  slice-1 migration (PR #766 P1): production's `pg_default_acl` grants
  function EXECUTE to the named roles anon/authenticated/service_role
  with no PUBLIC entry, so a `REVOKE ... FROM public` alone is a no-op.
  G3/G5 assert against that shape — G5 proves anon cannot execute
  `rental_admin_user_role_json` at all.

## Run

```sh
# Scratch cluster (as the postgres OS user; never production):
runuser -u postgres -- /usr/lib/postgresql/16/bin/initdb -D /tmp/rental-admin-pg16/data -U postgres --auth=trust
runuser -u postgres -- /usr/lib/postgresql/16/bin/pg_ctl -D /tmp/rental-admin-pg16/data \
  -o "-p 54399 -k /tmp/rental-admin-pg16" -l /tmp/rental-admin-pg16/server.log start

# Proof (from the repo root):
PGHOST=/tmp/rental-admin-pg16 PGPORT=54399 PGUSER=postgres PGDATABASE=postgres \
  node scripts/rental-admin-permissions-proof/proof.mjs

# Stop the cluster when done:
runuser -u postgres -- /usr/lib/postgresql/16/bin/pg_ctl -D /tmp/rental-admin-pg16/data stop
```

Exit 0 when every check passes. The script creates its own roles, schema,
and tables inside the scratch database; it touches nothing else.

Re-running needs a fresh database (roles are cluster-global, so drop the
database first — the cluster itself can stay up):

```sh
psql -h /tmp/rental-admin-pg16 -p 54399 -U postgres -c "drop database rental_admin_proof;" -c "create database rental_admin_proof;"
```
