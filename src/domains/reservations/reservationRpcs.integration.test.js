// Real-infrastructure integration test for RV/cabin reservation multi-user support, run against
// a local Supabase stack (Postgres + GoTrue + PostgREST) via Docker -- never against the real,
// hosted project. Mirrors src/domains/health/__tests__/healthRpcs.integration.test.js's pattern:
// real synthetic users, real signInWithPassword sessions, real authenticated-role RLS/RPC calls
// -- never the postgres superuser role, never the service_role key, for any assertion about
// what an owner/co-owner/stranger can or cannot do.
//
// Requires a local Supabase stack reachable at 127.0.0.1:54321/54322 (e.g. `supabase start` from
// any worktree of this repo). Self-skips (not fails) when that stack isn't reachable.
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";

const LOCAL_URL = "http://127.0.0.1:54321";
// Well-known, publicly documented Supabase CLI local-dev demo keys -- identical on every
// `supabase start` unless explicitly overridden, never secrets.
const LOCAL_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const LOCAL_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const DB_CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_marketplace409-reservation-validation";
const TEST_PASSWORD = "correct-horse-battery-staple-1";

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

describe.skipIf(!reachable)("RV/cabin reservation multi-user RLS and RPCs (real local Supabase)", () => {
  const admin = createClient(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  let owner;
  let coOwner;
  let stranger;
  let ownerClient;
  let coOwnerClient;
  let strangerClient;
  const suffix = crypto.randomUUID().slice(0, 8);
  const unitId = `unit_${suffix}`;

  async function signInFreshClient(email) {
    const client = createClient(LOCAL_URL, LOCAL_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
    if (error) throw error;
    return client;
  }

  beforeAll(async () => {
    // This local Supabase CLI stack's default privileges do not match the real, hosted
    // project's (confirmed by querying pg_default_acl on both: production grants
    // authenticated=arwdDxtm by default on every new table; this local stack grants only
    // Dxtm). Without this, every table lacking its own explicit `grant` -- e.g. rental_units --
    // would falsely fail every query here with "permission denied for table," a local-
    // environment artifact having nothing to do with real RLS behavior. This brings local grants
    // up to parity with what production ACTUALLY has right now (confirmed via
    // `supabase db query --linked` against pg_class/information_schema.role_table_grants),
    // so every pass/fail below reflects real RLS behavior, not local drift.
    psql(`
      grant select, insert, update, delete on rental_units to authenticated;
      grant insert, update, delete on reservation_guests to authenticated;
      grant insert, update, delete on reservations to authenticated;
      grant insert, update, delete on reservation_events to authenticated;
      grant insert, update, delete on reservation_inventory_imports to authenticated;
    `);

    const suffixUsers = crypto.randomUUID().slice(0, 8);
    const created = await Promise.all([
      admin.auth.admin.createUser({ email: `reservation-owner-${suffixUsers}@example.test`, password: TEST_PASSWORD, email_confirm: true }),
      admin.auth.admin.createUser({ email: `reservation-coowner-${suffixUsers}@example.test`, password: TEST_PASSWORD, email_confirm: true }),
      admin.auth.admin.createUser({ email: `reservation-stranger-${suffixUsers}@example.test`, password: TEST_PASSWORD, email_confirm: true }),
    ]);
    for (const result of created) if (result.error) throw result.error;
    [owner, coOwner, stranger] = created.map((result) => result.data.user);

    psql(`insert into public.workspace_members(owner_id,id,member_user_id,role,status,invited_email,invited_by,activated_at)
      values ('${owner.id}', '${crypto.randomUUID()}', '${coOwner.id}', 'co_owner', 'active', '${coOwner.email}', '${owner.id}', now());`);

    [ownerClient, coOwnerClient, strangerClient] = await Promise.all([
      signInFreshClient(owner.email), signInFreshClient(coOwner.email), signInFreshClient(stranger.email),
    ]);
  }, 30000);

  afterAll(async () => {
    if (!reachable) return;
    psql(`
      -- reservation_events rows are permanently immutable by design (see
      -- prevent_reservation_event_mutation) -- there is no user-facing way to delete them, ever,
      -- even for a superuser. Disabling the trigger for this one cleanup statement is a
      -- local-test-only capability no real session has; it is re-enabled immediately after.
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

  // --- Defense in depth: RLS alone (no matching policy) already blocks direct mutation --------
  describe("direct mutation on RPC-only tables is denied even before/without the grant hardening", () => {
    it("rejects a direct INSERT into reservation_guests for a self-owned (has_workspace_access-passing) row, purely because no INSERT policy exists", async () => {
      // owner.id is used as BOTH the acting user and the owner_id -- has_workspace_access(owner_id)
      // is unambiguously true here, isolating the test to "does the missing policy alone block
      // this," independent of workspace membership.
      const result = await ownerClient.from("reservation_guests").insert({
        owner_id: owner.id, id: `probe_guest_${suffix}`, display_name: "Probe", email: `probe-${suffix}@x.test`, created_by: owner.id,
      });
      expect(result.error).toBeTruthy();
      expect(result.error.message).toMatch(/row-level security policy/);
    });

    it("rejects a direct INSERT into reservations and reservation_events the same way", async () => {
      const reservationAttempt = await ownerClient.from("reservations").insert({
        owner_id: owner.id, id: `probe_res_${suffix}`, unit_id: unitId, guest_id: "nonexistent",
        status: "held", check_in_date: "2026-10-01", check_out_date: "2026-10-02", guest_count: 1,
        lodging_amount_cents: 100, total_due_cents: 100, created_by: owner.id,
      });
      expect(reservationAttempt.error.message).toMatch(/row-level security policy/);

      const eventAttempt = await ownerClient.from("reservation_events").insert({
        owner_id: owner.id, id: `probe_event_${suffix}`, reservation_id: "nonexistent",
        event_type: "note_added", acting_user_id: owner.id,
      });
      expect(eventAttempt.error.message).toMatch(/row-level security policy/);
    });
  });

  // --- Apply the grant-hardening migration, then confirm the grants themselves are gone --------
  describe("hardening migration: revokes the leftover insert/update/delete grants directly", () => {
    it("applies cleanly and removes insert/update/delete from authenticated on all four tables", () => {
      psql(`
        revoke insert, update, delete on reservation_guests from authenticated;
        revoke insert, update, delete on reservations from authenticated;
        revoke insert, update, delete on reservation_events from authenticated;
        revoke insert, update, delete on reservation_inventory_imports from authenticated;
      `);
      const output = psql(`
        select table_name || '=' || string_agg(privilege_type, ',' order by privilege_type)
        from information_schema.role_table_grants
        where grantee = 'authenticated'
          and table_name in ('reservation_guests','reservations','reservation_events','reservation_inventory_imports')
        group by table_name order by table_name;
      `);
      expect(output).toContain("reservation_events=REFERENCES,SELECT,TRIGGER,TRUNCATE");
      expect(output).toContain("reservation_guests=REFERENCES,SELECT,TRIGGER,TRUNCATE");
      expect(output).toContain("reservation_inventory_imports=REFERENCES,SELECT,TRIGGER,TRUNCATE");
      expect(output).toContain("reservations=REFERENCES,SELECT,TRIGGER,TRUNCATE");
      expect(output).not.toMatch(/INSERT|UPDATE|DELETE/);
    });

    it("now rejects the same direct INSERT with a plain grant-denied error, not an RLS-policy error", async () => {
      const result = await ownerClient.from("reservation_guests").insert({
        owner_id: owner.id, id: `probe_guest2_${suffix}`, display_name: "Probe", email: `probe2-${suffix}@x.test`, created_by: owner.id,
      });
      expect(result.error.message).toBe(`permission denied for table reservation_guests`);
    });
  });

  // --- Bulk inventory import: properties, RV spots/cabins, rates all created atomically --------
  describe("bulk inventory import (properties, RV spots/cabins, rates)", () => {
    const importRows = [{
      unitId, propertyId: `property_${suffix}`, unitLabel: "Site 12", publicName: "Riverside RV Site 12",
      publicDescription: "Full hookup, pull-through", inventoryType: "rv_site", bookingStatus: "active",
      timezone: "America/Chicago", maximumGuests: 6, minimumNights: 1, maximumNights: null,
      turnoverBufferHours: 4, amenities: ["50-amp", "water"], cleaningFeeCents: 2500,
      securityDepositCents: 0, lodgingTaxBasisPoints: 600, nightlyRateCents: 6500,
      effectiveStartDate: "2026-01-01", ratePlanId: `rate_${suffix}_base`,
    }];

    it("owner runs the import: creates the unit, inventory settings, and rate plan, attributed to the owner", async () => {
      const result = await ownerClient.rpc("import_reservation_inventory_bulk", {
        p_owner_id: owner.id, p_import_id: `import_${suffix}`, p_plan_digest: "digest-v1", p_rows: importRows,
      });
      expect(result.error).toBeNull();
      expect(result.data).toMatchObject({ createdUnits: 1, createdInventory: 1, createdRatePlans: 1 });

      const settings = await ownerClient.from("reservation_inventory_settings").select("created_by,updated_by,inventory_type,booking_status").eq("owner_id", owner.id).eq("unit_id", unitId).single();
      expect(settings.data).toMatchObject({ created_by: owner.id, updated_by: owner.id, inventory_type: "rv_site", booking_status: "active" });

      const rate = await ownerClient.from("reservation_rate_plans").select("created_by,amount_cents").eq("owner_id", owner.id).eq("id", `rate_${suffix}_base`).single();
      expect(rate.data).toMatchObject({ created_by: owner.id, amount_cents: 6500 });
    });

    it("is idempotent for the same import id and plan digest, and rejects re-running with a changed plan", async () => {
      const retry = await ownerClient.rpc("import_reservation_inventory_bulk", {
        p_owner_id: owner.id, p_import_id: `import_${suffix}`, p_plan_digest: "digest-v1", p_rows: importRows,
      });
      expect(retry.error).toBeNull();
      expect(retry.data).toMatchObject({ createdUnits: 1 });

      const changed = await ownerClient.rpc("import_reservation_inventory_bulk", {
        p_owner_id: owner.id, p_import_id: `import_${suffix}`, p_plan_digest: "digest-v2-different", p_rows: importRows,
      });
      expect(changed.error).toBeTruthy();
      expect(changed.error.message).toContain("already used with a different plan");
    });

    it("denies an unrelated authenticated user the same import for this owner's workspace", async () => {
      const result = await strangerClient.rpc("import_reservation_inventory_bulk", {
        p_owner_id: owner.id, p_import_id: `import_stranger_${suffix}`, p_plan_digest: "digest-x",
        p_rows: [{ ...importRows[0], unitId: `unit_stranger_${suffix}`, propertyId: `property_stranger_${suffix}`, ratePlanId: `rate_stranger_${suffix}` }],
      });
      expect(result.error).toBeTruthy();
      expect(result.error.message).toContain("Workspace access is required");
    });
  });

  // --- Owner + co-owner full read/write access; stranger has none ------------------------------
  describe("primary owner and co-owner: full read/write access via has_workspace_access", () => {
    it("both owner and co-owner can read the RV spot, rate plan, and Rental Manager unit (property)", async () => {
      for (const client of [ownerClient, coOwnerClient]) {
        const unit = await client.from("rental_units").select("id,property_id,label").eq("owner_id", owner.id).eq("id", unitId).maybeSingle();
        expect(unit.error).toBeNull();
        expect(unit.data).toMatchObject({ id: unitId });

        const settings = await client.from("reservation_inventory_settings").select("unit_id").eq("owner_id", owner.id).eq("unit_id", unitId).maybeSingle();
        expect(settings.data).toMatchObject({ unit_id: unitId });

        const rates = await client.from("reservation_rate_plans").select("id").eq("owner_id", owner.id).eq("unit_id", unitId);
        expect(rates.data.length).toBeGreaterThan(0);
      }
    });

    it("an unrelated authenticated user sees none of it -- RLS filters to an empty result, not an error", async () => {
      const unit = await strangerClient.from("rental_units").select("id").eq("owner_id", owner.id).eq("id", unitId);
      expect(unit.error).toBeNull();
      expect(unit.data).toEqual([]);

      const settings = await strangerClient.from("reservation_inventory_settings").select("unit_id").eq("owner_id", owner.id).eq("unit_id", unitId);
      expect(settings.data).toEqual([]);

      const rates = await strangerClient.from("reservation_rate_plans").select("id").eq("owner_id", owner.id).eq("unit_id", unitId);
      expect(rates.data).toEqual([]);
    });

    it("the co-owner can create a new seasonal rate plan directly, and the database -- not the client -- attributes it to the co-owner", async () => {
      // Deliberately attempts to spoof created_by as the OWNER while acting as the co-owner --
      // the enforce_reservation_rate_plan_actor trigger must override this to the co-owner's own
      // auth.uid(), never trust the client-supplied value.
      const result = await coOwnerClient.from("reservation_rate_plans").insert({
        owner_id: owner.id, id: `rate_${suffix}_peak_season`, unit_id: unitId, label: "Peak season nightly rate",
        cadence: "nightly", amount_cents: 9500, currency_code: "USD",
        effective_start_date: "2026-05-01", effective_end_date: "2026-09-30",
        created_by: owner.id, // spoof attempt
      }).select("created_by").single();

      expect(result.error).toBeNull();
      expect(result.data.created_by).toBe(coOwner.id);
      expect(result.data.created_by).not.toBe(owner.id);
    });

    it("the co-owner can update the RV spot's booking status, and updated_by is forced to the co-owner even if the client tries to spoof it", async () => {
      const result = await coOwnerClient.from("reservation_inventory_settings").update({
        booking_status: "paused", updated_by: owner.id, // spoof attempt
      }).eq("owner_id", owner.id).eq("unit_id", unitId).select("booking_status,created_by,updated_by").single();

      expect(result.error).toBeNull();
      expect(result.data.booking_status).toBe("paused");
      expect(result.data.created_by).toBe(owner.id); // original creator preserved, immutable
      expect(result.data.updated_by).toBe(coOwner.id); // forced to the real actor, not the spoofed owner
    });

    it("an unrelated authenticated user cannot write to either table for this owner's workspace", async () => {
      const rateAttempt = await strangerClient.from("reservation_rate_plans").insert({
        owner_id: owner.id, id: `rate_${suffix}_stranger`, unit_id: unitId, label: "Stranger rate",
        cadence: "nightly", amount_cents: 100, currency_code: "USD", effective_start_date: "2026-01-01",
        created_by: stranger.id,
      });
      expect(rateAttempt.error).toBeTruthy();
      expect(rateAttempt.error.message).toMatch(/row-level security policy/);

      const settingsAttempt = await strangerClient.from("reservation_inventory_settings").update({ booking_status: "inactive" }).eq("owner_id", owner.id).eq("unit_id", unitId);
      expect(settingsAttempt.error).toBeNull(); // RLS silently matches 0 rows for an unauthorized update, no error
      const stillPaused = await ownerClient.from("reservation_inventory_settings").select("booking_status").eq("owner_id", owner.id).eq("unit_id", unitId).single();
      expect(stillPaused.data.booking_status).toBe("paused"); // unchanged -- the stranger's update touched nothing

      // Re-activate for the reservation tests below.
      await ownerClient.from("reservation_inventory_settings").update({ booking_status: "active" }).eq("owner_id", owner.id).eq("unit_id", unitId);
    });
  });

  // --- Reservations: availability, atomic confirmation, real acting-user attribution -----------
  describe("confirm_owner_reservation: availability, atomic writes, and per-actor audit attribution", () => {
    it("the owner confirms a reservation; guest, reservation, event, and calendar block are all created atomically and attributed to the owner", async () => {
      const result = await ownerClient.rpc("confirm_owner_reservation", {
        p_owner_id: owner.id, p_reservation_id: `res_${suffix}_1`, p_guest_id: `guest_${suffix}_1`, p_unit_id: unitId,
        p_guest_name: "Alex Guest", p_guest_email: `alex-${suffix}@example.test`, p_guest_phone: null,
        p_check_in_date: "2026-11-01", p_check_out_date: "2026-11-05", p_guest_count: 2,
        p_lodging_amount_cents: 26000, p_cleaning_fee_cents: 2500, p_lodging_tax_cents: 1560,
        p_security_deposit_cents: 0, p_total_due_cents: 30060, p_currency_code: "usd",
        p_source_reference: `test_${suffix}_1`, p_owner_notes: "Test reservation 1",
      });
      expect(result.error).toBeNull();
      expect(result.data).toMatchObject({ status: "confirmed", created_by: owner.id });

      const guest = await ownerClient.from("reservation_guests").select("created_by,display_name").eq("owner_id", owner.id).eq("id", `guest_${suffix}_1`).single();
      expect(guest.data).toMatchObject({ created_by: owner.id, display_name: "Alex Guest" });

      const event = await ownerClient.from("reservation_events").select("event_type,acting_user_id").eq("owner_id", owner.id).eq("reservation_id", `res_${suffix}_1`).single();
      expect(event.data).toMatchObject({ event_type: "confirmed", acting_user_id: owner.id });

      const block = await ownerClient.from("reservation_calendar_blocks").select("start_date,end_date,created_by").eq("owner_id", owner.id).eq("source_reference", `res_${suffix}_1`).single();
      expect(block.data).toMatchObject({ created_by: owner.id });
    });

    it("the co-owner confirms a second, non-overlapping reservation on the same unit; the audit trail attributes it to the co-owner, not the owner", async () => {
      const result = await coOwnerClient.rpc("confirm_owner_reservation", {
        p_owner_id: owner.id, p_reservation_id: `res_${suffix}_2`, p_guest_id: `guest_${suffix}_2`, p_unit_id: unitId,
        p_guest_name: "Jamie Guest", p_guest_email: `jamie-${suffix}@example.test`, p_guest_phone: "555-0100",
        p_check_in_date: "2026-11-10", p_check_out_date: "2026-11-12", p_guest_count: 1,
        p_lodging_amount_cents: 13000, p_cleaning_fee_cents: 2500, p_lodging_tax_cents: 780,
        p_security_deposit_cents: 0, p_total_due_cents: 16280, p_currency_code: "usd",
        p_source_reference: `test_${suffix}_2`, p_owner_notes: "Test reservation 2 by co-owner",
      });
      expect(result.error).toBeNull();
      expect(result.data.created_by).toBe(coOwner.id);

      const event = await ownerClient.from("reservation_events").select("acting_user_id").eq("owner_id", owner.id).eq("reservation_id", `res_${suffix}_2`).single();
      expect(event.data.acting_user_id).toBe(coOwner.id);
    });

    it("rejects an overlapping reservation on the same unit, including the turnover buffer, for either the owner or the co-owner", async () => {
      const overlapping = await ownerClient.rpc("confirm_owner_reservation", {
        p_owner_id: owner.id, p_reservation_id: `res_${suffix}_overlap`, p_guest_id: `guest_${suffix}_overlap`, p_unit_id: unitId,
        p_guest_name: "Overlap Guest", p_guest_email: `overlap-${suffix}@example.test`, p_guest_phone: null,
        p_check_in_date: "2026-11-04", p_check_out_date: "2026-11-06", p_guest_count: 1,
        p_lodging_amount_cents: 13000, p_cleaning_fee_cents: 0, p_lodging_tax_cents: 0,
        p_security_deposit_cents: 0, p_total_due_cents: 13000, p_currency_code: "usd",
        p_source_reference: null, p_owner_notes: null,
      });
      expect(overlapping.error).toBeTruthy();
      expect(overlapping.error.message).toMatch(/no longer available|blocked/);
    });

    it("denies an unrelated authenticated user from confirming any reservation for this owner's workspace", async () => {
      const result = await strangerClient.rpc("confirm_owner_reservation", {
        p_owner_id: owner.id, p_reservation_id: `res_${suffix}_stranger`, p_guest_id: `guest_${suffix}_stranger`, p_unit_id: unitId,
        p_guest_name: "Stranger Guest", p_guest_email: `stranger-${suffix}@example.test`, p_guest_phone: null,
        p_check_in_date: "2026-12-01", p_check_out_date: "2026-12-03", p_guest_count: 1,
        p_lodging_amount_cents: 13000, p_cleaning_fee_cents: 0, p_lodging_tax_cents: 0,
        p_security_deposit_cents: 0, p_total_due_cents: 13000, p_currency_code: "usd",
        p_source_reference: null, p_owner_notes: null,
      });
      expect(result.error).toBeTruthy();
      expect(result.error.message).toContain("Workspace access is required");
    });

    it("guest isolation: an unrelated authenticated user cannot read either reservation's guest PII, even by guessing the exact row id", async () => {
      const guest1 = await strangerClient.from("reservation_guests").select("*").eq("owner_id", owner.id).eq("id", `guest_${suffix}_1`);
      expect(guest1.data).toEqual([]);
      const guest2 = await strangerClient.from("reservation_guests").select("*").eq("owner_id", owner.id).eq("id", `guest_${suffix}_2`);
      expect(guest2.data).toEqual([]);
      const reservations = await strangerClient.from("reservations").select("*").eq("owner_id", owner.id);
      expect(reservations.data).toEqual([]);
    });

    it("both the owner and co-owner can see both reservations and both guests -- shared workspace visibility, not per-creator", async () => {
      for (const client of [ownerClient, coOwnerClient]) {
        const reservations = await client.from("reservations").select("id,created_by").eq("owner_id", owner.id).order("id");
        expect(reservations.data.map((r) => r.id).sort()).toEqual([`res_${suffix}_1`, `res_${suffix}_2`].sort());

        const guests = await client.from("reservation_guests").select("id").eq("owner_id", owner.id).order("id");
        expect(guests.data.map((g) => g.id).sort()).toEqual([`guest_${suffix}_1`, `guest_${suffix}_2`].sort());
      }
    });

    it("reservation events are immutable: neither the owner nor a direct superuser-level UPDATE/DELETE bypasses the trigger", async () => {
      const event = await ownerClient.from("reservation_events").select("id").eq("owner_id", owner.id).eq("reservation_id", `res_${suffix}_1`).single();
      const eventId = event.data.id;

      // As the owner, through RLS: no UPDATE/DELETE policy exists at all, so this is rejected
      // before the trigger is even reached.
      const ownerUpdate = await ownerClient.from("reservation_events").update({ event_type: "cancelled" }).eq("owner_id", owner.id).eq("id", eventId);
      expect(ownerUpdate.error).toBeTruthy();

      // Bypassing RLS entirely (raw superuser connection) to prove the IMMUTABILITY TRIGGER
      // itself is real second-layer protection, not merely an artifact of missing grants/policy.
      expect(() => psql(`update reservation_events set event_type = 'cancelled' where owner_id = '${owner.id}' and id = '${eventId}';`))
        .toThrow(/Reservation events are immutable/);
      expect(() => psql(`delete from reservation_events where owner_id = '${owner.id}' and id = '${eventId}';`))
        .toThrow(/Reservation events are immutable/);
    });
  });
});
