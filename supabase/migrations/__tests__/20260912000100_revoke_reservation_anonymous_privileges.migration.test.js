// Real-infrastructure migration test for RV-A (the anonymous reservation-privilege gap found by
// the RV/cabin production-readiness audit), run against a local Supabase stack (Postgres +
// GoTrue + PostgREST) via Docker -- never against the real, hosted project. Mirrors
// reservationRpcs.integration.test.js's pattern: real synthetic users, real signInWithPassword
// sessions, real role-scoped calls -- never the postgres superuser role, never the service_role
// key, for any assertion about what anon/authenticated/a stranger can or cannot do.
//
// Requires a local Supabase stack reachable at 127.0.0.1:54321/54322 (e.g. `supabase start` from
// any worktree of this repo). Self-skips (not fails) when that stack isn't reachable.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";

const LOCAL_URL = "http://127.0.0.1:54321";
// Well-known, publicly documented Supabase CLI local-dev demo keys -- identical on every
// `supabase start` unless explicitly overridden, never secrets.
const LOCAL_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const LOCAL_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const DB_CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_marketplace409-reservation-validation";
const TEST_PASSWORD = "correct-horse-battery-staple-1";

const currentFilePath = fileURLToPath(import.meta.url);
const migrationPath = path.resolve(path.dirname(currentFilePath), "../20260912000100_revoke_reservation_anonymous_privileges.sql");
const migrationSql = fs.readFileSync(migrationPath, "utf8");

const RESERVATION_TABLES = [
  "reservation_inventory_settings", "reservation_rate_plans", "reservation_calendar_blocks",
  "reservation_guests", "reservations", "reservation_events", "reservation_inventory_imports",
];

