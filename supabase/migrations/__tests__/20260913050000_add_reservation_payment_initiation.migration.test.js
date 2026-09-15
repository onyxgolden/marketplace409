import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const LOCAL_URL = "http://127.0.0.1:54321";
const DB_CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_marketplace409-reservation-validation";
const migrationPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../20260913050000_add_reservation_payment_initiation.sql",
);
const migrationSql = fs.readFileSync(migrationPath, "utf8");
const lowerSql = migrationSql.toLowerCase();

function psql(sql) {
  return execFileSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"],
    { input: sql, encoding: "utf8" },
  );
}

async function reachable() {
  try {
    return (await fetch(`${LOCAL_URL}/auth/v1/health`, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}

const localStackReachable = await reachable();

describe("RV-E2B reservation payment initiation migration", () => {
  it("is reservation-native and never fabricates lease-domain records", () => {
    expect(lowerSql).toContain("public.reservation_payment_attempts");
    expect(lowerSql).not.toMatch(/insert into public\.(rental_tenants|rental_leases|rent_schedules|rent_charges|rental_payments)/);
  });

  it("is test-mode and booking-balance only", () => {
    expect(lowerSql).toContain("provider_mode = 'test'");
    expect(lowerSql).toContain("'booking_balance'");
    expect(lowerSql).not.toContain("'security_deposit',");
    expect(lowerSql).not.toMatch(/create table.*settlement/);
  });

  it("derives amount and identity only from the private-token-bound financial contract", () => {
    expect(lowerSql).toContain("reservation.guest_access_token = p_access_token");
    expect(lowerSql).toContain("settings.public_booking_slug = btrim(p_booking_slug)");
    expect(lowerSql).toContain("v_contract.booking_balance_cents");
    expect(lowerSql).toContain("v_attempt.owner_id");
    expect(lowerSql).toContain("v_attempt.reservation_id");
  });

  it("serializes duplicate initialization and resumes one active attempt", () => {
    expect(lowerSql).toContain("pg_advisory_xact_lock");
    expect(lowerSql).toContain("payment_status in ('created','pending','processing')");
    expect(lowerSql).toContain("'idempotencykey', v_attempt.idempotency_key");
    expect(lowerSql).toContain("'providerpaymentid', v_attempt.provider_reference");
  });

  it("allows a provider reference to bind exactly once without weakening terminal monotonicity", () => {
    expect(lowerSql).toContain("old.provider_reference is null");
    expect(lowerSql).toContain("new.provider_reference is not null");
    expect(lowerSql).toContain("old.payment_status = 'created'");
    expect(lowerSql).toContain("new.payment_status = 'pending'");
    expect(lowerSql).toContain("reservation payment status transition is not monotonic");
    expect(lowerSql).not.toContain("old.payment_status = 'succeeded' and new.payment_status in ('pending','processing')");
  });

  it("grants only service_role execution and no raw table writes", () => {
    expect(lowerSql).toContain("grant execute on function public.begin_public_reservation_payment_attempt(text,text)");
    expect(lowerSql).toContain("grant execute on function public.record_public_reservation_payment_intent(text,text,text)");
    expect(lowerSql).toContain("grant execute on function public.fail_public_reservation_payment_attempt(text,text)");
    expect(lowerSql).not.toMatch(/grant (insert|update|delete) on/);
    expect(lowerSql).not.toMatch(/grant execute.*to (anon|authenticated)/);
  });

  it("adds no webhook, settlement, payout, refund, dispute, or deposit mutation", () => {
    expect(lowerSql).not.toContain("payment_webhook_events");
    expect(lowerSql).not.toContain("reservation_payment_events");
    expect(lowerSql).not.toContain("settled_amount_cents =");
    expect(lowerSql).not.toContain("paid_out_amount_cents =");
    expect(lowerSql).not.toContain("refunded_amount_cents =");
    expect(lowerSql).not.toContain("disputed_amount_cents =");
  });
});

describe.skipIf(!localStackReachable)("RV-E2B migration against real local Supabase", () => {
  let beforeSnapshot;
  let afterSnapshot;

  // Content-hash per pre-existing row, per table, keyed by its own primary key -- not a raw
  // count(*). Vitest's default concurrency runs many test files against one shared local
  // Postgres, and other files legitimately insert/delete their own rows in these same four
  // tables at the same time; a plain count(*) treats any such concurrent activity as "this
  // migration changed data," which is a false failure (observed and root-caused while adding
  // 20260913010000_add_reservation_lifecycle.migration.test.js). Comparing only rows that
  // existed at snapshot time, by identity, proves the real claim -- reapplying this migration's
  // DDL performs no DML on any pre-existing row -- without being sensitive to unrelated
  // concurrent inserts (including this file's own later fixtures) or deletes.
  function snapshot() {
    const map = new Map();
    // reservation_financial_contracts is keyed (owner_id, reservation_id) -- it has no `id` column.
    const tables = [
      ["reservations", "id"], ["reservation_financial_contracts", "reservation_id"],
      ["reservation_payment_attempts", "id"], ["reservation_payment_events", "id"],
    ];
    for (const [table, keyColumn] of tables) {
      const output = psql(`select owner_id || '|' || ${keyColumn} || '|' || md5(row_to_json(r)::text) from ${table} r order by owner_id, ${keyColumn};`);
      for (const line of output.split("\n")) {
        if (!line) continue;
        const hash = line.slice(-32);
        map.set(`${table}:${line.slice(0, -33)}`, hash);
      }
    }
    return map;
  }

  beforeAll(() => {
    beforeSnapshot = snapshot();
    psql(`${migrationSql}\n${migrationSql}`);
    afterSnapshot = snapshot();
  });

  it("applies twice without changing any pre-existing reservation or financial row", () => {
    for (const [key, beforeHash] of beforeSnapshot) {
      const afterHash = afterSnapshot.get(key);
      if (afterHash === undefined) continue; // removed by unrelated concurrent cleanup, not by this migration
      expect(afterHash, `${key} content changed`).toBe(beforeHash);
    }
  });

  it("keeps all three initiation functions SECURITY DEFINER with row security disabled", () => {
    const output = psql(`
      select p.proname, p.prosecdef, array_to_string(p.proconfig, ',')
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in (
          'begin_public_reservation_payment_attempt',
          'record_public_reservation_payment_intent',
          'fail_public_reservation_payment_attempt'
        )
      order by p.proname;
    `);
    expect(output.match(/\|t\|search_path=public,row_security=off/g)).toHaveLength(3);
  });

  it("gives service_role all three RPCs and gives browser roles none", () => {
    const output = psql(`
      select
        has_function_privilege('service_role','public.begin_public_reservation_payment_attempt(text,text)','execute'),
        has_function_privilege('service_role','public.record_public_reservation_payment_intent(text,text,text)','execute'),
        has_function_privilege('service_role','public.fail_public_reservation_payment_attempt(text,text)','execute'),
        has_function_privilege('anon','public.begin_public_reservation_payment_attempt(text,text)','execute'),
        has_function_privilege('authenticated','public.begin_public_reservation_payment_attempt(text,text)','execute');
    `).trim();
    expect(output).toBe("t|t|t|f|f");
  });
});
