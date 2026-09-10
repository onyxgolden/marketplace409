import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("@/infrastructure/notifications/ResendRentalEmailProvider", () => ({
  createResendRentalEmailProvider: () => ({ send: mocks.send }),
}));

// A minimal, generic chainable query-builder mock: every table's rows are served from ROWS[table],
// select/eq/in are no-ops that return the same chainable object (so any .eq().eq().eq() depth the
// route uses works without needing to hand-model each call), maybeSingle serves the first row (or
// null), and the object is itself awaitable ({data, error}) for a plain list query. upsert() is
// recorded on the shared `mocks.upsert` spy so tests can assert on exactly what was written.
let ROWS;
function chainable(table) {
  const data = ROWS[table] ?? [];
  const obj = {
    select: () => obj,
    eq: () => obj,
    in: () => obj,
    maybeSingle: async () => ({ data: data[0] ?? null, error: null }),
    upsert: async (row) => {
      mocks.upsert(table, row);
      return { data: row, error: null };
    },
    then: (resolve) => resolve({ data, error: null }),
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

const ACCOUNT = { owner_id: "owner_1", id: "acct_1", status: "active" };
const EVENTS = [{ id: "evt_open", owner_id: "owner_1", account_id: "acct_1", event_type: "account_opened", event_origin: "interactive_user", created_by: "11111111-1111-1111-1111-111111111111", effective_date: "2026-01-01", ledger_sequence: 1, recorded_at: "2026-01-01T00:00:00.000Z" }];
const COMPONENTS = [{ owner_id: "owner_1", id: "comp_c1_v1", account_id: "acct_1", component_key: "c1", label: "c1", original_principal_cents: 1_000_000, rate_bps: 0, day_count_convention: "actual_365", scheduled_component_amount_cents: 100_000, allocation_priority: 1, effective_date: "2026-01-01", version_number: 1 }];
const TERMS = [{ owner_id: "owner_1", id: "terms_v1", account_id: "acct_1", version_number: 1, payment_frequency: "monthly", first_payment_due_date: "2026-01-01", regular_scheduled_payment_amount_cents: 100_000, maturity_date: null, allocation_policy: "scheduled_component_order", extra_payment_allocation_policy: "highest_rate_first_extra", prepayment_policy: "allowed_without_penalty_does_not_advance_due_date", day_count_convention: "actual_365", effective_date: "2026-01-01", acting_seller_id: "owner_1", amendment_reason: null }];
const MEMBERSHIPS = [{ borrower_id: "b1", status: "active", private_financing_borrowers: { id: "b1", email: "alex@example.test", full_name: "Alex" } }];

function seedDueTodayFixture() {
  const today = new Date().toISOString().slice(0, 10);
  ROWS = {
    private_financing_accounts: [ACCOUNT],
    private_financing_events: EVENTS,
    private_financing_components: COMPONENTS,
    private_financing_account_terms_versions: [{ ...TERMS[0], first_payment_due_date: today }],
    private_financing_account_borrowers: MEMBERSHIPS,
    private_financing_payment_reminder_deliveries: [],
  };
}

const REAL_ENV = { ...process.env };
beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
  mocks.send.mockReset();
  mocks.upsert.mockReset();
  ROWS = { private_financing_accounts: [] };
});
afterEach(() => {
  process.env = { ...REAL_ENV };
});

