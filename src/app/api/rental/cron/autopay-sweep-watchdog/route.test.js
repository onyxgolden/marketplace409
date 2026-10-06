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

// rental_sweep_runs evidence-marker mock
function markerChain() {
  const single = vi.fn(async () => ({ data: { id: "run_1" }, error: null }));
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select }));
  const eq = vi.fn(async () => ({ error: null }));
  const update = vi.fn(() => ({ eq }));
  return { insert, update, select, eq, single };
}

// Claim acquired on first insert (fresh day); release is fenced on claimed_by.
function claimInsertOk() {
  const insert = vi.fn(async () => ({ error: null }));
  const select = vi.fn(async () => ({ data: [{ sweep_name: "rental-autopay" }], error: null }));
  const eq3 = vi.fn(() => ({ select }));
  const eq2 = vi.fn(() => ({ eq: eq3 }));
  const eq1 = vi.fn(() => ({ eq: eq2 }));
  const update = vi.fn(() => ({ eq: eq1 }));
  return { insert, update };
}

// Claim already completed today: insert hits the PK, select shows completed
function claimAlreadyCompleted() {
  const dupError = new Error("duplicate key");
  dupError.code = "23505";
  const insert = vi.fn(async () => ({ error: dupError }));
  const single = vi.fn(async () => ({
    data: { status: "completed", claimed_by: "schedule", claimed_at: new Date().toISOString(), attempts: 1 },
    error: null,
  }));
  const node = { single };
  node.eq = vi.fn(() => node);
  const select = vi.fn(() => node);
  const update = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }));
  return { insert, select, update };
}

let marker;
let claim;
function mockDb(claimMock) {
  marker = markerChain();
  claim = claimMock;
  const enrollments = chain({ data: [], error: null });
  const charges = chain({ data: [], error: null });
  createRentalWebhookClient.mockReturnValue({
    from: vi.fn((table) => (table === "rental_sweep_runs" ? marker
      : table === "rental_sweep_claims" ? claim
      : table === "rental_autopay_enrollments" ? enrollments : charges)),
  });
  return claim;
}

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

  it("is a NO-OP when the daily claim is already completed — the sweep does not run twice", async () => {
    mockDb(claimAlreadyCompleted());

    const response = await GET(request({ authorization: "Bearer cron-secret" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.recovered).toBe(false);
    expect(body.reason).toContain("already-completed");
    expect(executeAutopayAttempt).not.toHaveBeenCalled();
  });

  it("runs the idempotent sweep with triggered_by=watchdog when the claim is free", async () => {
    const c = mockDb(claimInsertOk());

    const response = await GET(request({ authorization: "Bearer cron-secret" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.recovered).toBe(true);
    expect(c.insert).toHaveBeenCalledWith(expect.objectContaining({
      sweep_name: "rental-autopay",
      status: "claimed",
      claimed_by: "watchdog",
    }));
    // claim released as completed after the run
    expect(c.update).toHaveBeenCalledWith(expect.objectContaining({ status: "completed" }));
    // evidence row marked completed too
    expect(marker.update).toHaveBeenCalledWith(expect.objectContaining({ status: "completed" }));
  });

  it("does not run when the claim is held live by the primary sweep", async () => {
    const dupError = new Error("duplicate key");
    dupError.code = "23505";
    const insert = vi.fn(async () => ({ error: dupError }));
    const single = vi.fn(async () => ({
      data: { status: "claimed", claimed_by: "schedule", claimed_at: new Date().toISOString(), attempts: 1 },
      error: null,
    }));
    const node = { single };
    node.eq = vi.fn(() => node);
    mockDb({ insert, select: vi.fn(() => node), update: vi.fn() });

    const response = await GET(request({ authorization: "Bearer cron-secret" }));
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.recovered).toBe(false);
    expect(body.reason).toContain("in-progress");
    expect(executeAutopayAttempt).not.toHaveBeenCalled();
  });
});
