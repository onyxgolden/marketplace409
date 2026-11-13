import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  requirePackageScope: vi.fn(async () => null),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/changeOrders", () => ({
  retireCraftRate: vi.fn(),
}));

import { workAuth } from "../../../../_lib/auth.js";
import { retireCraftRate } from "@/application/work-management/changeOrders";
import { POST } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1", rateId: "forge_wcr_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("POST /api/work-packages/[packageId]/craft-rates/[rateId]/retire", () => {
  it("forwards rate id, version, and reason to the service", async () => {
    retireCraftRate.mockResolvedValue({
      ok: true, craftRate: { id: "forge_wcr_1", version: 2, retiredAt: "t2" }, packageStatus: "in_progress",
    });
    const response = await POST(
      new Request("https://test/x", {
        method: "POST",
        body: JSON.stringify({ expectedVersion: 1, reason: "Back to the default rate" }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(200);
    expect(retireCraftRate).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1", rateId: "forge_wcr_1",
      expectedVersion: 1, reason: "Back to the default rate",
    });
  });

  it("returns 404 when the rate is not found", async () => {
    retireCraftRate.mockResolvedValue({ ok: false, httpStatus: 404, error: "Craft rate not found." });
    const response = await POST(
      new Request("https://test/x", { method: "POST", body: JSON.stringify({ expectedVersion: 1, reason: "Retire" }) }),
      { params: params() },
    );
    expect(response.status).toBe(404);
  });
});
