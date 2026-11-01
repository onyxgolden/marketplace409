import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const LOCAL_URL = "http://127.0.0.1:54321";
const DB_CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_marketplace409-reservation-validation";
const migrationPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../20261101000000_rental_reservation_confirm_transition.sql");
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

// B7 confirm leg (landlord decision 2026-10-31): transition_owner_reservation
// gains a 'confirm' action, held -> confirmed only. Each test re-applies this
// migration immediately before its transition call (same psql session) so the
// older 20260913010000 lifecycle test, which re-applies its own version of
// this function, cannot revert the function mid-run on a shared stack.
describe.skipIf(!localStackReachable)("reservation confirm transition (real local Supabase)", () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const ownerId = crypto.randomUUID();
  const ownerUserId = ownerId;
  const unitId = `confirm_unit_${suffix}`;
  const guestId = `confirm_guest_${suffix}`;

  const reservationHeld = `confirm_res_held_${suffix}`;
  const reservationCancelled = `confirm_res_cancelled_${suffix}`;
  const reservationCheckedIn = `confirm_res_checkedin_${suffix}`;
  const reservationConfirmed = `confirm_res_confirmed_${suffix}`;

  function insertReservation(id, status) {
    psql(`
      insert into reservations(owner_id,id,unit_id,guest_id,status,check_in_date,check_out_date,guest_count,
        lodging_amount_cents,cleaning_fee_cents,lodging_tax_cents,security_deposit_cents,total_due_cents,currency_code,created_by,source_reference)
      values ('${ownerId}','${id}','${unitId}','${guestId}','${status}','2027-06-10','2027-06-15',2,
        30000,5000,2000,10000,47000,'USD','${ownerUserId}','fixture_${id}');
    `);
  }

  beforeAll(() => {
    psql(migrationSql);
    psql(`
      insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      values ('00000000-0000-0000-0000-000000000000','${ownerUserId}','authenticated','authenticated','confirm-owner-${suffix}@example.test','',now(),'{}','{}',now(),now());
      insert into rental_units(owner_id,id,property_id,label,status)
      values ('${ownerId}','${unitId}','confirm_property_${suffix}','Confirm fixture','occupied');
      select set_config('request.jwt.claim.sub', '${ownerUserId}', false);
      insert into reservation_inventory_settings(owner_id,unit_id,inventory_type,booking_status,public_name,maximum_guests,minimum_nights,maximum_nights,turnover_buffer_hours,created_by,updated_by)
      values ('${ownerId}','${unitId}','cabin','active','Confirm cabin',4,2,14,24,'${ownerUserId}','${ownerUserId}');
      insert into reservation_guests(owner_id,id,display_name,email,created_by)
      values ('${ownerId}','${guestId}','Confirm Guest','confirm-guest-${suffix}@example.test','${ownerUserId}');
    `);
    insertReservation(reservationHeld, "held");
    insertReservation(reservationCancelled, "cancelled");
    insertReservation(reservationCheckedIn, "checked_in");
    insertReservation(reservationConfirmed, "confirmed");
    psql(`
      insert into reservation_calendar_blocks(owner_id,id,unit_id,start_date,end_date,block_type,source_system,source_reference,created_by)
      values ('${ownerId}','block_${reservationHeld}','${unitId}','2027-06-10','2027-06-15','turnover','forge','${reservationHeld}','${ownerUserId}');
    `);
  }, 30000);

  afterAll(() => {
    if (!localStackReachable) return;
    psql(`
      set session_replication_role = replica;
      delete from reservation_events where owner_id='${ownerId}';
      delete from reservation_calendar_blocks where owner_id='${ownerId}';
      delete from reservation_payment_events where owner_id='${ownerId}';
      delete from reservation_payment_attempts where owner_id='${ownerId}';
      delete from reservation_financial_contracts where owner_id='${ownerId}';
      delete from reservations where owner_id='${ownerId}';
      delete from reservation_guests where owner_id='${ownerId}';
      delete from reservation_inventory_settings where owner_id='${ownerId}';
      delete from rental_units where owner_id='${ownerId}';
      delete from auth.users where id in ('${ownerUserId}');
      set session_replication_role = default;
    `);
  }, 30000);

  it("confirms a held reservation, records a confirmed event, and keeps its calendar block", () => {
    const out = asAuthenticated(ownerUserId, `
      ${migrationSql}
      select row_to_json(result)::text from transition_owner_reservation('${ownerId}','${reservationHeld}','confirm',null) result;
    `, { commit: true });
    const data = JSON.parse(out.trim().split("\n").pop());
    expect(data).toMatchObject({ id: reservationHeld, status: "confirmed" });
    const event = psql(`select event_type, event_payload->>'previousStatus' from reservation_events where owner_id='${ownerId}' and reservation_id='${reservationHeld}' and event_type='confirmed';`).trim();
    expect(event).toBe("confirmed|held");
    const block = psql(`select count(*) from reservation_calendar_blocks where owner_id='${ownerId}' and source_reference='${reservationHeld}';`).trim();
    expect(block).toBe("1");
  });

  it("refuses to confirm a cancelled reservation", () => {
    expect(() => asAuthenticated(ownerUserId, `
      ${migrationSql}
      select transition_owner_reservation('${ownerId}','${reservationCancelled}','confirm',null);
    `)).toThrow(/Reservation cannot transition from cancelled using confirm/);
  });

  it("refuses to confirm a checked-in reservation", () => {
    expect(() => asAuthenticated(ownerUserId, `
      ${migrationSql}
      select transition_owner_reservation('${ownerId}','${reservationCheckedIn}','confirm',null);
    `)).toThrow(/Reservation cannot transition from checked_in using confirm/);
  });

  it("confirming an already-confirmed reservation is an idempotent no-op, matching the cancel convention", () => {
    const out = asAuthenticated(ownerUserId, `
      ${migrationSql}
      select row_to_json(result)::text from transition_owner_reservation('${ownerId}','${reservationConfirmed}','confirm',null) result;
    `, { commit: true });
    const data = JSON.parse(out.trim().split("\n").pop());
    expect(data).toMatchObject({ id: reservationConfirmed, status: "confirmed" });
  });

  it("re-applying the migration is a no-op and keeps EXECUTE limited to authenticated", () => {
    psql(migrationSql);
    const output = psql(`select r, has_function_privilege(r,
      'transition_owner_reservation(text,text,text,text)', 'execute')
      from unnest(array['anon','authenticated','service_role']) r;`);
    expect(output).toContain("anon|f");
    expect(output).toContain("authenticated|t");
    expect(output).toContain("service_role|f");
  });
});
