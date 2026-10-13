import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route.js";

const mocks = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("@/infrastructure/notifications/ResendRentalEmailProvider", () => ({
  createResendRentalEmailProvider: () => ({ send: mocks.send }),
}));

let DB;
let upsertCalls;
let updateCalls;
let ledgerCalls;
let eventLog;

function ledgerChainable() {
  if (!DB.scheduled_send_ledger) DB.scheduled_send_ledger = [];
  const rows = DB.scheduled_send_ledger;
  const keyOf = (r) => `${r.schedule_name}|${r.scheduled_slot}|${r.recipient_allowlist_id}`;
  const matches = (filters) => (r) => filters.every(([c, v]) => r[c] === v);
  const obj = {
    select() {
      return obj;
    },
    eq(col, val) {
      obj._filters.push([col, val]);
      return obj;
    },
    order() {
      return obj;
    },
    async maybeSingle() {
      return { data: rows.find(matches(obj._filters)) ?? null, error: null };
    },
    upsert(row, options) {
      ledgerCalls.push({ op: "upsert", row, options });
      const exists = rows.some((r) => keyOf(r) === keyOf(row));
      return {
        select: () => ({
          then: (resolve) => {
            if (exists && options?.ignoreDuplicates) return resolve({ data: [], error: null });
            const inserted = { id: `ledger_${rows.length + 1}`, ...row };
            rows.push(inserted);
            resolve({ data: [inserted], error: null });
          },
        }),
      };
    },
    update(patch) {
      ledgerCalls.push({ op: "update", patch });
      const updFilters = [];
      const upd = {
        eq(col, val) {
          updFilters.push([col, val]);
          return upd;
        },
        select: () => ({
          then: (resolve) => {
            const idx = rows.findIndex(matches(updFilters));
            if (idx === -1) return resolve({ data: [], error: null });
            rows[idx] = { ...rows[idx], ...patch };
            resolve({ data: [rows[idx]], error: null });
          },
        }),
      };
      return upd;
    },
    then(resolve) {
      resolve({ data: rows.filter(matches(obj._filters)), error: null });
    },
  };
  obj._filters = [];
  return obj;
}

function chainable(table) {
  if (table === "scheduled_send_ledger") return ledgerChainable();
  const rows = DB[table] ?? [];
  const obj = {
    select: () => obj,
    eq: () => obj,
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    upsert: (row, options) => {
      upsertCalls.push({ table, row, options });
      eventLog.push("billing-enabled");
      return obj;
    },
    update: (patch) => {
      updateCalls.push({ table, patch });
      eventLog.push("invited_at-stamped");
      return obj;
    },
    then: (resolve) => resolve({ data: [], error: null }),
  };
  return obj;
}

vi.mock("@/lib/supabase/createRentalWebhookClient", () => ({
  createRentalWebhookClient: () => ({ from: (table) => chainable(table) }),
}));

const ERIC_TENANT = {
  id: "rental_tenant_a5822588-f661-4346-b6cc-f914aa22ffea",
  display_name: "Eric Carrillo",
  email: "eric.carillo5@yahoo.com",
  status: "invited",
  auth_user_id: null,
  invited_at: "2026-09-01T00:33:55.808Z",
};

function seedDefaultDb() {
  DB = {
    rental_tenants: [{ ...ERIC_TENANT }],
    rental_lease_tenants: [{ lease_id: "rental_lease_9530cad2-7457-4bca-8d7c-974cc5d6c1e3" }],
    rental_leases: [{ unit_id: "unit_paula", start_date: "2026-08-29", monthly_rent_cents: 160000 }],
    rental_units: [{ label: "308 PAULA" }],
  };
}

function authedRequest(path = "/api/rental/cron/tenant-invite") {
  return new Request(`https://example.com${path}`, {
    headers: { authorization: "Bearer test-cron-secret" },
  });
}

