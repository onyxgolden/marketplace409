import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";

const LOCAL_URL = "http://127.0.0.1:54321";
const LOCAL_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJIUzI1NiIsInR5cCI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const LOCAL_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJIUzI1NiIsInR5cCI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const DB_CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_marketplace409-reservation-validation";
const TEST_PASSWORD = "correct-horse-battery-staple-1";
const migrationPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../20260913000000_fix_tenant_autopay_rpc_rls.sql");
const migrationSql = fs.readFileSync(migrationPath, "utf8");

function psql(sql) {
  return execFileSync("docker", ["exec", "-i", DB_CONTAINER, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], {
    input: sql, encoding: "utf8",
  });
}

async function reachable() {
  try {
    return (await fetch(`${LOCAL_URL}/auth/v1/health`, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}

async function signIn(email) {
  const client = createClient(LOCAL_URL, LOCAL_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error) throw error;
  return client;
}

const localStackReachable = await reachable();

describe.skipIf(!localStackReachable)("tenant autopay RPC RLS correction (real local Supabase)", () => {
  const admin = createClient(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const suffix = crypto.randomUUID().slice(0, 8);
  const ownerId = crypto.randomUUID();
  const unitId = `autopay_unit_${suffix}`;
  const leaseId = `autopay_lease_${suffix}`;
  const tenantId = `autopay_tenant_${suffix}`;
  let tenantUser;
  let strangerUser;
  let tenantClient;
  let strangerClient;
  let enrollmentId;

  beforeAll(async () => {
    psql(`${migrationSql}\n${migrationSql}`);
    const created = await Promise.all([
      admin.auth.admin.createUser({ email: `autopay-tenant-${suffix}@example.test`, password: TEST_PASSWORD, email_confirm: true }),
      admin.auth.admin.createUser({ email: `autopay-stranger-${suffix}@example.test`, password: TEST_PASSWORD, email_confirm: true }),
    ]);
    for (const result of created) if (result.error) throw result.error;
    [tenantUser, strangerUser] = created.map(({ data }) => data.user);

    psql(`
      insert into rental_units(owner_id,id,property_id,label,status)
      values ('${ownerId}','${unitId}','autopay_property_${suffix}','Autopay fixture','occupied');
      insert into rental_tenants(owner_id,id,auth_user_id,display_name,email,status,activated_at)
      values ('${ownerId}','${tenantId}','${tenantUser.id}','Autopay Tenant','${tenantUser.email}','active',now());
      insert into rental_leases(owner_id,id,property_id,unit_id,status,start_date,monthly_rent_cents,currency_code,rent_due_day,activated_at)
      values ('${ownerId}','${leaseId}','autopay_property_${suffix}','${unitId}','active',current_date-30,100000,'USD',1,now());
      insert into rental_lease_tenants(owner_id,lease_id,tenant_id)
      values ('${ownerId}','${leaseId}','${tenantId}');
      insert into rent_schedules(owner_id,id,lease_id,status,amount_cents,currency_code,due_day,effective_start_date,collection_mode,collection_provider,forge_cutover_date)
      values ('${ownerId}','autopay_schedule_${suffix}','${leaseId}','active',100000,'USD',1,current_date-30,'forge',null,current_date-1);
      insert into rental_billing_settings(owner_id,billing_enabled,updated_by)
      values ('${ownerId}',true,'${ownerId}');
    `);
    [tenantClient, strangerClient] = await Promise.all([signIn(tenantUser.email), signIn(strangerUser.email)]);
  }, 30000);

  afterAll(async () => {
    if (!localStackReachable) return;
    psql(`
      delete from rental_autopay_enrollments where owner_id='${ownerId}';
      delete from rental_billing_settings where owner_id='${ownerId}';
      delete from rent_schedules where owner_id='${ownerId}';
      delete from rental_lease_tenants where owner_id='${ownerId}';
      delete from rental_leases where owner_id='${ownerId}';
      delete from rental_tenants where owner_id='${ownerId}';
      delete from rental_units where owner_id='${ownerId}';
    `);
    for (const user of [tenantUser, strangerUser]) if (user) await admin.auth.admin.deleteUser(user.id);
  }, 30000);

  it("is idempotent and keeps both RPCs SECURITY DEFINER with row security disabled", () => {
    const output = psql(`select proname, prosecdef, coalesce(array_to_string(proconfig,','),'')
      from pg_proc join pg_namespace on pg_namespace.oid=pg_proc.pronamespace
      where nspname='public' and proname in ('request_rental_autopay_enrollment','cancel_rental_autopay_enrollment') order by proname;`);
    expect(output).toContain("t");
    expect(output.match(/row_security=off/g)).toHaveLength(2);
  });

  it("allows the active tenant to request setup without granting direct table-write access", async () => {
    const consent = "I knowingly authorize recurring rent payments and may cancel future payments.";
    const { data, error } = await tenantClient.rpc("request_rental_autopay_enrollment", {
      p_lease_id: leaseId, p_payment_method_type: "us_bank_account", p_charge_day: 1,
      p_reminder_days_before: 3, p_consent_text: consent,
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ owner_id: ownerId, lease_id: leaseId, tenant_id: tenantId, status: "setup_required" });
    enrollmentId = data.id;

    const direct = await tenantClient.from("rental_autopay_enrollments").insert({
      owner_id: ownerId, id: `direct_${suffix}`, lease_id: leaseId, tenant_id: tenantId,
      payment_method_type: "card", charge_day: 1, consent_text: consent, consented_at: new Date().toISOString(),
    });
    expect(direct.error).not.toBeNull();
  });

  it("denies an unrelated authenticated user from requesting against the lease", async () => {
    const { error } = await strangerClient.rpc("request_rental_autopay_enrollment", {
      p_lease_id: leaseId, p_payment_method_type: "card", p_charge_day: 1,
      p_reminder_days_before: 3, p_consent_text: "I knowingly authorize recurring rent payments and may cancel future payments.",
    });
    expect(error?.code).toBe("42501");
  });

  it("denies another user from cancelling, then lets the owning tenant cancel", async () => {
    const denied = await strangerClient.rpc("cancel_rental_autopay_enrollment", { p_enrollment_id: enrollmentId, p_reason: "not mine" });
    expect(denied.error).not.toBeNull();

    const own = await tenantClient.rpc("cancel_rental_autopay_enrollment", { p_enrollment_id: enrollmentId, p_reason: "Cancelled by tenant" });
    expect(own.error).toBeNull();
    expect(own.data).toMatchObject({ id: enrollmentId, owner_id: ownerId, tenant_id: tenantId, status: "cancelled" });
  });

  it("rejects enrollment after the lease is no longer active", async () => {
    psql(`update rental_leases set status='ended', ended_at=now() where owner_id='${ownerId}' and id='${leaseId}';`);
    const { error } = await tenantClient.rpc("request_rental_autopay_enrollment", {
      p_lease_id: leaseId, p_payment_method_type: "card", p_charge_day: 1,
      p_reminder_days_before: 3, p_consent_text: "I knowingly authorize recurring rent payments and may cancel future payments.",
    });
    expect(error?.code).toBe("42501");
  });
});
