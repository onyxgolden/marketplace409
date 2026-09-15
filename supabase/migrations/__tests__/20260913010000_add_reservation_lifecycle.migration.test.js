import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const LOCAL_URL = "http://127.0.0.1:54321";
const DB_CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_marketplace409-reservation-validation";
const migrationPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../20260913010000_add_reservation_lifecycle.sql");
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

function asAnon(sql) {
  return psql(`begin;
    set local role anon;
    ${sql}
    rollback;`);
}

async function reachable() {
  try {
    return (await fetch(`${LOCAL_URL}/auth/v1/health`, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}

const localStackReachable = await reachable();

describe.skipIf(!localStackReachable)("reservation lifecycle RPCs (real local Supabase)", () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const ownerId = crypto.randomUUID();
  const ownerUserId = ownerId;
  const strangerUserId = crypto.randomUUID();
  const unitId = `lifecycle_unit_${suffix}`;
  const guestId = `lifecycle_guest_${suffix}`;

  // Two independent, otherwise-identical reservations, so each scenario (modify, conflict, cancel,
  // check_in/check_out, cross-workspace denial) mutates its own row without cross-test interference.
  const reservationA = `lifecycle_res_a_${suffix}`;
  const reservationB = `lifecycle_res_b_${suffix}`;
  const reservationC = `lifecycle_res_c_${suffix}`;

  function insertReservation(id, { checkIn, checkOut, status = "confirmed", lodging = 30000, cleaning = 5000, tax = 2000, deposit = 10000 }) {
    const total = lodging + cleaning + tax + deposit;
    // source_reference is unique-nulls-not-distinct per (owner_id, source_system) -- give each fixture
    // reservation its own value so multiple 'forge_direct' rows for one owner don't collide.
    psql(`
      insert into reservations(owner_id,id,unit_id,guest_id,status,check_in_date,check_out_date,guest_count,
        lodging_amount_cents,cleaning_fee_cents,lodging_tax_cents,security_deposit_cents,total_due_cents,currency_code,created_by,source_reference)
      values ('${ownerId}','${id}','${unitId}','${guestId}','${status}','${checkIn}','${checkOut}',2,
        ${lodging},${cleaning},${tax},${deposit},${total},'USD','${ownerUserId}','fixture_${id}');
      insert into reservation_calendar_blocks(owner_id,id,unit_id,start_date,end_date,block_type,source_system,source_reference,created_by)
      values ('${ownerId}','block_${id}','${unitId}','${checkIn}','${checkOut}','turnover','forge','${id}','${ownerUserId}');
    `);
  }

  beforeAll(() => {
    psql(migrationSql);
    psql(`
      insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      values
        ('00000000-0000-0000-0000-000000000000','${ownerUserId}','authenticated','authenticated','lifecycle-owner-${suffix}@example.test','',now(),'{}','{}',now(),now()),
        ('00000000-0000-0000-0000-000000000000','${strangerUserId}','authenticated','authenticated','lifecycle-stranger-${suffix}@example.test','',now(),'{}','{}',now(),now());
      insert into rental_units(owner_id,id,property_id,label,status)
      values ('${ownerId}','${unitId}','lifecycle_property_${suffix}','Lifecycle fixture','occupied');
      -- reservation_inventory_settings has trg_enforce_reservation_inventory_settings_actor, which
      -- always overwrites created_by/updated_by with auth.uid() regardless of the inserted value --
      -- set the JWT claim so it resolves to the fixture owner instead of null. is_local=false (session
      -- scope) since each statement piped to psql here auto-commits its own implicit transaction.
      select set_config('request.jwt.claim.sub', '${ownerUserId}', false);
      insert into reservation_inventory_settings(owner_id,unit_id,inventory_type,booking_status,public_name,maximum_guests,minimum_nights,maximum_nights,turnover_buffer_hours,created_by,updated_by)
      values ('${ownerId}','${unitId}','cabin','active','Lifecycle cabin',4,2,14,24,'${ownerUserId}','${ownerUserId}');
      insert into reservation_guests(owner_id,id,display_name,email,created_by)
      values ('${ownerId}','${guestId}','Lifecycle Guest','lifecycle-guest-${suffix}@example.test','${ownerUserId}');
    `);
    insertReservation(reservationA, { checkIn: "2027-03-10", checkOut: "2027-03-15" });
    insertReservation(reservationB, { checkIn: "2027-04-10", checkOut: "2027-04-15" });
    insertReservation(reservationC, { checkIn: "2027-05-01", checkOut: "2027-05-04" });
  }, 30000);

  afterAll(() => {
    if (!localStackReachable) return;
    // reservation_events carries a hard "Reservation events are immutable" delete-blocking trigger
    // (prevent_reservation_event_mutation) with no role exception -- the standard, safe way for the
    // local Postgres administrator to remove fixture rows behind an immutability trigger is a
    // session-scoped `session_replication_role = replica` around the cleanup only, never a widened
    // grant or a change to the trigger itself.
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
      delete from auth.users where id in ('${ownerUserId}','${strangerUserId}');
      set session_replication_role = default;
    `);
  }, 30000);

  it("is idempotent and keeps both RPCs SECURITY DEFINER with row security disabled, EXECUTE limited to authenticated", () => {
    psql(migrationSql); // re-apply on top of beforeAll's own apply — must be a no-op
    const output = psql(`select pg_proc.oid::regprocedure::text, prosecdef, coalesce(array_to_string(proconfig,','),'')
      from pg_proc join pg_namespace on pg_namespace.oid=pg_proc.pronamespace
      where nspname='public' and pg_proc.oid in (
        'modify_owner_reservation(text,text,text,date,date,integer,bigint,bigint,bigint,bigint,bigint,text,text)'::regprocedure,
        'transition_owner_reservation(text,text,text,text)'::regprocedure
      ) order by pg_proc.oid::regprocedure::text;
      select r, has_function_privilege(r,
        'modify_owner_reservation(text,text,text,date,date,integer,bigint,bigint,bigint,bigint,bigint,text,text)', 'execute')
      from unnest(array['anon','authenticated','service_role']) r;`);
    expect(output).toContain("modify_owner_reservation(text,text,text,date,date,integer,bigint,bigint,bigint,bigint,bigint,text,text)|t|");
    expect(output).toContain("transition_owner_reservation(text,text,text,text)|t|");
    expect(output.match(/row_security=off/g)).toHaveLength(2);
    expect(output).toContain("anon|f");
    expect(output).toContain("authenticated|t");
    expect(output).toContain("service_role|f");
  });

  it("denies anon EXECUTE on both RPCs outright", () => {
    expect(() => asAnon(`select modify_owner_reservation('${ownerId}','${reservationA}','${unitId}',
      '2027-03-11','2027-03-16',2,30000,5000,2000,10000,47000,'USD','anon probe');`))
      .toThrow(/permission denied for function/);
    expect(() => asAnon(`select transition_owner_reservation('${ownerId}','${reservationA}','check_in',null);`))
      .toThrow(/permission denied for function/);
  });

  it("denies an unrelated authenticated user (no workspace access) on both RPCs", () => {
    expect(() => asAuthenticated(strangerUserId, `select modify_owner_reservation('${ownerId}','${reservationA}','${unitId}',
      '2027-03-11','2027-03-16',2,30000,5000,2000,10000,47000,'USD','stranger probe');`))
      .toThrow(/Workspace access is required/);
    expect(() => asAuthenticated(strangerUserId, `select transition_owner_reservation('${ownerId}','${reservationA}','cancel',null);`))
      .toThrow(/Workspace access is required/);
  });

  it("denies direct table writes even for the owning authenticated user — RPC-only mutation is enforced", () => {
    expect(() => asAuthenticated(ownerUserId,
      `update reservations set guest_count=3 where owner_id='${ownerId}' and id='${reservationA}';`))
      .toThrow(/permission denied for table reservations/);
    expect(() => asAuthenticated(ownerUserId,
      `insert into reservation_events(owner_id,id,reservation_id,event_type,event_payload,acting_user_id)
       values ('${ownerId}','direct_${suffix}','${reservationA}','note_added','{}','${ownerUserId}');`))
      .toThrow(/permission denied for table reservation_events/);
  });

  it("lets the owner successfully modify dates/guest-count/notes on their own reservation (amounts unchanged), and records a before/after audit event", () => {
    // Amounts are intentionally held IDENTICAL to the fixture's original values here -- see the
    // dedicated defect-documentation test below for why a same-call amount change is not exercised
    // as a positive path.
    const before = psql(`select total_due_cents from reservations where owner_id='${ownerId}' and id='${reservationA}';`).trim();
    expect(before).toBe("47000");

    const output = asAuthenticated(ownerUserId, `select row_to_json(result)::text from modify_owner_reservation(
      '${ownerId}','${reservationA}','${unitId}','2027-03-11','2027-03-17',3,30000,5000,2000,10000,47000,'usd','Owner adjusted dates'
    ) result;`, { commit: true });
    const data = JSON.parse(output.trim().split("\n").find((line) => line.startsWith("{")));
    expect(data).toMatchObject({
      owner_id: ownerId, id: reservationA, check_in_date: "2027-03-11", check_out_date: "2027-03-17",
      guest_count: 3, total_due_cents: 47000, currency_code: "USD", owner_notes: "Owner adjusted dates",
    });

    const block = psql(`select start_date,end_date from reservation_calendar_blocks
      where owner_id='${ownerId}' and source_system='forge' and source_reference='${reservationA}';`).trim();
    expect(block).toBe("2027-03-11|2027-03-17");

    const event = psql(`select event_type, event_payload::text, acting_user_id from reservation_events
      where owner_id='${ownerId}' and reservation_id='${reservationA}' and event_type='modified'
      order by occurred_at desc limit 1;`).trim();
    expect(event).toContain("modified|");
    expect(event).toContain(`|${ownerUserId}`);
    const payload = JSON.parse(event.split("|")[1]);
    expect(payload.before).toMatchObject({ checkInDate: "2027-03-10", checkOutDate: "2027-03-15", guestCount: 2, totalDueCents: 47000 });
    expect(payload.after).toMatchObject({ checkInDate: "2027-03-11", checkOutDate: "2027-03-17", guestCount: 3, totalDueCents: 47000 });
  });

  it("gives an honest, explicit rejection for an attempted price change, instead of the trigger's own confusing low-level error", () => {
    // A reservation's financial-contract snapshot (auto-created on insert by
    // initialize_reservation_financial_contract, 20260913040000) is deliberately immutable --
    // prevent_reservation_financial_snapshot_rewrite blocks any UPDATE on `reservations` that changes
    // lodging_amount_cents/cleaning_fee_cents/lodging_tax_cents/security_deposit_cents/total_due_cents/
    // currency_code once that snapshot exists, which is true for every reservation immediately. Before
    // this fix, modify_owner_reservation didn't know that and would let a price-changing call reach the
    // trigger, surfacing "Reservation financial snapshot is immutable" from deep inside its own UPDATE.
    // It now detects the same condition itself, first, and raises a clear, specific exception.
    expect(() => asAuthenticated(ownerUserId, `select modify_owner_reservation(
      '${ownerId}','${reservationA}','${unitId}','2027-03-11','2027-03-18',3,36000,5000,2400,10000,53400,'USD','Owner adjusted price too'
    );`)).toThrow(/Reservation pricing is immutable once a financial contract exists/);

    // A currency-only change (amounts held numerically identical) is also caught by the same guard.
    expect(() => asAuthenticated(ownerUserId, `select modify_owner_reservation(
      '${ownerId}','${reservationA}','${unitId}','2027-03-11','2027-03-18',3,30000,5000,2000,10000,47000,'EUR','Currency swap attempt'
    );`)).toThrow(/Reservation pricing is immutable once a financial contract exists/);

    // Passing the reservation's own existing amounts back unchanged (the honest, supported path for a
    // pure date/guest-count/notes modification) still succeeds -- covered by the "lets the owner
    // successfully modify..." test above; this test only proves the rejection path.
  });

  it("rejects a modification that exceeds the unit's guest limit", () => {
    // The migration's own "Reservation quote total is invalid" reconciliation check
    // (total_due_cents <> sum of components) is retained as defense in depth but is no longer
    // reachable through this RPC for a validly-created row: total_due_cents is itself one of the
    // six columns the price-immutability guard above checks, so any call whose total differs from
    // the reservation's current total is rejected by that guard first, before reconciliation is
    // even evaluated. Not exercised here as a result -- see the price-immutability tests above.
    expect(() => asAuthenticated(ownerUserId, `select modify_owner_reservation(
      '${ownerId}','${reservationB}','${unitId}','2027-04-10','2027-04-15',5,30000,5000,2000,10000,47000,'USD',null
    );`)).toThrow(/Guest count is outside the inventory limit/);
  });

  it("rejects a modification that overlaps another confirmed reservation on the same unit (double-booking)", () => {
    // reservationC is confirmed 2027-05-01..2027-05-04; moving reservationB to overlap it (plus the
    // unit's 24h/1-day turnover buffer) must be rejected rather than silently double-booking the unit.
    expect(() => asAuthenticated(ownerUserId, `select modify_owner_reservation(
      '${ownerId}','${reservationB}','${unitId}','2027-05-02','2027-05-06',2,30000,5000,2000,10000,47000,'USD',null
    );`)).toThrow(/Reservation dates are no longer available/);

    // reservationB itself must be untouched by the rejected attempt.
    const row = psql(`select check_in_date,check_out_date from reservations where owner_id='${ownerId}' and id='${reservationB}';`).trim();
    expect(row).toBe("2027-04-10|2027-04-15");
  });

  it("moves a confirmed reservation through check_in then check_out, and rejects an invalid transition", () => {
    const checkInOut = asAuthenticated(ownerUserId,
      `select row_to_json(result)::text from transition_owner_reservation('${ownerId}','${reservationB}','check_in',null) result;`,
      { commit: true });
    expect(JSON.parse(checkInOut.trim().split("\n").find((l) => l.startsWith("{")))).toMatchObject({ id: reservationB, status: "checked_in" });

    expect(() => asAuthenticated(ownerUserId,
      `select transition_owner_reservation('${ownerId}','${reservationB}','check_in',null);`))
      .not.toThrow(); // same-status transition is a no-op success (v_current.status = v_target early-return), not an error

    expect(() => asAuthenticated(ownerUserId,
      `select transition_owner_reservation('${ownerId}','${reservationB}','cancel','trying to cancel after check-in');`))
      .toThrow(/Reservation cannot transition from checked_in using cancel/);

    const checkedOut = asAuthenticated(ownerUserId,
      `select row_to_json(result)::text from transition_owner_reservation('${ownerId}','${reservationB}','check_out',null) result;`,
      { commit: true });
    expect(JSON.parse(checkedOut.trim().split("\n").find((l) => l.startsWith("{")))).toMatchObject({ id: reservationB, status: "checked_out" });

    // checked_out clears the reservation's own calendar block.
    const blockGone = psql(`select count(*) from reservation_calendar_blocks
      where owner_id='${ownerId}' and source_system='forge' and source_reference='${reservationB}';`).trim();
    expect(blockGone).toBe("0");
  });

  it("cancels a held/confirmed reservation, stamps cancelled_at, records the reason, and clears its calendar block", () => {
    const output = asAuthenticated(ownerUserId, `select row_to_json(result)::text
      from transition_owner_reservation('${ownerId}','${reservationC}','cancel','Guest requested cancellation') result;`,
      { commit: true });
    const data = JSON.parse(output.trim().split("\n").find((l) => l.startsWith("{")));
    expect(data).toMatchObject({ id: reservationC, status: "cancelled" });
    expect(data.cancelled_at).not.toBeNull();

    const blockGone = psql(`select count(*) from reservation_calendar_blocks
      where owner_id='${ownerId}' and source_system='forge' and source_reference='${reservationC}';`).trim();
    expect(blockGone).toBe("0");

    const event = psql(`select event_payload::text from reservation_events
      where owner_id='${ownerId}' and reservation_id='${reservationC}' and event_type='cancelled'
      order by occurred_at desc limit 1;`).trim();
    expect(JSON.parse(event)).toMatchObject({ previousStatus: "confirmed", reason: "Guest requested cancellation" });
  });
});
