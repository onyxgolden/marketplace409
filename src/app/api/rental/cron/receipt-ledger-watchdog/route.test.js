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
  DB = { scheduled_send_ledger: [], private_financing_payment_receipt_deliveries: [], rental_tenant_receipt_deliveries: [] };
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
});
