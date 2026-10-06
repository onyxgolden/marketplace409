import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/createRentalWebhookClient", () => ({ createRentalWebhookClient: vi.fn() }));
vi.mock("@/application/rental/executeAutopayAttempt", () => ({ executeAutopayAttempt: vi.fn() }));
vi.mock("@/infrastructure/billing/StripeBillingProvider", () => ({
  createStripeBillingProvider: vi.fn(() => ({ provider: "stripe", mode: "test" })),
}));
vi.mock("../settlement-reconciliation/route.js", () => ({
  reconcileMissingStripeSettlements: vi.fn(),
}));

import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { executeAutopayAttempt } from "@/application/rental/executeAutopayAttempt";
import { reconcileMissingStripeSettlements } from "../settlement-reconciliation/route.js";
import { GET } from "./route.js";
import { AUTOPAY_COLLECTIBLE_CHARGE_TYPES } from "@/application/rental/tenantCharges";

function request(url = "https://test/api", headers = {}) { return new Request(url, { headers }); }

function chain(result) {
  const node = { select: vi.fn(() => node), eq: vi.fn(() => node), in: vi.fn(() => node), lte: vi.fn(() => node), then: (resolve) => resolve(result) };
  return node;
}

// rental_sweep_runs evidence-marker mock: insert().select().single() and update().eq()
function markerChain() {
  const single = vi.fn(async () => ({ data: { id: "run_1" }, error: null }));
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select }));
  const eq = vi.fn(async () => ({ error: null }));
  const update = vi.fn(() => ({ eq }));
  return { insert, update, select, eq, single };
}

let marker;
function mockDb(enrollments, charges) {
  marker = markerChain();
  createRentalWebhookClient.mockReturnValue({
    from: vi.fn((table) => (table === "rental_sweep_runs" ? marker
      : table === "rental_autopay_enrollments" ? enrollments : charges)),
  });
  return marker;
}

beforeEach(() => {
  process.env.CRON_SECRET = "cron-secret";
  vi.clearAllMocks();
  reconcileMissingStripeSettlements.mockResolvedValue({
    candidates: 0, reconciled: 0, pending: 0, failed: 0,
  });
});

