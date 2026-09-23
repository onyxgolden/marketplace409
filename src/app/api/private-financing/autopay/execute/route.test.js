import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/createRentalWebhookClient", () => ({ createRentalWebhookClient: vi.fn() }));
vi.mock("@/application/private-financing/executePfAutopayAttempt", () => ({
  currentBillingPeriod: () => "2026-09",
  executePfAutopayAttempt: vi.fn(async () => ({ httpStatus: 200, body: { success: true } })),
}));

import { POST } from "./route.js";

describe("private financing autopay execute", () => {
  it("rejects callers without the execution secret", async () => {
    process.env.PF_AUTOPAY_EXECUTION_SECRET = "secret";
    const response = await POST(new Request("https://test/api", { method: "POST", body: "{}" }));
    expect(response.status).toBe(401);
  });

  it("rejects when the execution secret is not configured", async () => {
    delete process.env.PF_AUTOPAY_EXECUTION_SECRET;
    const response = await POST(new Request("https://test/api", {
      method: "POST",
      headers: { authorization: "Bearer secret" },
      body: JSON.stringify({ enrollmentId: "pf_autopay_1" }),
    }));
    expect(response.status).toBe(401);
  });
});
