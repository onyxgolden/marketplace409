import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/createRentalWebhookClient", () => ({ createRentalWebhookClient: vi.fn() }));
vi.mock("@/infrastructure/billing/StripeBillingProvider", () => ({
  createStripeBillingProvider: vi.fn(() => ({ provider: "stripe", mode: "test" })),
}));
vi.mock("@/infrastructure/notifications/ResendRentalEmailProvider", () => ({
  createResendRentalEmailProvider: vi.fn(),
}));

import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { createResendRentalEmailProvider } from "@/infrastructure/notifications/ResendRentalEmailProvider";
import { GET } from "./route.js";

// Obvious fixtures only — never real tenant, lease, or financial data.
const OWNER = "owner_fixture";

function isoTodayPlus(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function qb(result) {
  const node = {
    select: vi.fn(() => node),
    eq: vi.fn(() => node),
    in: vi.fn(() => node),
    order: vi.fn(() => node),
    update: vi.fn(() => node),
    upsert: vi.fn(() => node),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (resolve) => resolve(result),
  };
  return node;
}

// Deterministic mock db: tableSequences maps each table to the list of query
// builders consumed in call order.
function sequenceDb(tableSequences) {
  const counters = {};
  return {
    from: vi.fn((table) => {
      const seq = tableSequences[table];
      if (!seq) throw new Error(`unexpected from(${table}) call`);
      const i = counters[table] || 0;
      counters[table] = i + 1;
      if (i >= seq.length) throw new Error(`too many from(${table}) calls`);
      return seq[i];
    }),
  };
}

function authedRequest(url = "https://test/api") {
  return new Request(url, { headers: { authorization: "Bearer test-secret" } });
}

const ENROLLMENT = { id: "enr_fixture", owner_id: OWNER, lease_id: "lease_fixture" };
function chargeRow() {
  return {
    id: "charge_fixture", owner_id: OWNER, lease_id: "lease_fixture",
    due_date: isoTodayPlus(3), amount_cents: 160000, paid_amount_cents: 0,
    status: "due", charge_type: "rent",
  };
}
const LEASE_TENANTS = [{ lease_id: "lease_fixture", rental_tenants: { id: "tenant_fixture", display_name: "Test Tenant" } }];

function queuedRow() {
  return {
    owner_id: OWNER, id: `opn_${OWNER}_upcoming_autopay_enr_fixture_charge_fixture_${isoTodayPlus(3)}`,
    event_type: "upcoming_autopay", status: "queued", attempt_count: 0,
    first_attempted_at: null, last_attempted_at: null, charge_id: "charge_fixture",
    payload: { tenant_name: "Test Tenant", amount_cents: 160000, due_date: isoTodayPlus(3), charge_type: "rent", is_autopay: true },
  };
}

function upcomingScanSequences() {
  return {
    rental_autopay_enrollments: [qb({ data: [ENROLLMENT], error: null })],
    rent_charges: [qb({ data: [chargeRow()], error: null })],
    rental_lease_tenants: [qb({ data: LEASE_TENANTS, error: null })],
  };
}

function emptyScanSequences() {
  return {
    rental_autopay_enrollments: [qb({ data: [], error: null })],
    rent_charges: [qb({ data: [], error: null })],
  };
}

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
  delete process.env.OWNER_PAYMENT_NOTIFICATIONS_ENABLED;
  delete process.env.OWNER_PAYMENT_NOTIFICATION_EMAIL;
  vi.clearAllMocks();
});

