import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DB_CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_marketplace409-reservation-validation";
const migrationPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../20260913060000_add_reservation_payment_application.sql");
const migrationSql = fs.readFileSync(migrationPath, "utf8");
const lowerSql = migrationSql.toLowerCase();

let dockerAvailable = false;
try {
  execFileSync("docker", ["--version"], { stdio: "ignore" });
  dockerAvailable = true;
} catch {
  dockerAvailable = false;
}

function psql(sql) {
  return execFileSync("docker", ["exec","-i",DB_CONTAINER,"psql","-At","-v","ON_ERROR_STOP=1","-U","postgres","-d","postgres"], { input: sql, encoding: "utf8" });
}

describe("RV-E2C reservation payment application migration", () => {
  it("is test-mode, reservation-native, and booking-balance only", () => {
    expect(lowerSql).toContain("limited to stripe test mode");
    expect(lowerSql).toContain("purpose = 'booking_balance'");
    expect(lowerSql).not.toMatch(/(rental_tenants|rental_leases|rent_schedules|rent_charges)/);
    expect(lowerSql).not.toContain("purpose = 'security_deposit'");
  });

  it("binds the provider event to canonical connected-account ownership and provider identity", () => {
    expect(lowerSql).toContain("provider_account_id = btrim(p_connected_account_id)");
    expect(lowerSql).toContain("owner_id = v_owner_id");
    expect(lowerSql).toContain("provider_reference = btrim(p_payment_intent_id)");
    expect(lowerSql).toContain("p_amount_cents is distinct from v_attempt.amount_cents");
  });

  it("serializes delivery and records provider event identity exactly once", () => {
    expect(lowerSql).toContain("pg_advisory_xact_lock");
    expect(lowerSql).toContain("provider_event_id = btrim(p_provider_event_id)");
    expect(lowerSql).toContain("'duplicate', true");
  });

  it("applies only succeeded booking funds while settlement remains pending", () => {
    expect(lowerSql).toContain("applied_amount_cents = case when v_to_status='succeeded'");
    expect(lowerSql).toContain("then 'pending'");
    expect(lowerSql).not.toContain("settled_amount_cents =");
    expect(lowerSql).not.toContain("paid_out_amount_cents =");
    expect(lowerSql).not.toContain("refunded_amount_cents =");
  });

  it("records delayed terminal-state events without regressing payment state", () => {
    expect(lowerSql).toContain("'provider_event_ignored'");
    expect(lowerSql).toContain("'non_monotonic_or_duplicate_state'");
    expect(lowerSql).toContain("v_attempt.payment_status in ('succeeded','partially_refunded','refunded','disputed','cancelled','failed')");
  });

  it("grants execution only to service_role", () => {
    expect(lowerSql).toContain("grant execute on function public.process_stripe_reservation_payment_event");
    expect(lowerSql).not.toMatch(/grant execute[\s\S]*to (anon|authenticated)/);
    expect(lowerSql).not.toMatch(/grant (insert|update|delete) on/);
  });

  // Needs a live docker postgres (SUPABASE_DB_CONTAINER); skipped where docker is unavailable.
  it.skipIf(!dockerAvailable)("applies twice without row drift and preserves its security contract", () => {
    const counts = () => psql(`select json_build_array(
      (select count(*) from reservations),
      (select count(*) from reservation_financial_contracts),
      (select count(*) from reservation_payment_attempts),
      (select count(*) from reservation_payment_events)
    )::text;`).trim();
    const before = counts();
    psql(`${migrationSql}\n${migrationSql}`);
    expect(counts()).toBe(before);
    const contract = psql(`
      select p.prosecdef, array_to_string(p.proconfig, ','),
        has_function_privilege('service_role',p.oid,'execute'),
        has_function_privilege('anon',p.oid,'execute'),
        has_function_privilege('authenticated',p.oid,'execute')
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='process_stripe_reservation_payment_event';
    `).trim();
    expect(contract).toBe("t|search_path=public,row_security=off|t|f|f");
  });
});
