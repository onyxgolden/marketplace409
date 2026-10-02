// Behavioral test for the initiated_at marker migration, executed against a
// real PostgreSQL (PGlite, in-process) — no mocks.
//
// Regression under test (ChatGPT re-review NO-GO on PR #535): the first
// revision of 20261002020000 recreated the EIGHT-argument overload of
// process_stripe_rental_payment_event (no p_provider_mode), which the webhook
// route never calls — CREATE OR REPLACE with a different argument list does
// not replace the live function. This test reproduces the production
// sequence: it installs the nine-argument function exactly as the existing
// migration history defines it (20260821000100), applies the new migration
// file, then drives the RPC with the exact nine-argument named shape the
// webhook route passes (including p_provider_mode).
//
// Verifies: exactly one overload survives, processing stamps initiated_at,
// redelivery preserves the first stamp, succeeded/failed transitions retain
// it, and a late processing event after a terminal status preserves evidence
// WITHOUT moving the terminal status backwards.
import { describe, expect, it, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS = path.join(process.cwd(), "supabase/migrations");
const historySql = fs.readFileSync(path.join(MIGRATIONS, "20260821000100_add_provider_mode_to_stripe_rpcs.sql"), "utf8");
const newMigrationSql = fs.readFileSync(path.join(MIGRATIONS, "20261002020000_rental_payments_initiated_at.sql"), "utf8");

// The nine-argument function exactly as history installed it: from its CREATE
// to the body's closing $$; (the body contains no other $$; sequence).
function historyNineArgFunction() {
  const start = historySql.indexOf("create function process_stripe_rental_payment_event(");
  if (start === -1) throw new Error("nine-arg function not found in history migration");
  const end = historySql.indexOf("$$;", start);
  if (end === -1) throw new Error("function body terminator not found");
  return historySql.slice(start, end + 3);
}

const MINIMAL_SCHEMA = `
create role anon;
create role authenticated;
create role service_role;
create table landlord_payment_accounts(
  provider text, provider_mode text, provider_account_id text, owner_id text
);
create table payment_webhook_events(
  id text primary key, provider text, provider_mode text,
  provider_event_id text, status text, processed_at timestamptz, failure_message text
);
create table rental_payments(
  owner_id text, id text primary key, provider text, provider_mode text,
  provider_payment_id text, status text, amount_cents bigint, charge_id text,
  tenant_id text, lease_id text, failure_code text, failure_message text,
  succeeded_at timestamptz, updated_at timestamptz
);
create table rent_charges(
  owner_id text, id text primary key, amount_cents bigint,
  paid_amount_cents bigint default 0, status text, updated_at timestamptz
);
insert into landlord_payment_accounts(provider, provider_mode, provider_account_id, owner_id)
  values ('stripe','live','acct_live_1','owner_1'),('stripe','test','acct_test_1','owner_1');
`;

let db;
let eventSeq = 0;
let paymentSeq = 0;

async function setup() {
  db = new PGlite();
  await db.exec(MINIMAL_SCHEMA);
  // Existing migration history: the nine-argument mode-aware function.
  await db.exec(historyNineArgFunction());
}

function nextEventId() { eventSeq += 1; return `evt_${eventSeq}`; }
function nextPaymentId() { paymentSeq += 1; return `rental_payment_${paymentSeq}`; }

async function seedPayment({ mode = "live", status = "pending", chargeAmount = 160000 } = {}) {
  const paymentId = nextPaymentId();
  const chargeId = `charge_${paymentId}`;
  await db.exec(`
    insert into rent_charges(owner_id,id,amount_cents,paid_amount_cents,status)
      values ('owner_1','${chargeId}',${chargeAmount},0,'unpaid');
    insert into rental_payments(owner_id,id,provider,provider_mode,provider_payment_id,status,amount_cents,charge_id,tenant_id,lease_id)
      values ('owner_1','${paymentId}','stripe','${mode}','pi_${paymentId}','${status}',${chargeAmount},'${chargeId}','tenant_1','lease_1');
  `);
  return { paymentId, chargeId };
}

async function seedEvent({ paymentId, eventType, mode = "live" } = {}) {
  const eventId = nextEventId();
  await db.exec(`
    insert into payment_webhook_events(id,provider,provider_mode,provider_event_id,status)
      values ('${eventId}','stripe','${mode}','${eventId}','pending');
  `);
  return eventId;
}

// Exactly the named-argument shape src/app/api/rental/stripe-webhook/route.js passes.
async function callRpc({ eventId, paymentId, eventType, occurredAt, mode = "live", accountId = null, failureCode = null, failureMessage = null }) {
  const acct = accountId ?? (mode === "live" ? "acct_live_1" : "acct_test_1");
  const rows = await db.query(
    `select process_stripe_rental_payment_event(
       p_provider_event_id := $1, p_connected_account_id := $2, p_event_type := $3,
       p_object_id := $4, p_payment_id := $5, p_failure_code := $6,
       p_failure_message := $7, p_occurred_at := $8, p_provider_mode := $9
     ) as result`,
    [eventId, acct, eventType, `pi_${paymentId}`, paymentId, failureCode, failureMessage, occurredAt, mode]
  );
  return rows.rows[0].result;
}

async function paymentRow(paymentId) {
  const rows = await db.query(
    `select status, initiated_at, succeeded_at, updated_at from rental_payments where id = $1`,
    [paymentId]
  );
  return rows.rows[0];
}

beforeAll(async () => {
  await setup();
}, 60000);

describe("initiated_at marker: history + new migration on a real database", () => {
  it("the pre-migration history function processes without the marker column (baseline)", async () => {
    const { paymentId } = await seedPayment();
    const eventId = await seedEvent({ paymentId });
    const res = await callRpc({ eventId, paymentId, eventType: "payment_intent.processing", occurredAt: "2026-10-02T06:00:00Z" });
    expect(res.status).toBe("processed");
    // initiated_at does not exist yet on the history schema — status-only read.
    const rows = await db.query(`select status from rental_payments where id = $1`, [paymentId]);
    expect(rows.rows[0].status).toBe("processing");
  });

  it("after the migration, exactly one overload of the RPC exists", async () => {
    await db.exec(newMigrationSql);
    const rows = await db.query(
      `select count(*)::int as n from pg_proc where proname = 'process_stripe_rental_payment_event'`
    );
    expect(rows.rows[0].n).toBe(1);
    const sig = await db.query(
      `select pg_get_function_identity_arguments(oid) as args from pg_proc
       where proname = 'process_stripe_rental_payment_event'`
    );
    expect(sig.rows[0].args).toContain("p_provider_mode");
  });

  it("processing stamps initiated_at with the actual webhook argument shape", async () => {
    const { paymentId } = await seedPayment();
    const eventId = await seedEvent({ paymentId });
    const res = await callRpc({ eventId, paymentId, eventType: "payment_intent.processing", occurredAt: "2026-10-02T07:00:00Z" });
    expect(res.status).toBe("processed");
    const row = await paymentRow(paymentId);
    expect(row.status).toBe("processing");
    expect(new Date(row.initiated_at).toISOString()).toBe("2026-10-02T07:00:00.000Z");
  });

  it("redelivery preserves the first stamp (first detection wins)", async () => {
    const { paymentId } = await seedPayment();
    const e1 = await seedEvent({ paymentId });
    await callRpc({ eventId: e1, paymentId, eventType: "payment_intent.processing", occurredAt: "2026-10-02T07:00:00Z" });
    const e2 = await seedEvent({ paymentId });
    await callRpc({ eventId: e2, paymentId, eventType: "payment_intent.processing", occurredAt: "2026-10-02T07:05:00Z" });
    const row = await paymentRow(paymentId);
    expect(new Date(row.initiated_at).toISOString()).toBe("2026-10-02T07:00:00.000Z");
  });

  it("succeeded transition retains the marker and updates the charge", async () => {
    const { paymentId, chargeId } = await seedPayment({ chargeAmount: 160000 });
    const e1 = await seedEvent({ paymentId });
    await callRpc({ eventId: e1, paymentId, eventType: "payment_intent.processing", occurredAt: "2026-10-02T07:00:00Z" });
    const e2 = await seedEvent({ paymentId });
    await callRpc({ eventId: e2, paymentId, eventType: "payment_intent.succeeded", occurredAt: "2026-10-03T07:00:00Z" });
    const row = await paymentRow(paymentId);
    expect(row.status).toBe("succeeded");
    expect(new Date(row.initiated_at).toISOString()).toBe("2026-10-02T07:00:00.000Z");
    const charge = await db.query(`select paid_amount_cents, status from rent_charges where id = $1`, [chargeId]);
    expect(Number(charge.rows[0].paid_amount_cents)).toBe(160000);
    expect(charge.rows[0].status).toBe("paid");
  });

  it("late processing after succeeded preserves evidence WITHOUT moving the terminal status", async () => {
    const { paymentId } = await seedPayment();
    // Succeeded with NO prior processing: marker is null.
    const e1 = await seedEvent({ paymentId });
    await callRpc({ eventId: e1, paymentId, eventType: "payment_intent.succeeded", occurredAt: "2026-10-03T07:00:00Z" });
    let row = await paymentRow(paymentId);
    expect(row.status).toBe("succeeded");
    expect(row.initiated_at).toBeNull();
    const updatedAtBefore = row.updated_at;
    // Late processing event arrives afterwards.
    const e2 = await seedEvent({ paymentId });
    const res = await callRpc({ eventId: e2, paymentId, eventType: "payment_intent.processing", occurredAt: "2026-10-03T08:00:00Z" });
    expect(res.status).toBe("processed");
    row = await paymentRow(paymentId);
    expect(row.status).toBe("succeeded"); // terminal status NOT moved backwards
    expect(new Date(row.initiated_at).toISOString()).toBe("2026-10-03T08:00:00.000Z"); // evidence preserved
    expect(new Date(row.updated_at).toISOString()).toBe(new Date(updatedAtBefore).toISOString()); // updated_at untouched
  });

  it("processing on a failed payment (retry) transitions and stamps", async () => {
    const { paymentId } = await seedPayment();
    const e1 = await seedEvent({ paymentId });
    await callRpc({ eventId: e1, paymentId, eventType: "payment_intent.payment_failed", occurredAt: "2026-10-02T07:00:00Z", failureCode: "card_declined" });
    let row = await paymentRow(paymentId);
    expect(row.status).toBe("failed");
    const e2 = await seedEvent({ paymentId });
    await callRpc({ eventId: e2, paymentId, eventType: "payment_intent.processing", occurredAt: "2026-10-02T08:00:00Z" });
    row = await paymentRow(paymentId);
    expect(row.status).toBe("processing");
    expect(new Date(row.initiated_at).toISOString()).toBe("2026-10-02T08:00:00.000Z");
  });

  it("provider_mode scoping survives: a live event cannot touch a test-tagged payment", async () => {
    const { paymentId } = await seedPayment({ mode: "test" });
    const eventId = await seedEvent({ paymentId, mode: "live" });
    await expect(
      callRpc({ eventId, paymentId, eventType: "payment_intent.processing", occurredAt: "2026-10-02T07:00:00Z", mode: "live" })
    ).rejects.toThrow(/Stripe event payment mapping was not found/);
  });

  it("provider_mode validation survives: null mode is rejected", async () => {
    const { paymentId } = await seedPayment();
    const eventId = await seedEvent({ paymentId });
    await expect(
      db.query(
        `select process_stripe_rental_payment_event(
           p_provider_event_id := $1, p_connected_account_id := $2, p_event_type := $3,
           p_object_id := $4, p_payment_id := $5, p_occurred_at := $6, p_provider_mode := $7
         )`,
        [eventId, "acct_live_1", "payment_intent.processing", `pi_${paymentId}`, paymentId, "2026-10-02T07:00:00Z", null]
      )
    ).rejects.toThrow(/valid provider mode is required/);
  });
});