describe("owner payment notifications cron", () => {
  it("rejects callers without the cron secret", async () => {
    const response = await GET(new Request("https://test/api"));
    expect(response.status).toBe(401);
  });

  it("queues the upcoming-autopay notice and, with sending disabled, logs what would have been sent", async () => {
    const db = sequenceDb({
      ...upcomingScanSequences(),
      rent_charges: [
        qb({ data: [chargeRow()], error: null }), // scan
        qb({ data: { status: "due", amount_cents: 160000, paid_amount_cents: 0 }, error: null }), // live recheck
      ],
      rental_owner_notifications: [
        qb({ data: [{ id: "opn_x" }], error: null }), // queue upsert: inserted
        qb({ data: [queuedRow()], error: null }), // delivery candidates
        qb({ data: [{ id: "opn_x" }], error: null }), // claim
        qb({ error: null }), // outcome
      ],
    });
    createRentalWebhookClient.mockReturnValue(db);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.sendingEnabled).toBe(false);
    expect(body.upcomingDetected).toBe(1);
    expect(body.queued).toBe(1);
    expect(body.skippedDisabled).toBe(1);
    expect(body.wouldSend).toBe(1);
    expect(body.sent).toBe(0);
    expect(createResendRentalEmailProvider).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      "Owner payment notification (sending disabled) would send",
      expect.objectContaining({ to: "Brandykaymorgan@gmail.com", subject: expect.stringContaining("Upcoming autopay") }),
    );
    logSpy.mockRestore();
  });

  it("sends via Resend when the enable flag is on", async () => {
    process.env.OWNER_PAYMENT_NOTIFICATIONS_ENABLED = "true";
    const send = vi.fn().mockResolvedValue({ messageId: "re_123" });
    createResendRentalEmailProvider.mockReturnValue({ send });
    const db = sequenceDb({
      ...emptyScanSequences(),
      rent_charges: [
        qb({ data: [], error: null }), // scan
        qb({ data: { status: "due", amount_cents: 160000, paid_amount_cents: 0 }, error: null }), // live recheck
      ],
      rental_owner_notifications: [
        qb({ data: [queuedRow()], error: null }), // candidates
        qb({ data: [{ id: "opn_x" }], error: null }), // claim
        qb({ error: null }), // outcome
      ],
    });
    createRentalWebhookClient.mockReturnValue(db);

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(body.sendingEnabled).toBe(true);
    expect(body.sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      recipient: "Brandykaymorgan@gmail.com",
      senderName: "FORGE Rental Manager",
      id: expect.stringContaining("owner-notify-"),
    }));
  });

  it("does not double-queue an already-queued upcoming notice", async () => {
    const db = sequenceDb({
      ...upcomingScanSequences(),
      rental_owner_notifications: [
        qb({ data: [], error: null }), // upsert hit the dedup conflict: nothing inserted
        qb({ data: [], error: null }), // no delivery candidates
      ],
    });
    createRentalWebhookClient.mockReturnValue(db);

    const response = await GET(authedRequest());
    const body = await response.json();
    expect(body.queued).toBe(0);
    expect(body.alreadyQueued).toBe(1);
  });

  it("supersedes the upcoming notice when the charge was paid before delivery", async () => {
    process.env.OWNER_PAYMENT_NOTIFICATIONS_ENABLED = "true";
    const send = vi.fn();
    createResendRentalEmailProvider.mockReturnValue({ send });
    const db = sequenceDb({
      ...emptyScanSequences(),
      rent_charges: [
        qb({ data: [], error: null }), // scan
        qb({ data: { status: "due", amount_cents: 160000, paid_amount_cents: 160000 }, error: null }), // recheck: paid
      ],
      rental_owner_notifications: [
        qb({ data: [queuedRow()], error: null }),
        qb({ data: [{ id: "opn_x" }], error: null }),
        qb({ error: null }),
      ],
    });
    createRentalWebhookClient.mockReturnValue(db);

    const response = await GET(authedRequest());
    const body = await response.json();
    expect(body.superseded).toBe(1);
    expect(body.sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("dry run detects without writing", async () => {
    const db = sequenceDb(upcomingScanSequences());
    createRentalWebhookClient.mockReturnValue(db);
    const response = await GET(authedRequest("https://test/api?dryRun=true"));
    const body = await response.json();
    expect(body.dryRun).toBe(true);
    expect(body.upcomingDetected).toBe(1);
    expect(db.from).not.toHaveBeenCalledWith("rental_owner_notifications");
  });
});