describe("autopay sweep cron", () => {
  it("rejects callers without the cron secret", async () => {
    const response = await GET(request());
    expect(response.status).toBe(401);
  });

  it("attempts autopay only for enrollments whose owner and lease match a due charge", async () => {
    const enrollments = chain({ data: [
      { id: "enrollment_1", owner_id: "owner_1", lease_id: "lease_1" },
      { id: "enrollment_2", owner_id: "owner_1", lease_id: "lease_2" },
    ], error: null });
    const charges = chain({ data: [
      { id: "charge_1", owner_id: "owner_1", lease_id: "lease_1" },
    ], error: null });
    mockDb(enrollments, charges);
    executeAutopayAttempt.mockResolvedValue({ httpStatus: 200, body: { success: true, duplicate: false } });

    const response = await GET(request("https://test/api", { authorization: "Bearer cron-secret" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.candidates).toBe(1);
    expect(body.succeeded).toBe(1);
    expect(body.failed).toBe(0);
    expect(executeAutopayAttempt).toHaveBeenCalledTimes(1);
    expect(executeAutopayAttempt).toHaveBeenCalledWith(expect.anything(), "enrollment_1", "charge_1");
    expect(reconcileMissingStripeSettlements).toHaveBeenCalledWith(
      expect.anything(), expect.objectContaining({ provider: "stripe" }),
    );
  });

  it("scopes the active-enrollment query to the server's provider_mode — a preserved sandbox enrollment is never a live sweep candidate", async () => {
    const enrollments = chain({ data: [], error: null });
    const charges = chain({ data: [], error: null });
    mockDb(enrollments, charges);
    await GET(request("https://test/api", { authorization: "Bearer cron-secret" }));
    expect(enrollments.eq).toHaveBeenCalledWith("provider_mode", "test");
  });

  it("fences the sweep query to autopay-collectible charge types — ad-hoc types (damage/fee/utility/other) are never sweep candidates", async () => {
    const enrollments = chain({ data: [], error: null });
    const charges = chain({ data: [], error: null });
    mockDb(enrollments, charges);
    await GET(request("https://test/api", { authorization: "Bearer cron-secret" }));
    expect(charges.select).toHaveBeenCalledWith(expect.stringContaining("charge_type"));
    expect(charges.in).toHaveBeenCalledWith("charge_type", AUTOPAY_COLLECTIBLE_CHARGE_TYPES);
  });

  it("counts a failed attempt without aborting the sweep", async () => {
    const enrollments = chain({ data: [{ id: "enrollment_1", owner_id: "owner_1", lease_id: "lease_1" }], error: null });
    const charges = chain({ data: [{ id: "charge_1", owner_id: "owner_1", lease_id: "lease_1" }], error: null });
    mockDb(enrollments, charges);
    executeAutopayAttempt.mockResolvedValue({ httpStatus: 409, body: { error: "Autopay attempt failed." } });

    const response = await GET(request("https://test/api", { authorization: "Bearer cron-secret" }));
    const body = await response.json();
    expect(body.succeeded).toBe(0);
    expect(body.failed).toBe(1);
  });

  it("counts an already-paid skip separately from successes and failures", async () => {
    const enrollments = chain({ data: [{ id: "enrollment_1", owner_id: "owner_1", lease_id: "lease_1" }], error: null });
    const charges = chain({ data: [{ id: "charge_1", owner_id: "owner_1", lease_id: "lease_1" }], error: null });
    mockDb(enrollments, charges);
    executeAutopayAttempt.mockResolvedValue({ httpStatus: 200, body: { success: true, skipped: true, reason: "payment_pending" } });

    const response = await GET(request("https://test/api", { authorization: "Bearer cron-secret" }));
    const body = await response.json();
    expect(body.candidates).toBe(1);
    expect(body.succeeded).toBe(0);
    expect(body.failed).toBe(0);
    expect(body.skipped).toBe(1);
  });

  it("records durable sweep evidence with triggered_by=schedule and marks it completed", async () => {
    const enrollments = chain({ data: [], error: null });
    const charges = chain({ data: [], error: null });
    const m = mockDb(enrollments, charges);

    const response = await GET(request("https://test/api", { authorization: "Bearer cron-secret" }));
    expect(response.status).toBe(200);
    expect(m.insert).toHaveBeenCalledWith(expect.objectContaining({
      sweep_name: "rental-autopay",
      triggered_by: "schedule",
      status: "started",
    }));
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ status: "completed" }));
    expect(m.eq).toHaveBeenCalledWith("id", "run_1");
  });

  it("records triggered_by=manual when ?trigger=manual is present (workflow_dispatch provenance)", async () => {
    const enrollments = chain({ data: [], error: null });
    const charges = chain({ data: [], error: null });
    const m = mockDb(enrollments, charges);

    await GET(request("https://test/api?trigger=manual", { authorization: "Bearer cron-secret" }));
    expect(m.insert).toHaveBeenCalledWith(expect.objectContaining({ triggered_by: "manual" }));
  });

  it("marks the evidence row failed when the sweep throws, and still returns 500", async () => {
    const enrollments = chain({ data: null, error: new Error("db down") });
    const charges = chain({ data: [], error: null });
    const m = mockDb(enrollments, charges);

    const response = await GET(request("https://test/api", { authorization: "Bearer cron-secret" }));
    expect(response.status).toBe(500);
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  });

  it("never breaks the sweep when the evidence marker write fails (e.g. migration not yet applied)", async () => {
    const enrollments = chain({ data: [], error: null });
    const charges = chain({ data: [], error: null });
    const m = mockDb(enrollments, charges);
    m.single.mockResolvedValueOnce({ data: null, error: new Error("relation does not exist") });

    const response = await GET(request("https://test/api", { authorization: "Bearer cron-secret" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
  });
});
