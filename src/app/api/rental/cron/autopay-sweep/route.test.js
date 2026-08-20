import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/createRentalWebhookClient", () => ({ createRentalWebhookClient: vi.fn() }));
vi.mock("@/application/rental/executeAutopayAttempt", () => ({ executeAutopayAttempt: vi.fn() }));
vi.mock("@/infrastructure/billing/StripeBillingProvider", () => ({
  createStripeBillingProvider: vi.fn(() => ({ provider: "stripe" })),
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

function cronRunsTable() {
  return { insert: vi.fn(async () => ({ error: null })), update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })) };
}

describe("autopay sweep cron audit trail", () => {
  it("records exactly one completed audit row with mapped counts for a successful sweep", async () => {
    const enrollments = chain({ data: [{ id: "enrollment_1", owner_id: "owner_1", lease_id: "lease_1" }], error: null });
    const charges = chain({ data: [{ id: "charge_1", owner_id: "owner_1", lease_id: "lease_1" }], error: null });
    const cronRuns = cronRunsTable();
    createRentalWebhookClient.mockReturnValue({ from: vi.fn((table) => {
      if (table === "rental_autopay_enrollments") return enrollments;
      if (table === "rental_cron_runs") return cronRuns;
      return charges;
    }) });
    executeAutopayAttempt.mockResolvedValue({ httpStatus: 200, body: { success: true, duplicate: false } });

    const response = await GET(request({ authorization: "Bearer cron-secret", "user-agent": "vercel-cron/1.0" }));
    expect(response.status).toBe(200);

    expect(cronRuns.insert).toHaveBeenCalledTimes(1);
    expect(cronRuns.insert).toHaveBeenCalledWith(expect.objectContaining({
      job_name: "autopay-sweep", route_path: "/api/rental/cron/autopay-sweep",
      trigger_source: "vercel_cron", status: "running",
    }));
    expect(cronRuns.update).toHaveBeenCalledTimes(1);
    const [patch] = cronRuns.update.mock.calls[0];
    expect(patch).toMatchObject({ status: "succeeded", processed_count: 1, succeeded_count: 1, failed_count: 0 });
  });

  it("classifies a mixed outcome as partially_succeeded", async () => {
    const enrollments = chain({ data: [
      { id: "enrollment_1", owner_id: "owner_1", lease_id: "lease_1" },
      { id: "enrollment_2", owner_id: "owner_1", lease_id: "lease_2" },
    ], error: null });
    const charges = chain({ data: [
      { id: "charge_1", owner_id: "owner_1", lease_id: "lease_1" },
      { id: "charge_2", owner_id: "owner_1", lease_id: "lease_2" },
    ], error: null });
    const cronRuns = cronRunsTable();
    createRentalWebhookClient.mockReturnValue({ from: vi.fn((table) => {
      if (table === "rental_autopay_enrollments") return enrollments;
      if (table === "rental_cron_runs") return cronRuns;
      return charges;
    }) });
    executeAutopayAttempt
      .mockResolvedValueOnce({ httpStatus: 200, body: { success: true } })
      .mockResolvedValueOnce({ httpStatus: 409, body: { error: "failed" } });

    const response = await GET(request({ authorization: "Bearer cron-secret" }));
    expect(response.status).toBe(200);
    const [patch] = cronRuns.update.mock.calls[0];
    expect(patch).toMatchObject({ status: "partially_succeeded", succeeded_count: 1, failed_count: 1 });
  });

  it("does not repeat or corrupt autopay attempts when the audit write fails", async () => {
    const enrollments = chain({ data: [{ id: "enrollment_1", owner_id: "owner_1", lease_id: "lease_1" }], error: null });
    const charges = chain({ data: [{ id: "charge_1", owner_id: "owner_1", lease_id: "lease_1" }], error: null });
    createRentalWebhookClient.mockReturnValue({ from: vi.fn((table) => {
      if (table === "rental_autopay_enrollments") return enrollments;
      if (table === "rental_cron_runs") throw new Error("audit unavailable");
      return charges;
    }) });
    executeAutopayAttempt.mockResolvedValue({ httpStatus: 200, body: { success: true } });

    const response = await GET(request({ authorization: "Bearer cron-secret" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.succeeded).toBe(1);
    expect(executeAutopayAttempt).toHaveBeenCalledTimes(1);
  });

  it("creates no audit record for an unauthorized request", async () => {
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(createRentalWebhookClient).not.toHaveBeenCalled();
  });
});