beforeEach(() => {
  process.env.CRON_SECRET = "test-cron-secret";
  delete process.env.RENTAL_EMAIL_SENDER;
  process.env.NEXT_PUBLIC_SITE_URL = "https://marketplace409.vercel.app";
  mocks.send.mockReset().mockImplementation(async () => {
    eventLog.push("invite-sent");
    return { id: "resend_msg_1" };
  });
  upsertCalls = [];
  updateCalls = [];
  ledgerCalls = [];
  eventLog = [];
  seedDefaultDb();
});

afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("tenant-invite cron route", () => {
  it("returns 401 without the cron secret", async () => {
    const res = await GET(new Request("https://example.com/api/rental/cron/tenant-invite"));
    expect(res.status).toBe(401);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("dry run plans the send without writing or emailing", async () => {
    const res = await GET(authedRequest("/api/rental/cron/tenant-invite?dryRun=true"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.action).toBe("would_send");
    expect(body.recipient).toBe("eric.carillo5@yahoo.com");
    expect(body.leaseSummary).toEqual({ unitLabel: "308 PAULA", monthlyRentCents: 160000, startDate: "2026-08-29" });
    expect(body.subject).toContain("FORGE");
    expect(mocks.send).not.toHaveBeenCalled();
    expect(upsertCalls).toEqual([]);
    expect(updateCalls).toEqual([]);
  });

  it("live run enables billing, sends the invite, and stamps invited_at", async () => {
    const res = await GET(authedRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true, action: "sent", recipient: "eric.carillo5@yahoo.com", billingEnabled: true });

    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0].table).toBe("rental_billing_settings");
    expect(upsertCalls[0].row).toMatchObject({ owner_id: "e1b22131-9100-4a79-bbe2-b82d43af922e", billing_enabled: true });
    expect(upsertCalls[0].options).toEqual({ onConflict: "owner_id" });

    expect(mocks.send).toHaveBeenCalledTimes(1);
    const payload = mocks.send.mock.calls[0][0];
    expect(payload.recipient).toBe("eric.carillo5@yahoo.com");
    expect(payload.senderEmail).toBe("rentals@mail.409marketplace.online");
    expect(payload.id).toMatch(/^tenant-invite-rental_tenant_a5822588-f661-4346-b6cc-f914aa22ffea-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}$/);

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].table).toBe("rental_tenants");
    expect(updateCalls[0].patch.invited_at).toBeTruthy();

    // Failure-ordering regression: billing must flip on only after the invite
    // is sent and recorded, so a send failure never leaves billing on.
    expect(eventLog).toEqual(["invite-sent", "invited_at-stamped", "billing-enabled"]);
  });

  it("no-ops when the tenant already claimed portal access (billing still ensured)", async () => {
    DB.rental_tenants[0].auth_user_id = "75f6fe34-0000-4000-8000-000000000000";
    const res = await GET(authedRequest());
    const body = await res.json();
    expect(body.action).toBe("already_claimed");
    expect(mocks.send).not.toHaveBeenCalled();
    expect(upsertCalls).toHaveLength(1);
    expect(updateCalls).toEqual([]);
  });

  it("no-ops when an invite was already recorded after the go-live cutoff", async () => {
    DB.rental_tenants[0].invited_at = "2026-09-26T15:05:00.000Z";
    const res = await GET(authedRequest());
    const body = await res.json();
    expect(body.action).toBe("already_sent");
    expect(mocks.send).not.toHaveBeenCalled();
    expect(updateCalls).toEqual([]);
  });

  it("returns 404 when the tenant record is missing", async () => {
    DB.rental_tenants = [];
    const res = await GET(authedRequest());
    expect(res.status).toBe(404);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("returns 422 when the tenant has no valid email", async () => {
    DB.rental_tenants[0].email = "not-an-email";
    const res = await GET(authedRequest());
    expect(res.status).toBe(422);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(upsertCalls).toEqual([]);
  });

  it("live run writes a claimed-then-provider_accepted ledger row before/after the send", async () => {
    const res = await GET(authedRequest());
    expect(res.status).toBe(200);
    const rows = DB.scheduled_send_ledger;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      schedule_name: "tenant_invite",
      recipient_allowlist_id: "rental_tenant_a5822588-f661-4346-b6cc-f914aa22ffea",
      state: "provider_accepted",
      provider_message_id: "resend_msg_1",
    });
    expect(rows[0].scheduled_slot).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Claim happened before the send: the upsert op precedes the send call.
    const ops = ledgerCalls.map((c) => c.op);
    expect(ops[0]).toBe("upsert");
    expect(ops).toContain("update");
  });

  it("provider failure records provider_failed in the ledger and returns 500", async () => {
    mocks.send.mockRejectedValueOnce(new Error("Resend rejected email delivery (500)."));
    const res = await GET(authedRequest());
    expect(res.status).toBe(500);
    const rows = DB.scheduled_send_ledger;
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("provider_failed");
    expect(rows[0].failure_reason).toContain("500");
  });

  it("refire with a terminal ledger row reconciles instead of re-sending", async () => {
    const { chicagoSlotFor } = await import("@/application/notifications/scheduledSendLedger.js");
    DB.scheduled_send_ledger = [
      {
        id: "ledger_1",
        schedule_name: "tenant_invite",
        scheduled_slot: chicagoSlotFor(),
        recipient_allowlist_id: "rental_tenant_a5822588-f661-4346-b6cc-f914aa22ffea",
        run_id: "earlier_run",
        state: "provider_accepted",
        provider_message_id: "resend_msg_0",
      },
    ];
    const res = await GET(authedRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true, action: "already_sent", reconciled: true });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(DB.scheduled_send_ledger).toHaveLength(1);
  });

  it("already_claimed records a no_op ledger row", async () => {
    DB.rental_tenants[0].auth_user_id = "75f6fe34-0000-4000-8000-000000000000";
    const res = await GET(authedRequest());
    expect((await res.json()).action).toBe("already_claimed");
    const rows = DB.scheduled_send_ledger;
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("no_op");
  });

  it("refire with a provider_failed ledger row retries under the stable identity", async () => {
    const { chicagoSlotFor } = await import("@/application/notifications/scheduledSendLedger.js");
    DB.scheduled_send_ledger = [
      {
        id: "ledger_1",
        schedule_name: "tenant_invite",
        scheduled_slot: chicagoSlotFor(),
        recipient_allowlist_id: "rental_tenant_a5822588-f661-4346-b6cc-f914aa22ffea",
        run_id: "earlier_run",
        state: "provider_failed",
        failure_reason: "Resend rejected email delivery (500).",
        send_attempts: 1,
        claimed_at: "2026-10-12T15:00:00.000Z",
      },
    ];
    const res = await GET(authedRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    // RDL-001: a failed row is retried, NOT reconciled as sent.
    expect(body).toMatchObject({ success: true, action: "sent", billingEnabled: true });
    expect(body.reconciled).toBeUndefined();
    expect(mocks.send).toHaveBeenCalledTimes(1);
    // Stable provider idempotency: same key the failed run used.
    const payload = mocks.send.mock.calls[0][0];
    expect(payload.id).toMatch(/^tenant-invite-rental_tenant_a5822588-f661-4346-b6cc-f914aa22ffea-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}$/);
    const row = DB.scheduled_send_ledger[0];
    expect(row.state).toBe("provider_accepted");
    expect(row.send_attempts).toBe(2);
    expect(row.run_id).not.toBe("earlier_run");
    // Billing order preserved: invite sent and stamped before billing.
    expect(eventLog).toEqual(["invite-sent", "invited_at-stamped", "billing-enabled"]);
  });

  it("refire with exhausted send attempts fails closed without billing or send", async () => {
    const { chicagoSlotFor } = await import("@/application/notifications/scheduledSendLedger.js");
    DB.scheduled_send_ledger = [
      {
        id: "ledger_1",
        schedule_name: "tenant_invite",
        scheduled_slot: chicagoSlotFor(),
        recipient_allowlist_id: "rental_tenant_a5822588-f661-4346-b6cc-f914aa22ffea",
        run_id: "earlier_run",
        state: "provider_failed",
        failure_reason: "Resend rejected email delivery (500).",
        send_attempts: 3,
        claimed_at: "2026-10-12T15:00:00.000Z",
      },
    ];
    const res = await GET(authedRequest());
    const body = await res.json();
    // RDL-001: explicit blocked failure; billing stays off.
    expect(res.status).toBe(500);
    expect(body).toMatchObject({ success: false, action: "blocked_provider_failed", billingEnabled: false });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(upsertCalls).toEqual([]);
  });

  it("refire with provider_accepted but a lost invited_at stamp reconciles and stamps", async () => {
    const { chicagoSlotFor } = await import("@/application/notifications/scheduledSendLedger.js");
    DB.scheduled_send_ledger = [
      {
        id: "ledger_1",
        schedule_name: "tenant_invite",
        scheduled_slot: chicagoSlotFor(),
        recipient_allowlist_id: "rental_tenant_a5822588-f661-4346-b6cc-f914aa22ffea",
        run_id: "earlier_run",
        state: "provider_accepted",
        provider_message_id: "resend_msg_0",
        send_attempts: 1,
        claimed_at: "2026-10-12T15:00:00.000Z",
      },
    ];
    // Provider accepted, but the local stamp never landed (pre-cutoff).
    DB.rental_tenants[0].invited_at = "2026-09-01T00:33:55.808Z";
    const res = await GET(authedRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true, action: "already_sent", reconciled: true, billingEnabled: true });
    expect(mocks.send).not.toHaveBeenCalled();
    // The lost stamp is repaired idempotently; billing still goes last.
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].table).toBe("rental_tenants");
    expect(updateCalls[0].patch.invited_at).toBeTruthy();
    expect(eventLog).toEqual(["invited_at-stamped", "billing-enabled"]);
  });

  it("a fresh claim held by another run defers with 409 and never sends", async () => {
    const { chicagoSlotFor } = await import("@/application/notifications/scheduledSendLedger.js");
    DB.scheduled_send_ledger = [
      {
        id: "ledger_1",
        schedule_name: "tenant_invite",
        scheduled_slot: chicagoSlotFor(),
        recipient_allowlist_id: "rental_tenant_a5822588-f661-4346-b6cc-f914aa22ffea",
        run_id: "other_live_run",
        state: "claimed",
        send_attempts: 1,
        claimed_at: new Date().toISOString(),
      },
    ];
    const res = await GET(authedRequest());
    const body = await res.json();
    // RDL-002: the loser defers; it must not send on a claim it did not win.
    expect(res.status).toBe(409);
    expect(body).toMatchObject({ success: false, action: "deferred_claim_held", billingEnabled: false });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(upsertCalls).toEqual([]);
    expect(DB.scheduled_send_ledger[0].run_id).toBe("other_live_run");
  });

  it("a stale claimed row is taken over and sent", async () => {
    const { chicagoSlotFor } = await import("@/application/notifications/scheduledSendLedger.js");
    DB.scheduled_send_ledger = [
      {
        id: "ledger_1",
        schedule_name: "tenant_invite",
        scheduled_slot: chicagoSlotFor(),
        recipient_allowlist_id: "rental_tenant_a5822588-f661-4346-b6cc-f914aa22ffea",
        run_id: "crashed_run",
        state: "claimed",
        send_attempts: 1,
        claimed_at: new Date(Date.now() - 2 * 60 * 60000).toISOString(),
      },
    ];
    const res = await GET(authedRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true, action: "sent", billingEnabled: true });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    const row = DB.scheduled_send_ledger[0];
    expect(row.run_id).not.toBe("crashed_run");
    expect(row.state).toBe("provider_accepted");
  });

  it("dry run writes no ledger rows", async () => {
    await GET(authedRequest("/api/rental/cron/tenant-invite?dryRun=true"));
    expect(DB.scheduled_send_ledger ?? []).toEqual([]);
  });
});
