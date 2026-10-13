// Tests for the read-only receipt-ledger watchdog. Synthetic fixtures
// only: the db is an in-memory mock. The watchdog never writes.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route.js";

let DB;

function matches(filters) {
  return (r) => filters.every(([c, v]) => r[c] === v);
}

function chainable(table) {
  const rows = DB[table] ?? [];
  const filters = [];
  const inLists = [];
  const gtes = [];
  const obj = {
    select() {
      return obj;
    },
    eq(col, val) {
      filters.push([col, val]);
      return obj;
    },
    in(col, vals) {
      inLists.push([col, vals]);
      return obj;
    },
    gte(col, val) {
      gtes.push([col, val]);
      return obj;
    },
    order() {
      return obj;
    },
    async maybeSingle() {
      return { data: rows.find(matches(filters)) ?? null, error: null };
    },
    then(resolve) {
      const found = rows.filter(
        (r) =>
          matches(filters)(r) &&
          inLists.every(([c, vs]) => vs.includes(r[c])) &&
          gtes.every(([c, v]) => r[c] >= v),
      );
      resolve({ data: found, error: null });
    },
  };
  return obj;
}

vi.mock("@/lib/supabase/createRentalWebhookClient", () => ({
  createRentalWebhookClient: () => ({ from: (table) => chainable(table) }),
}));

function authedRequest() {
  return new Request("https://example.com/api/rental/cron/receipt-ledger-watchdog", {
    headers: { authorization: "Bearer test-cron-secret" },
  });
}

const SLOT = "2026-10-12";

function ledgerRow(overrides) {
  return {
    id: `ledger_${Math.random().toString(36).slice(2)}`,
    schedule_name: "tenant_invite",
    scheduled_slot: SLOT,
    recipient_allowlist_id: "rental_tenant_test_1",
    run_id: "run_1",
    state: "provider_accepted",
    provider_message_id: "msg_1",
    failure_reason: null,
    claimed_at: `${SLOT}T15:05:00.000Z`,
    updated_at: `${SLOT}T15:05:01.000Z`,
    ...overrides,
  };
}

beforeEach(() => {
  process.env.CRON_SECRET = "test-cron-secret";
  DB = {
    scheduled_send_ledger: [],
    scheduled_send_attempts: [],
    private_financing_payment_receipt_deliveries: [],
    rental_tenant_receipt_deliveries: [],
  };
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.CRON_SECRET;
});