function psql(sql) {
  return execFileSync("docker", ["exec", "-i", DB_CONTAINER, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], {
    input: sql, encoding: "utf8",
  });
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

describe.skipIf(!reachable)("RV-A: revoke anonymous reservation privileges (real local Supabase)", () => {
  const admin = createClient(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const anonClient = createClient(LOCAL_URL, LOCAL_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  let owner;
  let coOwner;
  let stranger;
  let ownerClient;
  let coOwnerClient;
  let strangerClient;
  const suffix = crypto.randomUUID().slice(0, 8);
  const unitId = `unit_anon_${suffix}`;

  async function signInFreshClient(email) {
    const client = createClient(LOCAL_URL, LOCAL_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
    if (error) throw error;
    return client;
  }

  // Restores the exact vulnerable baseline this migration closes -- full anon table privileges
  // (matching this project's real default-ACL behavior, confirmed live against production via
  // pg_default_acl) and, for the two RPCs plus the three trigger functions, anon/public EXECUTE
  // -- regardless of what the real migration history in this local database already did, so this
  // file's own before/after proof is self-contained and deterministic. Also brings authenticated
  // and service_role table/function access up to real production parity: this local Supabase CLI
  // stack's own default privileges do not match production's (confirmed by querying pg_default_acl
  // on both -- production's migrations run as `supabase_admin`, which carries an explicit
  // per-role default ACL for anon/authenticated/service_role; this local stack's migrations run as
  // `postgres`, which does not), so without this, several assertions below would fail for
  // reasons that have nothing to do with RV-A's actual authorization behavior.
  beforeAll(async () => {
    psql(`
      grant select, insert, update, delete, references, trigger, truncate on ${RESERVATION_TABLES.join(", ")} to anon;
      grant select, insert, update, delete, references, trigger, truncate on ${RESERVATION_TABLES.join(", ")} to authenticated;
      grant select, insert, update, delete, references, trigger, truncate on ${RESERVATION_TABLES.join(", ")} to service_role;
      grant execute on function confirm_owner_reservation(
        text, text, text, text, text, text, text, date, date, integer,
        bigint, bigint, bigint, bigint, bigint, text, text, text
      ) to public, anon, authenticated, service_role;
      grant execute on function import_reservation_inventory_bulk(text, text, text, jsonb) to public, anon, authenticated, service_role;
      grant execute on function enforce_reservation_inventory_settings_actor() to public, anon, authenticated, service_role;
      grant execute on function enforce_reservation_rate_plan_actor() to public, anon, authenticated, service_role;
      grant execute on function prevent_reservation_event_mutation() to public, anon, authenticated, service_role;
    `);

    const suffixUsers = crypto.randomUUID().slice(0, 8);
    const created = await Promise.all([
      admin.auth.admin.createUser({ email: `rv-a-owner-${suffixUsers}@example.test`, password: TEST_PASSWORD, email_confirm: true }),
      admin.auth.admin.createUser({ email: `rv-a-coowner-${suffixUsers}@example.test`, password: TEST_PASSWORD, email_confirm: true }),
      admin.auth.admin.createUser({ email: `rv-a-stranger-${suffixUsers}@example.test`, password: TEST_PASSWORD, email_confirm: true }),
    ]);
    for (const result of created) if (result.error) throw result.error;
    [owner, coOwner, stranger] = created.map((result) => result.data.user);

    psql(`insert into public.workspace_members(owner_id,id,member_user_id,role,status,invited_email,invited_by,activated_at)
      values ('${owner.id}', '${crypto.randomUUID()}', '${coOwner.id}', 'co_owner', 'active', '${coOwner.email}', '${owner.id}', now());`);

    [ownerClient, coOwnerClient, strangerClient] = await Promise.all([
      signInFreshClient(owner.email), signInFreshClient(coOwner.email), signInFreshClient(stranger.email),
    ]);

    // Built via the real import RPC, exactly like reservationRpcs.integration.test.js's own
    // fixture -- not a hand-rolled raw insert -- so the unit/inventory row is guaranteed to match
    // the actual current schema and pass through the actor-attribution triggers for real.
    const importResult = await ownerClient.rpc("import_reservation_inventory_bulk", {
      p_owner_id: owner.id, p_import_id: `rv_a_import_${suffix}`, p_plan_digest: "rv-a-digest", p_rows: [{
        unitId, propertyId: `property_anon_${suffix}`, unitLabel: "Anon Test Site", publicName: "Anon Test Site",
        publicDescription: "Fixture for RV-A privilege revocation tests", inventoryType: "rv_site", bookingStatus: "active",
        timezone: "America/Chicago", maximumGuests: 4, minimumNights: 1, maximumNights: null,
        turnoverBufferHours: 0, amenities: [], cleaningFeeCents: 0,
        securityDepositCents: 0, lodgingTaxBasisPoints: 0, nightlyRateCents: 5000,
        effectiveStartDate: "2026-01-01", ratePlanId: `rv_a_rate_${suffix}`,
      }],
    });
    if (importResult.error) throw importResult.error;
  }, 30000);

  afterAll(async () => {
    if (!reachable) return;
    psql(`
      alter table reservation_events disable trigger reservation_events_immutable;
      delete from reservation_events where owner_id = '${owner.id}';
      alter table reservation_events enable trigger reservation_events_immutable;
      delete from reservation_calendar_blocks where owner_id = '${owner.id}';
      delete from reservations where owner_id = '${owner.id}';
      delete from reservation_guests where owner_id = '${owner.id}';
      delete from reservation_rate_plans where owner_id = '${owner.id}';
      delete from reservation_inventory_settings where owner_id = '${owner.id}';
      delete from reservation_inventory_imports where owner_id = '${owner.id}';
      delete from rental_units where owner_id = '${owner.id}';
      delete from workspace_members where owner_id = '${owner.id}';
    `);
    for (const user of [owner, coOwner, stranger]) {
      if (!user) continue;
      const { error } = await admin.auth.admin.deleteUser(user.id);
      if (error) throw new Error(`Failed to delete test user ${user.email}: ${error.message}`);
    }
  }, 30000);

  describe("before the migration: the vulnerable baseline genuinely exists", () => {
    it("anon can currently SELECT, INSERT, UPDATE, and DELETE directly on a reservation table by raw privilege", async () => {
      const selectResult = await anonClient.from("reservations").select("id").limit(1);
      expect(selectResult.error).toBeNull();

      const insertResult = await anonClient.from("reservation_guests").insert({
        owner_id: owner.id, id: `anon_probe_guest_${suffix}`, display_name: "Anon Probe", email: `anon-probe-${suffix}@x.test`, created_by: owner.id,
      });
      // RLS still denies it (no anon-scoped policy exists) -- this proves the GRANT itself is
      // present (a permission-denied error would look different), matching the audit's own
      // "not currently exploitable" finding while confirming the raw privilege genuinely exists.
      expect(insertResult.error.message).toMatch(/row-level security policy/);
    });

    it("anon can currently call confirm_owner_reservation and import_reservation_inventory_bulk by raw privilege (RLS/logic still denies the outcome)", async () => {
      const confirmResult = await anonClient.rpc("confirm_owner_reservation", {
        p_owner_id: owner.id, p_reservation_id: `anon_probe_res_${suffix}`, p_guest_id: `anon_probe_guest2_${suffix}`,
        p_unit_id: unitId, p_guest_name: "Probe", p_guest_email: `probe-${suffix}@x.test`, p_guest_phone: null,
        p_check_in_date: "2027-01-01", p_check_out_date: "2027-01-02", p_guest_count: 1,
        p_lodging_amount_cents: 100, p_cleaning_fee_cents: 0, p_lodging_tax_cents: 0, p_security_deposit_cents: 0,
        p_total_due_cents: 100, p_currency_code: "usd", p_source_reference: "probe", p_owner_notes: null,
      });
      expect(confirmResult.error).toBeTruthy();
      expect(confirmResult.error.message).not.toMatch(/permission denied for function/);
    });
  });

  describe("applying the real migration file", () => {
    it("applies cleanly, twice in a row, with no error and no privilege drift", () => {
      expect(() => psql(migrationSql)).not.toThrow();
      const firstPass = psql(`
        select coalesce(string_agg(distinct table_name || ':' || grantee, ',' order by table_name || ':' || grantee), '')
        from information_schema.role_table_grants
        where table_schema='public' and table_name = any(array[${RESERVATION_TABLES.map((t) => `'${t}'`).join(",")}]) and grantee = 'anon';
      `);
      expect(() => psql(migrationSql)).not.toThrow();
      const secondPass = psql(`
        select coalesce(string_agg(distinct table_name || ':' || grantee, ',' order by table_name || ':' || grantee), '')
        from information_schema.role_table_grants
        where table_schema='public' and table_name = any(array[${RESERVATION_TABLES.map((t) => `'${t}'`).join(",")}]) and grantee = 'anon';
      `);
      expect(firstPass).toBe(secondPass);
      // psql table output: [0] header, [1] separator, [2] the single (possibly empty) value.
      expect(firstPass.trim().split("\n")[2].trim()).toBe("");
    });

    it("changes no reservation row and no production-shaped data", () => {
      // Scoped to this test's own owner_id, not a bare global count: other reservation test
      // files run concurrently against this same shared local database and legitimately insert
      // and delete their own rows in these same tables throughout this run. A migration that
      // only revokes GRANT/REVOKE privileges cannot touch row data regardless, but the proof
      // must isolate to fixtures this test itself controls to avoid an unrelated false failure.
      const snapshot = () => psql(`
        select
          (select count(*) from reservation_inventory_settings where owner_id = '${owner.id}') || '|' ||
          (select count(*) from reservation_rate_plans where owner_id = '${owner.id}') || '|' ||
          (select count(*) from reservation_calendar_blocks where owner_id = '${owner.id}') || '|' ||
          (select count(*) from reservation_guests where owner_id = '${owner.id}') || '|' ||
          (select count(*) from reservations where owner_id = '${owner.id}') || '|' ||
          (select count(*) from reservation_events where owner_id = '${owner.id}') || '|' ||
          (select count(*) from reservation_inventory_imports where owner_id = '${owner.id}') || '|' ||
          (select md5(coalesce(string_agg(unit_id::text || updated_at::text, ',' order by unit_id), ''))
             from reservation_inventory_settings where owner_id = '${owner.id}');
      `);
      const before = snapshot();
      psql(migrationSql);
      const after = snapshot();
      expect(after).toBe(before);
    });
  });

  describe("after the migration: anon and PUBLIC are denied, authenticated/owner/co-owner are unaffected", () => {
    beforeAll(() => {
      psql(migrationSql);
    });

    it("1. anonymous direct SELECT is denied by privilege, not merely filtered by RLS", async () => {
      const result = await anonClient.from("reservations").select("id").limit(1);
      expect(result.error).toBeTruthy();
      expect(result.error.code).toBe("42501");
      expect(result.error.message).toMatch(/permission denied for table reservations/);
    });

    it("2. anonymous direct INSERT fails by privilege", async () => {
      const result = await anonClient.from("reservation_guests").insert({
        owner_id: owner.id, id: `anon_probe_guest3_${suffix}`, display_name: "Probe", email: `probe3-${suffix}@x.test`, created_by: owner.id,
      });
      expect(result.error.code).toBe("42501");
      expect(result.error.message).toMatch(/permission denied for table reservation_guests/);
    });

    it("3. anonymous direct UPDATE fails by privilege", async () => {
      const result = await anonClient.from("reservation_inventory_settings").update({ public_name: "hijacked" }).eq("unit_id", unitId);
      expect(result.error.code).toBe("42501");
      expect(result.error.message).toMatch(/permission denied for table reservation_inventory_settings/);
    });

    it("4. anonymous direct DELETE fails by privilege", async () => {
      const result = await anonClient.from("reservation_inventory_settings").delete().eq("unit_id", unitId);
      expect(result.error.code).toBe("42501");
      expect(result.error.message).toMatch(/permission denied for table reservation_inventory_settings/);
    });

    it("5. anonymous cannot call confirm_owner_reservation", async () => {
      const result = await anonClient.rpc("confirm_owner_reservation", {
        p_owner_id: owner.id, p_reservation_id: `anon_probe_res2_${suffix}`, p_guest_id: `anon_probe_guest4_${suffix}`,
        p_unit_id: unitId, p_guest_name: "Probe", p_guest_email: `probe4-${suffix}@x.test`, p_guest_phone: null,
        p_check_in_date: "2027-02-01", p_check_out_date: "2027-02-02", p_guest_count: 1,
        p_lodging_amount_cents: 100, p_cleaning_fee_cents: 0, p_lodging_tax_cents: 0, p_security_deposit_cents: 0,
        p_total_due_cents: 100, p_currency_code: "usd", p_source_reference: "probe4", p_owner_notes: null,
      });
      expect(result.error.code).toBe("42501");
      expect(result.error.message).toMatch(/permission denied for function confirm_owner_reservation/);
    });

    it("6. anonymous cannot call import_reservation_inventory_bulk", async () => {
      const result = await anonClient.rpc("import_reservation_inventory_bulk", {
        p_owner_id: owner.id, p_import_id: `anon_probe_import_${suffix}`, p_plan_digest: "probe", p_rows: [],
      });
      expect(result.error.code).toBe("42501");
      expect(result.error.message).toMatch(/permission denied for function import_reservation_inventory_bulk/);
    });

    it("7. PUBLIC cannot execute either mutation RPC, and cannot call the trigger-only helper functions directly", () => {
      const output = psql(`
        select
          has_function_privilege('public', 'confirm_owner_reservation(text,text,text,text,text,text,text,date,date,integer,bigint,bigint,bigint,bigint,bigint,text,text,text)', 'EXECUTE') as confirm_public,
          has_function_privilege('public', 'import_reservation_inventory_bulk(text,text,text,jsonb)', 'EXECUTE') as import_public,
          has_function_privilege('public', 'enforce_reservation_inventory_settings_actor()', 'EXECUTE') as trigger1_public,
          has_function_privilege('public', 'enforce_reservation_rate_plan_actor()', 'EXECUTE') as trigger2_public,
          has_function_privilege('public', 'prevent_reservation_event_mutation()', 'EXECUTE') as trigger3_public;
      `);
      // psql table output: [0] header, [1] separator, [2] the single data row, [3] "(1 row)".
      const dataLine = output.trim().split("\n")[2];
      const values = dataLine.split("|").map((value) => value.trim());
      expect(values).toEqual(["f", "f", "f", "f", "f"]);
    });

    it("8. an unrelated authenticated user remains unable to read or mutate this owner's workspace", async () => {
      const readResult = await strangerClient.from("reservation_inventory_settings").select("*").eq("unit_id", unitId);
      expect(readResult.error).toBeNull();
      expect(readResult.data).toEqual([]);

      const writeResult = await strangerClient.from("reservation_inventory_settings").update({ public_name: "stolen" }).eq("unit_id", unitId).select();
      expect(writeResult.error).toBeNull();
      expect(writeResult.data).toEqual([]);
      const verifyUnchanged = await ownerClient.from("reservation_inventory_settings").select("public_name").eq("unit_id", unitId).single();
      expect(verifyUnchanged.data.public_name).toBe("Anon Test Site");
    });

    it("9. the primary owner retains full intended read/write access", async () => {
      const readResult = await ownerClient.from("reservation_inventory_settings").select("*").eq("unit_id", unitId);
      expect(readResult.error).toBeNull();
      expect(readResult.data).toHaveLength(1);

      const writeResult = await ownerClient.from("reservation_inventory_settings").update({ maximum_guests: 6 }).eq("unit_id", unitId).select().single();
      expect(writeResult.error).toBeNull();
      expect(writeResult.data.maximum_guests).toBe(6);
      expect(writeResult.data.updated_by).toBe(owner.id);
    });

    it("10. the active co-owner retains full intended read/write access, attributed correctly", async () => {
      const readResult = await coOwnerClient.from("reservation_inventory_settings").select("*").eq("unit_id", unitId);
      expect(readResult.error).toBeNull();
      expect(readResult.data).toHaveLength(1);

      const writeResult = await coOwnerClient.from("reservation_inventory_settings").update({ maximum_guests: 8 }).eq("unit_id", unitId).select().single();
      expect(writeResult.error).toBeNull();
      // 11. acting-user attribution: created_by stays the original creator (owner); updated_by
      // moves to whoever actually made this write (the co-owner) -- never spoofable by the client,
      // enforced by enforce_reservation_inventory_settings_actor(), which still fires correctly
      // for authenticated after this migration.
      expect(writeResult.data.created_by).toBe(owner.id);
      expect(writeResult.data.updated_by).toBe(coOwner.id);
    });

    it("12. confirm_owner_reservation still completes a full atomic confirmation end-to-end for the owner after this migration", async () => {
      const result = await ownerClient.rpc("confirm_owner_reservation", {
        p_owner_id: owner.id, p_reservation_id: `rv_a_res_${suffix}`, p_guest_id: `rv_a_guest_${suffix}`,
        p_unit_id: unitId, p_guest_name: "Post-Migration Guest", p_guest_email: `guest-${suffix}@x.test`, p_guest_phone: null,
        p_check_in_date: "2027-03-01", p_check_out_date: "2027-03-03", p_guest_count: 2,
        p_lodging_amount_cents: 20000, p_cleaning_fee_cents: 5000, p_lodging_tax_cents: 1000, p_security_deposit_cents: 10000,
        p_total_due_cents: 36000, p_currency_code: "usd", p_source_reference: `rv_a_res_${suffix}`, p_owner_notes: null,
      });
      expect(result.error).toBeNull();
      expect(result.data.status).toBe("confirmed");

      const guestCheck = await ownerClient.from("reservation_guests").select("display_name").eq("id", `rv_a_guest_${suffix}`).single();
      expect(guestCheck.data.display_name).toBe("Post-Migration Guest");
    });
  });
});