describe("GET /api/private-financing/cron/payment-due-reminders", () => {
  it("rejects a call with no CRON_SECRET header", async () => {
    const response = await GET(request("https://x.test/api/private-financing/cron/payment-due-reminders"));
    expect(response.status).toBe(401);
  });

  it("rejects a call with the wrong secret", async () => {
    const response = await GET(request("https://x.test/api/private-financing/cron/payment-due-reminders", { authorization: "Bearer wrong" }));
    expect(response.status).toBe(401);
  });

  it("rejects every call when CRON_SECRET is not configured at all", async () => {
    delete process.env.CRON_SECRET;
    const response = await GET(request("https://x.test/api/private-financing/cron/payment-due-reminders", { authorization: "Bearer anything" }));
    expect(response.status).toBe(401);
  });

  it("dry run computes the plan but sends no email and writes no delivery row", async () => {
    seedDueTodayFixture();
    const response = await GET(request("https://x.test/api/private-financing/cron/payment-due-reminders?dryRun=true", { authorization: "Bearer test-secret" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.dryRun).toBe(true);
    expect(body.wouldSend).toBe(1);
    expect(body.sent).toBe(0);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("a real run sends the eligible reminder and records a sent delivery row", async () => {
    seedDueTodayFixture();
    mocks.send.mockResolvedValue({ messageId: "msg_123" });
    const response = await GET(request("https://x.test/api/private-financing/cron/payment-due-reminders", { authorization: "Bearer test-secret" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.sent).toBe(1);
    expect(body.failed).toBe(0);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send.mock.calls[0][0].recipient).toBe("alex@example.test");
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    const [table, row] = mocks.upsert.mock.calls[0];
    expect(table).toBe("private_financing_payment_reminder_deliveries");
    expect(row.status).toBe("sent");
    expect(row.provider_message_id).toBe("msg_123");
  });

  it("records a failed delivery (not a crash) when the email provider rejects, so the same reminder can retry later", async () => {
    seedDueTodayFixture();
    mocks.send.mockRejectedValue(new Error("Resend rejected email delivery (500)."));
    const response = await GET(request("https://x.test/api/private-financing/cron/payment-due-reminders", { authorization: "Bearer test-secret" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.sent).toBe(0);
    expect(body.failed).toBe(1);
    const [, row] = mocks.upsert.mock.calls[0];
    expect(row.status).toBe("failed");
  });

  it("on a retry, preserves the existing delivery row's id and increments its attempt_count rather than starting a new logical delivery", async () => {
    seedDueTodayFixture();
    ROWS.private_financing_payment_reminder_deliveries = [{ id: "pfrd_owner_1_acct_1_b1_existing", status: "failed", attempt_count: 1 }];
    mocks.send.mockResolvedValue({ messageId: "msg_retry" });
    const response = await GET(request("https://x.test/api/private-financing/cron/payment-due-reminders", { authorization: "Bearer test-secret" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.sent).toBe(1);
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    const [, row] = mocks.upsert.mock.calls[0];
    expect(row.id).toBe("pfrd_owner_1_acct_1_b1_existing"); // reused, not a freshly generated id
    expect(row.attempt_count).toBe(2); // incremented from the existing row's 1, not reset
    expect(row.status).toBe("sent");
    expect("first_attempted_at" in row).toBe(false); // never touched on a retry -- only a genuine first insert sets it
  });

  it("dry run never sends or writes even when a same-day retry candidate exists (a prior failed delivery for today's exact reminder)", async () => {
    seedDueTodayFixture();
    ROWS.private_financing_payment_reminder_deliveries = [{ id: "pfrd_owner_1_acct_1_b1_existing", status: "failed", attempt_count: 1 }];
    const response = await GET(request("https://x.test/api/private-financing/cron/payment-due-reminders?dryRun=true", { authorization: "Bearer test-secret" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.dryRun).toBe(true);
    expect(body.wouldSend).toBe(1);
    expect(body.sent).toBe(0);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("uses the same provider idempotency key format for the outbound send regardless of whether this is an original attempt or a retry", async () => {
    seedDueTodayFixture();
    ROWS.private_financing_payment_reminder_deliveries = [];
    mocks.send.mockResolvedValue({ messageId: "msg_1" });
    await GET(request("https://x.test/api/private-financing/cron/payment-due-reminders", { authorization: "Bearer test-secret" }));
    const firstCallId = mocks.send.mock.calls[0][0].id;
    mocks.send.mockReset();
    mocks.upsert.mockReset();
    mocks.send.mockResolvedValue({ messageId: "msg_2" });
    ROWS.private_financing_payment_reminder_deliveries = [{ id: "pfrd_owner_1_acct_1_b1_existing", status: "failed", attempt_count: 1 }];
    await GET(request("https://x.test/api/private-financing/cron/payment-due-reminders", { authorization: "Bearer test-secret" }));
    const retryCallId = mocks.send.mock.calls[0][0].id;
    expect(retryCallId).toBe(firstCallId); // identical key on retry -- what lets the provider itself dedupe a concurrent race
  });

  it("is registered in vercel.json's crons, once with a valid daily schedule", async () => {
    const { default: vercelJson } = await import("../../../../../../vercel.json", { with: { type: "json" } });
    const matches = vercelJson.crons.filter((entry) => entry.path === "/api/private-financing/cron/payment-due-reminders");
    expect(matches).toHaveLength(1);
    expect(matches[0].schedule).toMatch(/^\d{1,2} \d{1,2} \* \* \*$/);
  });
});