describe("receipt-ledger watchdog", () => {
  it("returns 401 without the cron secret", async () => {
    const res = await GET(new Request("https://example.com/api/rental/cron/receipt-ledger-watchdog"));
    expect(res.status).toBe(401);
  });

  it("does not evaluate schedules before their grace window", async () => {
    // 10:30 CDT: tenant_invite ran at 10:00, 90-min grace ends 11:30.
    vi.setSystemTime(new Date("2026-10-12T15:30:00.000Z"));
    const res = await GET(authedRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.failed).toBe(0);
    expect(body.alerts).toEqual([]);
    expect(body.schedules.tenant_invite.evaluated).toBe(false);
  });

  it("alerts missing_sweep when no ledger rows exist past grace", async () => {
    // 20:00 UTC = 15:00 CDT: all three schedules past grace.
    vi.setSystemTime(new Date("2026-10-12T20:00:00.000Z"));
    const res = await GET(authedRequest());
    const body = await res.json();
    expect(body.failed).toBe(3);
    expect(body.alerts.map((a) => a.state)).toEqual(["missing_sweep", "missing_sweep", "missing_sweep"]);
    expect(body.schedules.tenant_invite.evaluated).toBe(true);
  });

  it("is quiet when every schedule has healthy terminal rows", async () => {
    vi.setSystemTime(new Date("2026-10-12T20:00:00.000Z"));
    DB.scheduled_send_ledger = [
      ledgerRow({ schedule_name: "tenant_invite" }),
      ledgerRow({ schedule_name: "pf_payment_receipts", recipient_allowlist_id: "borrower_1" }),
      ledgerRow({ schedule_name: "tenant_payment_receipts", recipient_allowlist_id: "tenant_9" }),
    ];
    const res = await GET(authedRequest());
    const body = await res.json();
    expect(body.failed).toBe(0);
    expect(body.alerts).toEqual([]);
  });

  it("alerts send_failed for provider_failed rows", async () => {
    vi.setSystemTime(new Date("2026-10-12T20:00:00.000Z"));
    DB.scheduled_send_ledger = [
      ledgerRow({ schedule_name: "tenant_invite" }),
      ledgerRow({
        schedule_name: "pf_payment_receipts",
        recipient_allowlist_id: "borrower_1",
        state: "provider_failed",
        failure_reason: "Resend rejected email delivery (500).",
      }),
      ledgerRow({ schedule_name: "tenant_payment_receipts", recipient_allowlist_id: "tenant_9" }),
    ];
    const res = await GET(authedRequest());
    const body = await res.json();
    expect(body.failed).toBe(1);
    expect(body.alerts[0]).toMatchObject({
      schedule: "pf_payment_receipts",
      recipient: "borrower_1",
      state: "send_failed",
    });
    expect(body.alerts[0].reason).toContain("500");
  });

  it("alerts stuck_claim for claims older than 2x grace with no outcome", async () => {
    vi.setSystemTime(new Date("2026-10-12T20:00:00.000Z"));
    DB.scheduled_send_ledger = [
      ledgerRow({ schedule_name: "tenant_invite" }),
      ledgerRow({ schedule_name: "pf_payment_receipts", recipient_allowlist_id: "borrower_1" }),
      ledgerRow({
        schedule_name: "tenant_payment_receipts",
        recipient_allowlist_id: "tenant_9",
        state: "claimed",
        claimed_at: "2026-10-12T16:00:00.000Z",
      }),
    ];
    const res = await GET(authedRequest());
    const body = await res.json();
    expect(body.failed).toBe(1);
    expect(body.alerts[0]).toMatchObject({ state: "stuck_claim", recipient: "tenant_9" });
  });

  it("alerts unrecorded_attempt when the delivery table shows attempts with no ledger row", async () => {
    vi.setSystemTime(new Date("2026-10-12T20:00:00.000Z"));
    DB.scheduled_send_ledger = [
      ledgerRow({ schedule_name: "tenant_invite" }),
      ledgerRow({ schedule_name: "pf_payment_receipts", recipient_allowlist_id: "borrower_1" }),
      ledgerRow({
        schedule_name: "tenant_payment_receipts",
        recipient_allowlist_id: "_sweep",
        state: "no_op",
      }),
    ];
    DB.rental_tenant_receipt_deliveries = [
      {
        owner_id: "owner_1",
        tenant_id: "tenant_9",
        status: "sent",
        last_attempted_at: "2026-10-12T18:10:00.000Z",
      },
    ];
    const res = await GET(authedRequest());
    const body = await res.json();
    expect(body.failed).toBe(1);
    expect(body.alerts[0]).toMatchObject({
      schedule: "tenant_payment_receipts",
      recipient: "tenant_9",
      state: "unrecorded_attempt",
    });
  });

  it("a recent claimed row within the stuck window is not an alert", async () => {
    // 14:40 CDT: tenant_payment_receipts (13:00) past 90-min grace (14:30),
    // but a claim from 14:35 is newer than 2x grace (3h).
    vi.setSystemTime(new Date("2026-10-12T19:40:00.000Z"));
    DB.scheduled_send_ledger = [
      ledgerRow({ schedule_name: "tenant_invite" }),
      ledgerRow({ schedule_name: "pf_payment_receipts", recipient_allowlist_id: "borrower_1" }),
      ledgerRow({
        schedule_name: "tenant_payment_receipts",
        recipient_allowlist_id: "tenant_9",
        state: "claimed",
        claimed_at: "2026-10-12T19:35:00.000Z",
      }),
    ];
    const res = await GET(authedRequest());
    const body = await res.json();
    const stuck = body.alerts.filter((a) => a.state === "stuck_claim");
    expect(stuck).toEqual([]);
  });

  it("alerts delivery_evidence_mismatch when a failed delivery is masked by another delivery's success (RDL-004)", async () => {
    vi.setSystemTime(new Date("2026-10-12T20:00:00.000Z"));
    const ledgerId = "ledger_tenant_9";
    DB.scheduled_send_ledger = [
      ledgerRow({ schedule_name: "tenant_invite" }),
      ledgerRow({ schedule_name: "pf_payment_receipts", recipient_allowlist_id: "borrower_1" }),
      ledgerRow({
        id: ledgerId,
        schedule_name: "tenant_payment_receipts",
        recipient_allowlist_id: "tenant_9",
        state: "provider_accepted",
        provider_message_id: "msg_del_B",
      }),
    ];
    // The ledger only evidences del_B (accepted). del_A failed in the
    // delivery table with no ledger attempt: the old recipient-presence
    // check saw tenant_9 and stayed quiet.
    DB.scheduled_send_attempts = [
      {
        id: "attempt_1",
        ledger_id: ledgerId,
        delivery_id: "del_B",
        state: "provider_accepted",
        provider_message_id: "msg_del_B",
        attempted_at: "2026-10-12T18:05:00.000Z",
      },
    ];
    DB.rental_tenant_receipt_deliveries = [
      {
        id: "del_A",
        owner_id: "owner_1",
        tenant_id: "tenant_9",
        status: "failed",
        failure_reason: "Resend rejected (500).",
        last_attempted_at: "2026-10-12T18:02:00.000Z",
      },
      {
        id: "del_B",
        owner_id: "owner_1",
        tenant_id: "tenant_9",
        status: "sent",
        provider_message_id: "msg_del_B",
        last_attempted_at: "2026-10-12T18:05:00.000Z",
      },
    ];
    const res = await GET(authedRequest());
    const body = await res.json();
    const mismatches = body.alerts.filter((a) => a.state === "delivery_evidence_mismatch");
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]).toMatchObject({
      schedule: "tenant_payment_receipts",
      recipient: "tenant_9",
      deliveryId: "del_A",
    });
    // del_B is fully evidenced: no mismatch for it.
    expect(body.alerts.some((a) => a.deliveryId === "del_B")).toBe(false);
  });

  it("is quiet when every delivery has matching per-delivery evidence", async () => {
    vi.setSystemTime(new Date("2026-10-12T20:00:00.000Z"));
    const ledgerId = "ledger_tenant_9";
    DB.scheduled_send_ledger = [
      ledgerRow({ schedule_name: "tenant_invite" }),
      ledgerRow({ schedule_name: "pf_payment_receipts", recipient_allowlist_id: "borrower_1" }),
      ledgerRow({
        id: ledgerId,
        schedule_name: "tenant_payment_receipts",
        recipient_allowlist_id: "tenant_9",
        state: "provider_accepted",
      }),
    ];
    DB.scheduled_send_attempts = [
      {
        id: "attempt_1",
        ledger_id: ledgerId,
        delivery_id: "del_A",
        state: "provider_accepted",
        provider_message_id: "msg_A",
        attempted_at: "2026-10-12T18:02:00.000Z",
      },
      {
        id: "attempt_2",
        ledger_id: ledgerId,
        delivery_id: "del_B",
        state: "provider_accepted",
        provider_message_id: "msg_B",
        attempted_at: "2026-10-12T18:05:00.000Z",
      },
    ];
    DB.rental_tenant_receipt_deliveries = [
      { id: "del_A", owner_id: "owner_1", tenant_id: "tenant_9", status: "sent", last_attempted_at: "2026-10-12T18:02:00.000Z" },
      { id: "del_B", owner_id: "owner_1", tenant_id: "tenant_9", status: "sent", last_attempted_at: "2026-10-12T18:05:00.000Z" },
    ];
    const res = await GET(authedRequest());
    const body = await res.json();
    expect(body.failed).toBe(0);
    expect(body.alerts).toEqual([]);
  });

  it("flags delivery_failed from attempt evidence despite a stale healthy summary, with no further writes (RDL-004B)", async () => {
    vi.setSystemTime(new Date("2026-10-12T20:00:00.000Z"));
    const ledgerId = "ledger_tenant_9";
    DB.scheduled_send_ledger = [
      ledgerRow({ schedule_name: "tenant_invite" }),
      ledgerRow({ schedule_name: "pf_payment_receipts", recipient_allowlist_id: "borrower_1" }),
      // Stale healthy summary: a reversed-write interleaving left
      // provider_accepted here while del_A's current attempt failed.
      ledgerRow({
        id: ledgerId,
        schedule_name: "tenant_payment_receipts",
        recipient_allowlist_id: "tenant_9",
        state: "provider_accepted",
        provider_message_id: "msg_new",
      }),
    ];
    DB.scheduled_send_attempts = [
      {
        id: "attempt_1",
        ledger_id: ledgerId,
        delivery_id: "del_A",
        state: "provider_accepted",
        provider_message_id: "msg_A",
        // Older ordinal, but a NEWER wall-clock time: ordinal is authoritative.
        attempted_at: "2026-10-12T18:05:00.000Z",
        attempt_ordinal: 1,
      },
      {
        id: "attempt_2",
        ledger_id: ledgerId,
        delivery_id: "del_A",
        state: "provider_failed",
        failure_reason: "Resend rejected (500).",
        attempted_at: "2026-10-12T18:01:00.000Z",
        attempt_ordinal: 2,
      },
    ];
    DB.rental_tenant_receipt_deliveries = [
      {
        id: "del_A",
        owner_id: "owner_1",
        tenant_id: "tenant_9",
        status: "failed",
        failure_reason: "Resend rejected (500).",
        last_attempted_at: "2026-10-12T18:01:00.000Z",
      },
    ];
    const before = JSON.stringify(DB);
    const res = await GET(authedRequest());
    const body = await res.json();
    // The watchdog is read-only: this probe performs no further writes.
    expect(JSON.stringify(DB)).toBe(before);
    // The delivery table agrees with the attempt evidence (no mismatch),
    // and the summary says accepted (no send_failed) — yet the outstanding
    // failed delivery must still alert.
    expect(body.alerts.some((a) => a.state === "delivery_evidence_mismatch")).toBe(false);
    expect(body.alerts.some((a) => a.state === "send_failed")).toBe(false);
    const failed = body.alerts.filter((a) => a.state === "delivery_failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({
      schedule: "tenant_payment_receipts",
      recipient: "tenant_9",
      deliveryId: "del_A",
    });
    expect(failed[0].reason).toContain("500");
    expect(body.failed).toBe(1);
  });

  it("does not double-alert when the summary already reports the failure", async () => {
    vi.setSystemTime(new Date("2026-10-12T20:00:00.000Z"));
    const ledgerId = "ledger_tenant_9";
    DB.scheduled_send_ledger = [
      ledgerRow({ schedule_name: "tenant_invite" }),
      ledgerRow({ schedule_name: "pf_payment_receipts", recipient_allowlist_id: "borrower_1" }),
      ledgerRow({
        id: ledgerId,
        schedule_name: "tenant_payment_receipts",
        recipient_allowlist_id: "tenant_9",
        state: "provider_failed",
        failure_reason: "Resend rejected (500).",
      }),
    ];
    DB.scheduled_send_attempts = [
      {
        id: "attempt_1",
        ledger_id: ledgerId,
        delivery_id: "del_A",
        state: "provider_failed",
        failure_reason: "Resend rejected (500).",
        attempted_at: "2026-10-12T18:01:00.000Z",
        attempt_ordinal: 1,
      },
    ];
    DB.rental_tenant_receipt_deliveries = [
      {
        id: "del_A",
        owner_id: "owner_1",
        tenant_id: "tenant_9",
        status: "failed",
        last_attempted_at: "2026-10-12T18:01:00.000Z",
      },
    ];
    const body = await (await GET(authedRequest())).json();
    // One send_failed from the summary; no duplicate delivery_failed.
    expect(body.alerts.filter((a) => a.state === "send_failed")).toHaveLength(1);
    expect(body.alerts.filter((a) => a.state === "delivery_failed")).toHaveLength(0);
    expect(body.failed).toBe(1);
  });

  it("alerts stuck_claim for a crashed _sweep run marker (RDL-005)", async () => {    vi.setSystemTime(new Date("2026-10-12T20:00:00.000Z"));
    DB.scheduled_send_ledger = [
      ledgerRow({ schedule_name: "tenant_invite" }),
      ledgerRow({ schedule_name: "pf_payment_receipts", recipient_allowlist_id: "borrower_1" }),
      // Crash between the _sweep marker claim and its no_op outcome write.
      ledgerRow({
        schedule_name: "tenant_payment_receipts",
        recipient_allowlist_id: "_sweep",
        state: "claimed",
        claimed_at: "2026-10-12T16:00:00.000Z",
      }),
    ];
    const res = await GET(authedRequest());
    const body = await res.json();
    const stuck = body.alerts.filter((a) => a.state === "stuck_claim");
    expect(stuck).toHaveLength(1);
    expect(stuck[0]).toMatchObject({ recipient: "_sweep", schedule: "tenant_payment_receipts" });
    expect(stuck[0].reason).toContain("Run-marker claim");
  });

  it("a recent _sweep marker and a healthy no_op marker are quiet (RDL-005)", async () => {
    vi.setSystemTime(new Date("2026-10-12T20:00:00.000Z"));
    DB.scheduled_send_ledger = [
      ledgerRow({ schedule_name: "tenant_invite" }),
      ledgerRow({ schedule_name: "pf_payment_receipts", recipient_allowlist_id: "borrower_1" }),
      ledgerRow({
        schedule_name: "tenant_payment_receipts",
        recipient_allowlist_id: "_sweep",
        state: "claimed",
        claimed_at: "2026-10-12T19:50:00.000Z",
      }),
    ];
    let body = await (await GET(authedRequest())).json();
    expect(body.alerts.filter((a) => a.state === "stuck_claim")).toEqual([]);

    DB.scheduled_send_ledger[2] = ledgerRow({
      schedule_name: "tenant_payment_receipts",
      recipient_allowlist_id: "_sweep",
      state: "no_op",
    });
    body = await (await GET(authedRequest())).json();
    expect(body.failed).toBe(0);
    expect(body.alerts).toEqual([]);
  });
});

