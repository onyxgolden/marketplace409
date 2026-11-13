import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  requirePackageScope: vi.fn(async () => null),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/changeOrders", () => ({
  setControlEstimate: vi.fn(),
}));

import { workAuth } from "../../_lib/auth.js";
import { setControlEstimate } from "@/application/work-management/changeOrders";
import { PUT } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("PUT /api/work-packages/[packageId]/control-estimate", () => {
  it("forwards the body to the service", async () => {
    setControlEstimate.mockResolvedValue({
      ok: true,
      estimate: { id: "forge_wce_1", originalControlEstimateCents: 250000, version: 1 },
      packageStatus: "in_progress",
    });
    const response = await PUT(
      new Request("https://test/x", {
        method: "PUT",
        body: JSON.stringify({ originalCents: 250000, contingencyCents: 50000, reason: "Budget approved" }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(200);
    expect(setControlEstimate).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1",
      input: { originalCents: 250000, contingencyCents: 50000, reason: "Budget approved" },
    });
  });

  it("returns 400 when the service rejects the input", async () => {
    setControlEstimate.mockResolvedValue({ ok: false, httpStatus: 400, error: "Original control estimate is required (a whole number of cents, 0 or more)." });
    const response = await PUT(
      new Request("https://test/x", { method: "PUT", body: JSON.stringify({ reason: "No figures" }) }),
      { params: params() },
    );
    expect(response.status).toBe(400);
  });
});
