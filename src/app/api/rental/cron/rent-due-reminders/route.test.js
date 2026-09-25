import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/infrastructure/notifications/ResendRentalEmailProvider", () => ({
  createResendRentalEmailProvider: () => ({ send: mocks.send }),
}));

// Programmable chainable: plain selects serve ROWS[table]; the delivery-table
// upsert serves UPSERT_RESULT (won claim -> one row, lost race -> no rows);
// maybeSingle serves MAYBE_SINGLE[table] when set, else EXISTING_DELIVERY,
// else the first row of ROWS[table].
let ROWS;
let MAYBE_SINGLE;
let UPSERT_RESULT;
let EXISTING_DELIVERY;
let PENDING_RESULT = null;
function chainable(table) {
  const obj = {
    select: () => obj,
    eq: () => obj,
    gte: () => obj,
    lte: () => obj,
    lt: () => obj,
    in: () => obj,
    maybeSingle: async () => ({ data: MAYBE_SINGLE?.[table] ?? EXISTING_DELIVERY ?? (ROWS[table]?.[0] ?? null), error: null }),
    upsert: (row, options) => {
      mocks.upsert(table, row, options);
      PENDING_RESULT = UPSERT_RESULT ?? { data: [row], error: null };
      return obj;
    },
    update: (patch) => {
      mocks.update(table, patch);
      PENDING_RESULT = { data: [{ id: "row_x" }], error: null };
      return obj;
    },
    then: (resolve) => {
      const result = PENDING_RESULT ?? { data: ROWS[table] ?? [], error: null };
      PENDING_RESULT = null;
      return resolve(result);
    },
  };
  return obj;
}

vi.mock("@/lib/supabase/createRentalWebhookClient", () => ({
  createRentalWebhookClient: () => ({ from: (table) => chainable(table) }),
}));

const { GET } = await import("./route.js");

function request(url, headers = {}) {
  return { url, headers: { get: (name) => headers[name.toLowerCase()] ?? null } };
}

const AUTH = { authorization: "Bearer test-secret" };

function seedDueTodayFixture() {
  const today = new Date().toISOString().slice(0, 10);
  ROWS = {
    rent_charges: [{
      owner_id: "owner_1", id: "charge_1", lease_id: "lease_1", schedule_id: "sched_1",
      due_date: today, amount_cents: 160000, paid_amount_cents: 0, status: "due",
    }],
    rental_leases: [{ id: "lease_1", status: "active" }],
    rent_schedules: [{ id: "sched_1", collection_mode: "forge" }],
    rental_lease_tenants: [{
      lease_id: "lease_1", tenant_id: "tenant_1",
      rental_tenants: { id: "tenant_1", display_name: "Eric Carrillo", email: "Eric@Example.com", status: "invited" },
    }],
    rental_rent_reminder_deliveries: [],
  };
  UPSERT_RESULT = undefined;
  EXISTING_DELIVERY = undefined;
  MAYBE_SINGLE = undefined;
}

const REAL_ENV = { ...process.env };
beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
  mocks.send.mockReset();
  mocks.upsert.mockReset();
  mocks.update.mockReset();
  ROWS = {};
});
afterEach(() => {
  process.env = { ...REAL_ENV };
});

