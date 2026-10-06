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

// rental_sweep_runs mock supporting:
// - evidence check: select().eq().eq().eq().limit() -> completedRows
// - runner: insert().select().single() and update().eq()
function markerDb(completedRows) {
  const single = vi.fn(async () => ({ data: { id: "run_watchdog" }, error: null }));
  const limit = vi.fn(async () => ({ data: completedRows, error: null }));
  const node = { single, limit };
  node.eq = vi.fn(() => node);
  const select = vi.fn(() => node);
  const insertSelect = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select: insertSelect }));
  const updateEq = vi.fn(async () => ({ error: null }));
  const update = vi.fn(() => ({ eq: updateEq }));
  return { select, insert, update, insertSelect };
}

let marker;
function mockDb(completedRows, enrollments, charges) {
  marker = markerDb(completedRows);
  createRentalWebhookClient.mockReturnValue({
    from: vi.fn((table) => (table === "rental_sweep_runs" ? marker
      : table === "rental_autopay_enrollments" ? enrollments : charges)),
  });
  return marker;
}

const emptyEnrollments = () => chain({ data: [], error: null });
const emptyCharges = () => chain({ data: [], error: null });

beforeEach(() => {
  process.env.CRON_SECRET = "cron-secret";
  vi.clearAllMocks();
  reconcileMissingStripeSettlements.mockResolvedValue({
    candidates: 0, reconciled: 0, pending: 0, failed: 0,
  });
});

describe("autopay sweep watchdog", () => {
  it("rejects callers without the cron secret", async () => {
    const response = await GET(request());
    expect(response.status).toBe(401);
  });

  it("is a NO-OP when today's sweep already completed — the sweep does not run twice", async () => {
    mockDb([{ id: "run_primary" }], emptyEnrollments(), emptyCharges());

    const response = await GET(request({ authorization: "Bearer cron-secret" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.recovered).toBe(false);
    expect(body.reason).toBe("sweep already completed today");
    expect(executeAutopayAttempt).not.toHaveBeenCalled();
  });

  it("runs the idempotent sweep with triggered_by=watchdog when no completed evidence exists", async () => {
    const m = mockDb([], emptyEnrollments(), emptyCharges());

    const response = await GET(request({ authorization: "Bearer cron-secret" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.recovered).toBe(true);
    expect(m.insert).toHaveBeenCalledWith(expect.objectContaining({
      sweep_name: "rental-autopay",
      triggered_by: "watchdog",
      status: "started",
    }));
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ status: "completed" }));
  });

  it("recovers when the only evidence is a failed run — failed is not completed", async () => {
    // sweepCompletedToday filters status='completed', so a failed row yields zero rows here
    const m = mockDb([], emptyEnrollments(), emptyCharges());

    const response = await GET(request({ authorization: "Bearer cron-secret" }));
    const body = await response.json();
    expect(body.recovered).toBe(true);
    expect(m.insert).toHaveBeenCalledWith(expect.objectContaining({ triggered_by: "watchdog" }));
  });

  it("checks durable evidence, not the Actions API — the evidence query targets rental_sweep_runs", async () => {
    const m = mockDb([{ id: "run_primary" }], emptyEnrollments(), emptyCharges());

    await GET(request({ authorization: "Bearer cron-secret" }));
    expect(m.select).toHaveBeenCalledWith("id");
    // three eq filters: sweep_name, sweep_date, status=completed
    const node = m.select.mock.results[0].value;
    expect(node.eq).toHaveBeenCalledWith("sweep_name", "rental-autopay");
    expect(node.eq).toHaveBeenCalledWith("status", "completed");
  });
});
