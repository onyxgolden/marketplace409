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

function request(headers = {}) { return new Request("https://test/api", { headers }); }

function chain(result) {
  const node = { select: vi.fn(() => node), eq: vi.fn(() => node), in: vi.fn(() => node), lte: vi.fn(() => node), then: (resolve) => resolve(result) };
  return node;
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
    createRentalWebhookClient.mockReturnValue({ from: vi.fn((table) => (table === "rental_autopay_enrollments" ? enrollments : charges)) });
    executeAutopayAttempt.mockResolvedValue({ httpStatus: 200, body: { success: true, duplicate: false } });

    const response = await GET(request({ authorization: "Bearer cron-secret" }));
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
    createRentalWebhookClient.mockReturnValue({ from: vi.fn((table) => (table === "rental_autopay_enrollments" ? enrollments : charges)) });
    await GET(request({ authorization: "Bearer cron-secret" }));
    expect(enrollments.eq).toHaveBeenCalledWith("provider_mode", "test");
  });

  it("counts a failed attempt without aborting the sweep", async () => {
    const enrollments = chain({ data: [{ id: "enrollment_1", owner_id: "owner_1", lease_id: "lease_1" }], error: null });
    const charges = chain({ data: [{ id: "charge_1", owner_id: "owner_1", lease_id: "lease_1" }], error: null });
    createRentalWebhookClient.mockReturnValue({ from: vi.fn((table) => (table === "rental_autopay_enrollments" ? enrollments : charges)) });
    executeAutopayAttempt.mockResolvedValue({ httpStatus: 409, body: { error: "Autopay attempt failed." } });

    const response = await GET(request({ authorization: "Bearer cron-secret" }));
    const body = await response.json();
    expect(body.succeeded).toBe(0);
    expect(body.failed).toBe(1);
  });
});
