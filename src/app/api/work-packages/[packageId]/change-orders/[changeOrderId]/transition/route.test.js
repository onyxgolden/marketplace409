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
  transitionChangeOrder: vi.fn(),
}));

import { workAuth } from "../../../../_lib/auth.js";
import { transitionChangeOrder } from "@/application/work-management/changeOrders";
import { POST } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1", changeOrderId: "forge_wco_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("POST /api/work-packages/[packageId]/change-orders/[changeOrderId]/transition", () => {
  it("forwards the transition to the service", async () => {
    transitionChangeOrder.mockResolvedValue({
      ok: true, changeOrder: { id: "forge_wco_1", status: "approved", version: 2 }, packageStatus: "in_progress",
    });
    const response = await POST(
      new Request("https://test/x", {
        method: "POST",
        body: JSON.stringify({ expectedVersion: 1, toStatus: "approved", approvedCostCents: 12000, reason: "Approved" }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(200);
    expect(transitionChangeOrder).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1", changeOrderId: "forge_wco_1",
      input: { expectedVersion: 1, toStatus: "approved", approvedCostCents: 12000, reason: "Approved" },
    });
    expect((await response.json()).changeOrder.status).toBe("approved");
  });

  it("returns 409 when the server refuses the move", async () => {
    transitionChangeOrder.mockResolvedValue({
      ok: false, httpStatus: 409,
      error: "That status move is not allowed — change orders move one step at a time, and an approved PO can never be denied.",
    });
    const response = await POST(
      new Request("https://test/x", { method: "POST", body: JSON.stringify({ expectedVersion: 1, toStatus: "po_approved", reason: "Jumping ahead" }) }),
      { params: params() },
    );
    expect(response.status).toBe(409);
  });
});
