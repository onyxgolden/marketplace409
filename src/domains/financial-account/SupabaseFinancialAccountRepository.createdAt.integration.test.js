// Real-infrastructure regression test for the created_at-preservation trigger added by
// supabase/migrations/20260909060000_preserve_financial_accounts_created_at.sql -- proves the
// DATABASE actually preserves created_at across a real upsert, not just that the migration SQL
// text looks right. Run against a local Supabase stack (Postgres + PostgREST) via Docker -- never
// against the real, hosted project.
//
// financial_accounts has no foreign keys (confirmed via pg_constraint against the linked
// production project), so this test needs no auth users, no workspace, no connection/institution
// rows -- a single isolated row is enough to exercise the trigger in complete isolation.
//
// Writes go through raw `psql` (as the `postgres` superuser), not the JS service_role client:
// confirmed live against this same local stack that financial_accounts grants INSERT/UPDATE/
// DELETE only to its table owner (postgres), not even to service_role -- the exact same grant
// shape src/domains/health/__tests__/healthRpcs.integration.test.js already documents for
// workspace_members. A real upsert (INSERT ... ON CONFLICT DO UPDATE) is issued directly so the
// trigger is exercised exactly as it would be by the application's own upsert-based repository.
//
// Requires a local Supabase stack reachable at 127.0.0.1:54321/54322 (e.g. `supabase start`) --
// the same stack the health integration suite already targets. Self-skips (not fails) when that
// stack isn't reachable, so it never blocks a normal `vitest run` in an environment without
// Docker running.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const LOCAL_URL = "http://127.0.0.1:54321";
const DB_CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_marketplace409-reservation-validation";

const MIGRATION_SQL = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/20260909060000_preserve_financial_accounts_created_at.sql"),
  "utf8",
);

function psql(sql) {
  return execFileSync("docker", ["exec", "-i", DB_CONTAINER, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], {
    input: sql, encoding: "utf8",
  });
}

// Tuples-only, unaligned, pipe-separated -- for pulling exact column values back out of psql
// without any of its default table-formatting noise.
function psqlRow(sql) {
  const output = execFileSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-v", "ON_ERROR_STOP=1", "-t", "-A", "-F", "|", "-U", "postgres", "-d", "postgres"],
    { input: sql, encoding: "utf8" },
  );
  const line = output.trim().split("\n")[0] ?? "";
  return line.split("|");
}

async function isLocalStackReachable() {
  try {
    const response = await fetch(`${LOCAL_URL}/auth/v1/health`, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

const reachable = await isLocalStackReachable();

describe.skipIf(!reachable)("financial_accounts created_at preservation trigger (real local Supabase)", () => {
  const ownerId = `test-owner-${randomUUID()}`;
  const accountId = `financial_account_test_${randomUUID()}`;
  const secondAccountId = `financial_account_test_second_${randomUUID()}`;

  function upsertSql({ id, providerAccountId, createdAt, updatedAt, active }) {
    return `
      insert into financial_accounts (
        id, owner_id, connection_id, provider, provider_account_id, institution_id,
        name, official_name, mask, type, subtype, currency_code, active, created_at, updated_at
      ) values (
        '${id}', '${ownerId}', 'test_connection', 'test_provider', '${providerAccountId}', 'test_institution',
        'Test Checking', null, null, 'depository', 'checking', 'USD', ${active}, '${createdAt}', '${updatedAt}'
      )
      on conflict (owner_id, provider, provider_account_id) do update set
        active = excluded.active,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
      returning created_at, updated_at, active;
    `;
  }

  beforeAll(async () => {
    // Idempotency guard, matching the health integration suite's own pattern: a prior killed run
    // may have left the trigger/function behind, but re-applying the migration is always safe.
    psql("drop trigger if exists trg_preserve_financial_accounts_created_at on financial_accounts;");
    psql("drop function if exists preserve_financial_accounts_created_at();");
    psql(MIGRATION_SQL);
  }, 30000);

  afterAll(async () => {
    if (!reachable) return;
    psql(`delete from financial_accounts where owner_id = '${ownerId}';`);
  }, 30000);

  it("never changes created_at on an upsert, but still updates updated_at and other mutable fields", async () => {
    const [firstCreatedAt] = psqlRow(upsertSql({
      id: accountId,
      providerAccountId: "test_provider_account",
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
      active: true,
    }));
    expect(firstCreatedAt).toBe("2020-01-01 00:00:00+00");

    // Re-import: same conflict key (owner_id, provider, provider_account_id), a much later
    // created_at (exactly what a re-mapped account would send, per the confirmed production bug),
    // a changed mutable field, and a new updated_at.
    const [reimportedCreatedAt, reimportedUpdatedAt, reimportedActive] = psqlRow(upsertSql({
      id: accountId,
      providerAccountId: "test_provider_account",
      createdAt: "2026-09-09T03:20:59.626Z",
      updatedAt: "2026-09-09T03:20:59.626Z",
      active: false,
    }));

    // The whole point of the fix: created_at is pinned to its ORIGINAL value, not the reimport's.
    expect(reimportedCreatedAt).toBe("2020-01-01 00:00:00+00");
    // Everything else still updates normally -- this is not a "freeze the whole row" trigger.
    expect(reimportedUpdatedAt).toBe("2026-09-09 03:20:59.626+00");
    expect(reimportedActive).toBe("f");
  });

  it("still lets a genuinely new account (different provider_account_id) insert with its own fresh created_at", async () => {
    const [insertedCreatedAt] = psqlRow(upsertSql({
      id: secondAccountId,
      providerAccountId: "test_provider_account_second",
      createdAt: "2026-09-09T04:00:00.000Z",
      updatedAt: "2026-09-09T04:00:00.000Z",
      active: true,
    }));

    // The trigger only fires BEFORE UPDATE, never BEFORE INSERT -- a brand-new row keeps whatever
    // created_at it was inserted with.
    expect(insertedCreatedAt).toBe("2026-09-09 04:00:00+00");
  });
});