describe("GET /api/rental/cron/rent-due-reminders", () => {
  it("rejects a call with no secret", async () => {
    const response = await GET(request("https://x.test/api/rental/cron/rent-due-reminders"));
    expect(response.status).toBe(401);
  });

  it("rejects a call with the wrong secret", async () => {
    const response = await GET(request("https://x.test/api/rental/cron/rent-due-reminders", { authorization: "Bearer wrong" }));
    expect(response.status).toBe(401);
  });

  it("rejects every call when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const response = await GET(request("https://x.test/api/rental/cron/rent-due-reminders", AUTH));
    expect(response.status).toBe(401);
  });

  it("dry run computes the plan but claims nothing and sends nothing", async () => {
    seedDueTodayFixture();
    const response = await GET(request("https://x.test/api/rental/cron/rent-due-reminders?dryRun=true", AUTH));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.dryRun).toBe(true);
    expect(body.wouldSend).toBe(1);
    expect(body.sent).toBe(0);
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("claims the delivery row BEFORE calling the email provider, exactly once", async () => {
    seedDueTodayFixture();
    const events = [];
    mocks.upsert.mockImplementation(() => { events.push("claim"); });
    mocks.send.mockImplementation(async () => { events.push("send"); return { messageId: "msg_1" }; });
    const response = await GET(request("https://x.test/api/rental/cron/rent-due-reminders", AUTH));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.sent).toBe(1);
    expect(events).toEqual(["claim", "send"]);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send.mock.calls[0][0].recipient).toBe("eric@example.com");
    const [table, row] = mocks.upsert.mock.calls[0];
    expect(table).toBe("rental_rent_reminder_deliveries");
    expect(row.status).toBe("sending");
    const [, patch] = mocks.update.mock.calls[0];
    expect(patch.status).toBe("sent");
    expect(patch.provider_message_id).toBe("msg_1");
  });

  it("does not call the provider when another invocation already claimed and sent", async () => {
    seedDueTodayFixture();
    UPSERT_RESULT = { data: [], error: null }; // lost the race: no row inserted
    EXISTING_DELIVERY = { id: "row_x", status: "sent", attempt_count: 1, last_attempted_at: new Date().toISOString() };
    const response = await GET(request("https://x.test/api/rental/cron/rent-due-reminders", AUTH));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(body.alreadySent).toBe(1);
    expect(body.sent).toBe(0);
  });

  it("records a failed delivery (not a crash) when the provider rejects", async () => {
    seedDueTodayFixture();
    mocks.send.mockRejectedValue(new Error("Resend rejected email delivery (500)."));
    const response = await GET(request("https://x.test/api/rental/cron/rent-due-reminders", AUTH));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.sent).toBe(0);
    expect(body.failed).toBe(1);
    const [, patch] = mocks.update.mock.calls[0];
    expect(patch.status).toBe("failed");
  });

  it("marks the delivery superseded (never sent) when the charge was paid after planning", async () => {
    seedDueTodayFixture();
    MAYBE_SINGLE = { rent_charges: { status: "paid", amount_cents: 160000, paid_amount_cents: 160000 } };
    const response = await GET(request("https://x.test/api/rental/cron/rent-due-reminders", AUTH));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.sent).toBe(0);
    expect(body.superseded).toBe(1);
    expect(mocks.send).not.toHaveBeenCalled();
    const [, patch] = mocks.update.mock.calls[0];
    expect(patch.status).toBe("superseded");
  });

  it("refreshes the remaining amount when a partial payment lands after planning", async () => {
    seedDueTodayFixture();
    MAYBE_SINGLE = { rent_charges: { status: "partially_paid", amount_cents: 160000, paid_amount_cents: 60000 } };
    mocks.send.mockResolvedValue({ messageId: "msg_3" });
    const response = await GET(request("https://x.test/api/rental/cron/rent-due-reminders", AUTH));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.sent).toBe(1);
    expect(mocks.send.mock.calls[0][0].bodyText).toContain("$1000.00");
  });

  it("reclaims a failed delivery for retry under the attempt cap", async () => {
    seedDueTodayFixture();
    UPSERT_RESULT = { data: [], error: null }; // lost the race
    MAYBE_SINGLE = {
      rental_rent_reminder_deliveries: { id: "row_x", status: "failed", attempt_count: 1, last_attempted_at: new Date().toISOString() },
      rent_charges: { status: "due", amount_cents: 160000, paid_amount_cents: 0 },
    };
    mocks.send.mockResolvedValue({ messageId: "msg_4" });
    const response = await GET(request("https://x.test/api/rental/cron/rent-due-reminders", AUTH));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.sent).toBe(1);
    const [, reclaimPatch] = mocks.update.mock.calls[0];
    expect(reclaimPatch.status).toBe("sending");
    expect(reclaimPatch.attempt_count).toBe(2);
    expect(reclaimPatch.failure_reason).toBeNull();
  });

  it("does not retry a failed delivery past the attempt cap", async () => {
    seedDueTodayFixture();
    UPSERT_RESULT = { data: [], error: null }; // lost the race
    EXISTING_DELIVERY = { id: "row_x", status: "failed", attempt_count: 5, last_attempted_at: new Date().toISOString() };
    const response = await GET(request("https://x.test/api/rental/cron/rent-due-reminders", AUTH));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.sent).toBe(0);
    expect(body.skipped).toBe(1);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("excludes charges with no FORGE schedule", async () => {
    seedDueTodayFixture();
    ROWS.rent_charges[0].schedule_id = null;
    const response = await GET(request("https://x.test/api/rental/cron/rent-due-reminders?dryRun=true", AUTH));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.wouldSend).toBe(0);
  });

  it("reminds on a scheduled charge (seven days before a charge the owner created early)", async () => {
    seedDueTodayFixture();
    ROWS.rent_charges[0].status = "scheduled";
    const response = await GET(request("https://x.test/api/rental/cron/rent-due-reminders?dryRun=true", AUTH));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.wouldSend).toBe(1);
  });

  function seedForgeScheduleForEnsure(scheduleId, dueDay) {
    const today = new Date().toISOString().slice(0, 10);
    ROWS.rental_billing_settings = [{ owner_id: "owner_1" }];
    ROWS.rent_schedules = [{
      owner_id: "owner_1", id: scheduleId, lease_id: "lease_1", status: "active",
      amount_cents: 160000, currency_code: "USD", due_day: dueDay,
      effective_start_date: "2026-08-29", effective_end_date: null,
      created_at: "2026-09-25T00:00:00Z", updated_at: "2026-09-25T00:00:00Z",
      collection_mode: "forge", collection_provider: null, forge_cutover_date: "2026-09-25",
    }];
    return today;
  }

  it("plans reminders for charges the dry run would generate, without writing them", async () => {
    seedDueTodayFixture();
    seedForgeScheduleForEnsure("sched_2", Number(new Date().toISOString().slice(8, 10))); // due today
    const response = await GET(request("https://x.test/api/rental/cron/rent-due-reminders?dryRun=true", AUTH));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.chargesEnsured).toBe(1);
    expect(mocks.upsert.mock.calls.filter(([table]) => table === "rent_charges")).toHaveLength(0);
    // The hypothetical charge's due-day reminder: the dry run plans exactly what
    // the live run would plan. (charge_1 is filtered by the loader because the
    // seed replaces rent_schedules with only sched_2 — a mock artifact.)
    expect(body.wouldSend).toBe(1);
    expect(body.sent).toBe(0);
  });

  it("does not double-plan a dry-run hypothetical when the charge row already exists", async () => {
    seedDueTodayFixture();
    const today = seedForgeScheduleForEnsure("sched_2", Number(new Date().toISOString().slice(8, 10))); // due today
    const period = today.slice(0, 7);
    ROWS.rent_charges.push({
      owner_id: "owner_1", id: `rent_charge_sched_2_${period.replace("-", "")}`, lease_id: "lease_1",
      schedule_id: "sched_2", due_date: today, amount_cents: 160000, paid_amount_cents: 0,
      status: "due", source_key: `rent:sched_2:${period}`,
    });
    const response = await GET(request("https://x.test/api/rental/cron/rent-due-reminders?dryRun=true", AUTH));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.chargesEnsured).toBe(1);
    expect(mocks.upsert.mock.calls.filter(([table]) => table === "rent_charges")).toHaveLength(0);
    // The existing sched_2 charge's due-day reminder; no hypothetical duplicate.
    // (charge_1 is filtered by the loader — its schedule isn't in the seed.)
    expect(body.wouldSend).toBe(1);
  });

  it("ensures the next charge for a FORGE schedule whose due date is in the window", async () => {
    seedDueTodayFixture();
    mocks.send.mockResolvedValue({ messageId: "msg_ensure" });
    const today = seedForgeScheduleForEnsure("sched_2", Number(new Date().toISOString().slice(8, 10))); // due today
    const response = await GET(request("https://x.test/api/rental/cron/rent-due-reminders", AUTH));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.chargesEnsured).toBe(1);
    const chargeUpserts = mocks.upsert.mock.calls.filter(([table]) => table === "rent_charges");
    expect(chargeUpserts).toHaveLength(1);
    expect(chargeUpserts[0][1].source_key).toBe(`rent:sched_2:${today.slice(0, 7)}`);
  });

  it("does not ensure charges for schedules whose next due date is outside the window", async () => {
    seedDueTodayFixture();
    const probe = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    probe.setUTCDate(probe.getUTCDate() + 10); // due in 10 days: past the 7-day window
    seedForgeScheduleForEnsure("sched_3", probe.getUTCDate());
    const response = await GET(request("https://x.test/api/rental/cron/rent-due-reminders?dryRun=true", AUTH));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.chargesEnsured).toBe(0);
    expect(mocks.upsert.mock.calls.filter(([table]) => table === "rent_charges")).toHaveLength(0);
  });

  it("does not reclaim a stale sending delivery past the attempt cap", async () => {
    seedDueTodayFixture();
    UPSERT_RESULT = { data: [], error: null }; // lost the race
    const stale = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago
    EXISTING_DELIVERY = { id: "row_x", status: "sending", attempt_count: 5, last_attempted_at: stale };
    const response = await GET(request("https://x.test/api/rental/cron/rent-due-reminders", AUTH));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.sent).toBe(0);
    expect(body.skipped).toBe(1);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("reclaims a stale sending delivery under the attempt cap", async () => {
    seedDueTodayFixture();
    UPSERT_RESULT = { data: [], error: null }; // lost the race
    const stale = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago
    MAYBE_SINGLE = {
      rental_rent_reminder_deliveries: { id: "row_x", status: "sending", attempt_count: 2, last_attempted_at: stale },
      rent_charges: { status: "due", amount_cents: 160000, paid_amount_cents: 0 },
    };
    mocks.send.mockResolvedValue({ messageId: "msg_5" });
    const response = await GET(request("https://x.test/api/rental/cron/rent-due-reminders", AUTH));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.sent).toBe(1);
    const [, reclaimPatch] = mocks.update.mock.calls[0];
    expect(reclaimPatch.status).toBe("sending");
    expect(reclaimPatch.attempt_count).toBe(3);
  });
});
