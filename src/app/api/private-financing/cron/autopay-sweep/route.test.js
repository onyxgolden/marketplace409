import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/createRentalWebhookClient", () => ({ createRentalWebhookClient: vi.fn() }));
vi.mock("@/infrastructure/billing/StripeBillingProvider", () => ({ createStripeBillingProvider: vi.fn() }));
vi.mock("@/application/private-financing/executePfAutopayAttempt", () => ({
  currentBillingPeriod: () => "2026-09",
  executePfAutopayAttempt: vi.fn(),
}));

import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { createStripeBillingProvider } from "@/infrastructure/billing/StripeBillingProvider";
import { executePfAutopayAttempt } from "@/application/private-financing/executePfAutopayAttempt";
import { GET } from "./route.js";

function chain(result = { data: null, error: null }) {
  const node = {
    select: vi.fn(() => node), eq: vi.fn(() => node),
    single: vi.fn(async () => result), maybeSingle: vi.fn(async () => result),
    then: (resolve) => resolve(result),
  };
  return node;
}

function authorizedRequest() {
  process.env.CRON_SECRET = "cron-secret";
  return new Request("https://test/api/private-financing/cron/autopay-sweep", {
    headers: { authorization: "Bearer cron-secret" },
  });
}

describe("private financing autopay sweep", () => {
  it("rejects callers without the cron secret", async () => {
    process.env.CRON_SECRET = "cron-secret";
    const response = await GET(new Request("https://test/api/private-financing/cron/autopay-sweep"));
    expect(response.status).toBe(401);
  });

  it("only attempts enrollments whose charge day has arrived, scoped to the provider mode", async () => {
    createStripeBillingProvider.mockReturnValue({ mode: "test" });
    const enrollmentQuery = chain({ data: [
      { id: "due_1", owner_id: "owner_1", account_id: "a1", borrower_id: "b1", charge_day: 1 },
      { id: "future_1", owner_id: "owner_1", account_id: "a1", borrower_id: "b1", charge_day: 28 },
    ], error: null });
    const db = { from: vi.fn(() => enrollmentQuery) };
    createRentalWebhookClient.mockReturnValue(db);
    executePfAutopayAttempt.mockResolvedValue({ httpStatus: 200, body: { success: true } });

    // Freeze "today" at 2026-09-23: charge_day 1 is due, charge_day 28 is not.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-23T12:00:00Z"));
    const response = await GET(authorizedRequest());
    vi.useRealTimers();

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.billingPeriod).toBe("2026-09");
    expect(body.candidates).toBe(1);
    expect(executePfAutopayAttempt).toHaveBeenCalledTimes(1);
    expect(executePfAutopayAttempt).toHaveBeenCalledWith(db, "due_1", "2026-09");
    expect(enrollmentQuery.eq).toHaveBeenCalledWith("status", "active");
    expect(enrollmentQuery.eq).toHaveBeenCalledWith("provider_mode", "test");
  });

  it("counts duplicates as skipped and continues past failures", async () => {
    createStripeBillingProvider.mockReturnValue({ mode: "live" });
    const db = { from: vi.fn(() => chain({ data: [
      { id: "e1", charge_day: 1 }, { id: "e2", charge_day: 1 }, { id: "e3", charge_day: 1 },
    ], error: null })) };
    createRentalWebhookClient.mockReturnValue(db);
    executePfAutopayAttempt
      .mockResolvedValueOnce({ httpStatus: 200, body: { success: true } })
      .mockResolvedValueOnce({ httpStatus: 200, body: { success: true, duplicate: true } })
      .mockRejectedValueOnce(new Error("boom"));

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-23T12:00:00Z"));
    const response = await GET(authorizedRequest());
    vi.useRealTimers();

    const body = await response.json();
    expect(body).toEqual(expect.objectContaining({ success: true, candidates: 3, succeeded: 1, failed: 1, skipped: 1 }));
  });
});