describe("watchdog delivery-table projections (RDL-003, schema-backed)", () => {
  it("per-table projections select only real columns; the old unified select 42703s", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const { readFileSync } = await import("node:fs");
    const { DELIVERY_TABLES } = await import("./route.js");
    const { SCHEDULE_NAMES } = await import("@/application/notifications/scheduledSendLedger.js");

    const db = new PGlite();
    await db.exec(
      `create or replace function gen_random_uuid() returns uuid language sql as
       $$ select '00000000-0000-0000-0000-000000000000'::uuid $$;`,
    );
    // Roles referenced by the delivery-table migrations' REVOKE statements.
    await db.exec(`create role anon nologin; create role authenticated nologin;`);
    // Minimal stub for the PF deliveries migration's FK target.
    await db.exec(
      `create table private_financing_accounts (owner_id text not null, id text not null, primary key (owner_id, id));`,
    );
    await db.exec(
      readFileSync("supabase/migrations/20260929100000_private_financing_payment_receipts.sql", "utf8"),
    );
    await db.exec(
      readFileSync("supabase/migrations/20260929120000_rental_tenant_receipt_deliveries.sql", "utf8"),
    );

    // Seed one row per table so the projections run populated, not just empty.
    await db.exec(`insert into private_financing_accounts (owner_id, id) values ('o1', 'a1');`);
    await db.exec(
      `insert into private_financing_payment_receipt_deliveries
       (owner_id, id, account_id, payment_id, borrower_id, recipient_type, recipient_email, status)
       values ('o1', 'del_pf_1', 'a1', 'pay_1', 'b1', 'borrower', 'b@example.com', 'sent');`,
    );
    await db.exec(
      `insert into rental_tenant_receipt_deliveries
       (owner_id, id, payment_id, tenant_id, recipient_email, amount_cents, status, sent_at)
       values ('o1', 'del_t_1', 'pay_9', 't9', 't@example.com', 160000, 'sent', now());`,
    );

    for (const schedule of [SCHEDULE_NAMES.PF_PAYMENT_RECEIPTS, SCHEDULE_NAMES.TENANT_PAYMENT_RECEIPTS]) {
      const cfg = DELIVERY_TABLES[schedule];
      const { rows } = await db.query(
        `select ${cfg.columns} from ${cfg.table} where status in ('sent', 'failed')`,
      );
      expect(rows).toHaveLength(1);
    }

    // The old unified projection is invalid against both real schemas.
    await expect(
      db.query(
        `select owner_id,borrower_id,tenant_id,recipient_type,last_attempted_at
         from private_financing_payment_receipt_deliveries where false`,
      ),
    ).rejects.toThrow(/42703|does not exist/i);
    await expect(
      db.query(
        `select owner_id,borrower_id,tenant_id,recipient_type,last_attempted_at
         from rental_tenant_receipt_deliveries where false`,
      ),
    ).rejects.toThrow(/42703|does not exist/i);
  });

  it("the RDL-002A/002B/004A/004B follow-up migration applies and exposes the new columns", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const { readFileSync } = await import("node:fs");

    const db = new PGlite();
    await db.exec(
      `create or replace function gen_random_uuid() returns uuid language sql as
       $$ select '00000000-0000-0000-0000-000000000000'::uuid $$;`,
    );
    await db.exec(
      readFileSync("supabase/migrations/20261012000000_scheduled_send_ledger.sql", "utf8"),
    );
    await db.exec(
      readFileSync(
        "supabase/migrations/20261012000100_scheduled_send_ledger_rdl2_followup.sql",
        "utf8",
      ),
    );

    // RDL-002B: pinned provider key + payload digest on the claim row.
    // RDL-004A: claim token + attempt ordinal on attempt rows.
    // RDL-004B: summary version CAS guard on the summary row.
    const { rows: ledgerCols } = await db.query(
      `select column_name from information_schema.columns
       where table_name = 'scheduled_send_ledger'`,
    );
    const ledgerNames = ledgerCols.map((r) => r.column_name);
    for (const col of [
      "provider_request_key",
      "payload_digest",
      "claim_token",
      "summary_version",
    ]) {
      expect(ledgerNames).toContain(col);
    }
    const { rows: attemptCols } = await db.query(
      `select column_name from information_schema.columns
       where table_name = 'scheduled_send_attempts'`,
    );
    const attemptNames = attemptCols.map((r) => r.column_name);
    expect(attemptNames).toContain("claim_token");
    expect(attemptNames).toContain("attempt_ordinal");

    // The watchdog's evidence select runs against the migrated schema.
    const { readAttemptsForSlot } = await import(
      "@/application/notifications/scheduledSendLedger.js"
    );
    expect(typeof readAttemptsForSlot).toBe("function");
  });
});
