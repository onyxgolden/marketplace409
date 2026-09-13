import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const LOCAL_URL = "http://127.0.0.1:54321";
const DB_CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_marketplace409-reservation-validation";
const migrationPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../20260913000000_fix_tenant_autopay_rpc_rls.sql");
const migrationSql = fs.readFileSync(migrationPath, "utf8");

function psql(sql) {
  return execFileSync("docker", ["exec", "-i", DB_CONTAINER, "psql", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], {
    input: sql, encoding: "utf8",
  });
}

function asAuthenticated(userId, sql, { commit = false } = {}) {
  return psql(`begin;
    set local role authenticated;
    select set_config('request.jwt.claim.sub', '${userId}', true);
    select set_config('request.jwt.claim.role', 'authenticated', true);
    ${sql}
    ${commit ? "commit" : "rollback"};`);
}

async function reachable() {
  try {
    return (await fetch(`${LOCAL_URL}/auth/v1/health`, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}

const localStackReachable = await reachable();

describe.skipIf(!localStackReachable)("tenant autopay RPC RLS correction (real local Supabase)", () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const ownerId = crypto.randomUUID();
  const tenantUserId = crypto.randomUUID();
  const strangerUserId = crypto.randomUUID();
  const unitId = `autopay_unit_${suffix}`;
  const leaseId = `autopay_lease_${suffix}`;
  const tenantId = `autopay_tenant_${suffix}`;
  let enrollmentId;

  beforeAll(() => {
    psql(`${migrationSql}\n${migrationSql}`);
    psql(`
      insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      values
        ('00000000-0000-0000-0000-000000000000','${tenantUserId}','authenticated','authenticated','autopay-tenant-${suffix}@example.test','',now(),'{}','{}',now(),now()),
        ('00000000-0000-0000-0000-000000000000','${strangerUserId}','authenticated','authenticated','autopay-stranger-${suffix}@example.test','',now(),'{}','{}',now(),now());
      insert into rental_units(owner_id,id,property_id,label,status)
      values ('${ownerId}','${unitId}','autopay_property_${suffix}','Autopay fixture','occupied');
      insert into rental_tenants(owner_id,id,auth_user_id,display_name,email,status,activated_at)
      values ('${ownerId}','${tenantId}','${tenantUserId}','Autopay Tenant','autopay-tenant-${suffix}@example.test','active',now());
      insert into rental_leases(owner_id,id,property_id,unit_id,status,start_date,monthly_rent_cents,currency_code,rent_due_day,activated_at)
      values ('${ownerId}','${leaseId}','autopay_property_${suffix}','${unitId}','active',current_date-30,100000,'USD',1,now());
      insert into rental_lease_tenants(owner_id,lease_id,tenant_id)
      values ('${ownerId}','${leaseId}','${tenantId}');
      insert into rent_schedules(owner_id,id,lease_id,status,amount_cents,currency_code,due_day,effective_start_date,collection_mode,collection_provider,forge_cutover_date)
      values ('${ownerId}','autopay_schedule_${suffix}','${leaseId}','active',100000,'USD',1,current_date-30,'forge',null,current_date-1);
      insert into rental_billing_settings(owner_id,billing_enabled,updated_by)
      values ('${ownerId}',true,'${ownerId}');
    `);
  }, 30000);

  afterAll(() => {
    if (!localStackReachable) return;
    psql(`
      delete from rental_autopay_enrollments where owner_id='${ownerId}';
      delete from rental_billing_settings where owner_id='${ownerId}';
      delete from rent_schedules where owner_id='${ownerId}';
      delete from rental_lease_tenants where owner_id='${ownerId}';
      delete from rental_leases where owner_id='${ownerId}';
      delete from rental_tenants where owner_id='${ownerId}';
      delete from rental_units where owner_id='${ownerId}';
      delete from auth.users where id in ('${tenantUserId}','${strangerUserId}');
    `);
  }, 30000);

  it("is idempotent and keeps both RPCs SECURITY DEFINER with row security disabled", () => {
    const output = psql(`select pg_proc.oid::regprocedure::text, prosecdef, coalesce(array_to_string(proconfig,','),'')
      from pg_proc join pg_namespace on pg_namespace.oid=pg_proc.pronamespace
      where nspname='public' and pg_proc.oid in (
        'request_rental_autopay_enrollment(text,text,smallint,smallint,text,text)'::regprocedure,
        'cancel_rental_autopay_enrollment(text,text)'::regprocedure
      ) order by pg_proc.oid::regprocedure::text;
      select has_function_privilege('authenticated',
        'request_rental_autopay_enrollment(text,text,smallint,smallint,text)', 'execute');`);
    expect(output).toContain("cancel_rental_autopay_enrollment(text,text)|t|");
    expect(output).toContain("request_rental_autopay_enrollment(text,text,smallint,smallint,text,text)|t|");
    expect(output.match(/row_security=off/g)).toHaveLength(2);
    expect(output.trim().split("\n").at(-1)).toBe("f");
  });

  it("allows the active tenant to request setup without granting direct table-write access", () => {
    const consent = "I knowingly authorize recurring rent payments and may cancel future payments.";
    const output = asAuthenticated(tenantUserId, `select row_to_json(result)::text from request_rental_autopay_enrollment(
      '${leaseId}','us_bank_account',1::smallint,3::smallint,'${consent}','test'
    ) result;`, { commit: true });
    const data = JSON.parse(output.trim().split("\n").find((line) => line.startsWith("{")));
    expect(data).toMatchObject({ owner_id: ownerId, lease_id: leaseId, tenant_id: tenantId, status: "setup_required" });
    enrollmentId = data.id;

    expect(() => asAuthenticated(tenantUserId, `insert into rental_autopay_enrollments(
      owner_id,id,lease_id,tenant_id,payment_method_type,charge_day,consent_text,consented_at
    ) values ('${ownerId}','direct_${suffix}','${leaseId}','${tenantId}','card',1,'${consent}',now());`)).toThrow();
  });

  it("denies an unrelated authenticated user from requesting against the lease", () => {
    expect(() => asAuthenticated(strangerUserId, `select request_rental_autopay_enrollment(
      '${leaseId}','card',1::smallint,3::smallint,'I knowingly authorize recurring rent payments and may cancel future payments.','test'
    );`)).toThrow(/Active tenant lease access is required/);
  });

  it("denies another user from cancelling, then lets the owning tenant cancel", () => {
    expect(() => asAuthenticated(strangerUserId, `select cancel_rental_autopay_enrollment('${enrollmentId}','not mine');`))
      .toThrow(/Current tenant autopay enrollment was not found/);

    const output = asAuthenticated(tenantUserId, `select row_to_json(result)::text
      from cancel_rental_autopay_enrollment('${enrollmentId}','Cancelled by tenant') result;`, { commit: true });
    const data = JSON.parse(output.trim().split("\n").find((line) => line.startsWith("{")));
    expect(data).toMatchObject({ id: enrollmentId, owner_id: ownerId, tenant_id: tenantId, status: "cancelled" });
  });

  it("rejects enrollment after the lease is no longer active", () => {
    psql(`update rental_leases set status='ended', ended_at=now() where owner_id='${ownerId}' and id='${leaseId}';`);
    expect(() => asAuthenticated(tenantUserId, `select request_rental_autopay_enrollment(
      '${leaseId}','card',1::smallint,3::smallint,'I knowingly authorize recurring rent payments and may cancel future payments.','test'
    );`)).toThrow(/Active tenant lease access is required/);
  });
});
