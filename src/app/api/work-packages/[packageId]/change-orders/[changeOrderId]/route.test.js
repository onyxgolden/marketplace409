import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/changeOrders", () => ({
  updateChangeOrder: vi.fn(),
}));

import { workAuth } from "../../../_lib/auth.js";
import { updateChangeOrder } from "@/application/work-management/changeOrders";
import { PATCH } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1", changeOrderId: "forge_wco_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("PATCH /api/work-packages/[packageId]/change-orders/[changeOrderId]", () => {
  it("forwards the body to the service", async () => {
    updateChangeOrder.mockResolvedValue({
      ok: true, changeOrder: { id: "forge_wco_1", version: 2 }, packageStatus: "in_progress",
    });
    const response = await PATCH(
      new Request("https://test/x", {
        method: "PATCH",
        body: JSON.stringify({ expectedVersion: 1, estimatedCostCents: 15000, reason: "Revised quote" }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(200);
    expect(updateChangeOrder).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1", changeOrderId: "forge_wco_1",
      input: { expectedVersion: 1, estimatedCostCents: 15000, reason: "Revised quote" },
    });
    expect((await response.json()).changeOrder.version).toBe(2);
  });

  it("returns 409 on a version conflict", async () => {
    updateChangeOrder.mockResolvedValue({
      ok: false, httpStatus: 409,
      error: "The Change Orders Log was changed by someone else — refresh and try again.",
    });
    const response = await PATCH(
      new Request("https://test/x", { method: "PATCH", body: JSON.stringify({ expectedVersion: 1, reason: "Edit" }) }),
      { params: params() },
    );
    expect(response.status).toBe(409);
  });
});
