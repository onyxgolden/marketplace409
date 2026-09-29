import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase/createRentalWebhookClient", () => ({ createRentalWebhookClient: vi.fn() }));
vi.mock("@/infrastructure/notifications/ResendRentalEmailProvider", () => ({
  createResendRentalEmailProvider: vi.fn(),
}));

import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { GET } from "./route.js";

function qb(result) {
  const node = {
    select: vi.fn(() => node),
    eq: vi.fn(() => node),
    in: vi.fn(() => node),
    order: vi.fn(() => node),
    gte: vi.fn(() => node),
    is: vi.fn(() => node),
    range: vi.fn(() => node),
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

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
  delete process.env.OWNER_PAYMENT_NOTIFICATIONS_ENABLED;
  // Both allow-lists fail closed: tests opt in explicitly.
  process.env.OWNER_PAYMENT_NOTIFICATION_OWNER_IDS = "owner_fixture";
  process.env.RENTAL_NOTIFICATION_TENANT_IDS = "tenant_fixture";
  // Activation cutoff: the reconciler only heals payments settled at/after this.
  process.env.PAYMENT_RECEIPTS_ACTIVATED_AT = "2026-09-01T00:00:00Z";
  vi.clearAllMocks();
  // Pin the clock to noon CDT (outside quiet hours) so delivery tests are
  // deterministic no matter when the suite runs.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-28T17:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("tenant payment receipts cron", () => {
  it("rejects callers without the cron secret", async () => {
    const response = await GET(new Request("https://test/api"));
    expect(response.status).toBe(401);
  });

  it("reconciler heals nothing when the activation cutoff is unset", async () => {
    delete process.env.PAYMENT_RECEIPTS_ACTIVATED_AT;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const db = sequenceDb({
      // No payments table access at all: the reconciler bails before querying.
      rental_tenant_receipt_deliveries: [
        qb({ data: [], error: null }), // delivery candidates: none
      ],
    });
    createRentalWebhookClient.mockReturnValue(db);

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.reconcileSkipped).toBe(true);
    expect(body.reconciled).toBe(0);
    // Fail-closed: the reconciler bails before touching rental_payments, so
    // no stale succeeded payment can be healed.
    expect(db.from).not.toHaveBeenCalledWith("rental_payments");
    expect(logSpy).toHaveBeenCalledWith(
      "Tenant payment receipt reconciler skipped: PAYMENT_RECEIPTS_ACTIVATED_AT is not set.",
    );
    logSpy.mockRestore();
  });

  it("reconciler excludes payments settled before the activation cutoff", async () => {
    const scanQb = qb({ data: [], error: null });
    const db = sequenceDb({
      rental_payments: [scanQb], // reconciler scan: nothing to heal
      rental_tenant_receipt_deliveries: [
        qb({ data: [], error: null }), // delivery candidates: none
      ],
    });
    createRentalWebhookClient.mockReturnValue(db);

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.reconcileSkipped).toBe(false);
    // The scan filters on both the rolling lookback and the activation cutoff.
    expect(scanQb.gte).toHaveBeenCalledWith("succeeded_at", "2026-09-01T00:00:00.000Z");
    expect(scanQb.gte.mock.calls.filter(([field]) => field === "succeeded_at")).toHaveLength(2);
  });
});
