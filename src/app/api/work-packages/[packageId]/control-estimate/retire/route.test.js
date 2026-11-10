import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/changeOrders", () => ({
  retireControlEstimate: vi.fn(),
}));

import { workAuth } from "../../../_lib/auth.js";
import { retireControlEstimate } from "@/application/work-management/changeOrders";
import { POST } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("POST /api/work-packages/[packageId]/control-estimate/retire", () => {
  it("forwards estimate id, version, and reason to the service", async () => {
    retireControlEstimate.mockResolvedValue({
      ok: true, estimate: { id: "forge_wce_1", version: 2, retiredAt: "t2" }, packageStatus: "in_progress",
    });
    const response = await POST(
      new Request("https://test/x", {
        method: "POST",
        body: JSON.stringify({ estimateId: "forge_wce_1", expectedVersion: 1, reason: "Starting the budget over" }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(200);
    expect(retireControlEstimate).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1",
      estimateId: "forge_wce_1", expectedVersion: 1, reason: "Starting the budget over",
    });
  });

  it("returns 404 when the estimate is not found", async () => {
    retireControlEstimate.mockResolvedValue({ ok: false, httpStatus: 404, error: "Control estimate not found." });
    const response = await POST(
      new Request("https://test/x", { method: "POST", body: JSON.stringify({ estimateId: "forge_wce_1", expectedVersion: 1, reason: "Retire" }) }),
      { params: params() },
    );
    expect(response.status).toBe(404);
  });
});
