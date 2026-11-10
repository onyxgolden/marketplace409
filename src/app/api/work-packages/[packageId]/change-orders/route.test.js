import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/changeOrders", () => ({
  getChangeOrderSummary: vi.fn(),
  createChangeOrder: vi.fn(),
  listRetiredChangeOrders: vi.fn(),
}));

import { workAuth } from "../../_lib/auth.js";
import { getChangeOrderSummary, createChangeOrder, listRetiredChangeOrders } from "@/application/work-management/changeOrders";
import { GET, POST } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("GET /api/work-packages/[packageId]/change-orders", () => {
  it("returns the summary and active change orders", async () => {
    getChangeOrderSummary.mockResolvedValue({
      ok: true,
      summary: { hasEstimate: true, runningContractPriceCents: 262000, notApplied: false },
      changeOrders: [{ id: "forge_wco_1", changeOrderNumber: 1 }],
      packageStatus: "in_progress",
    });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(200);
    expect(getChangeOrderSummary).toHaveBeenCalledWith(AUTH.db, { ownerId: "owner_1", packageId: "pkg_1" });
    const body = await response.json();
    expect(body.summary.runningContractPriceCents).toBe(262000);
    expect(body.changeOrders).toHaveLength(1);
  });

  it("?retiredOnly=true lists retired orders instead", async () => {
    listRetiredChangeOrders.mockResolvedValue({
      ok: true, changeOrders: [{ id: "forge_wco_9" }], hasMore: false, packageStatus: "in_progress",
    });
    const response = await GET(new Request("https://test/x?retiredOnly=true&limit=10&offset=0"), { params: params() });
    expect(response.status).toBe(200);
    expect(listRetiredChangeOrders).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1", limit: "10", offset: "0",
    });
    expect(getChangeOrderSummary).not.toHaveBeenCalled();
  });

  it("returns the service error status", async () => {
    getChangeOrderSummary.mockResolvedValue({ ok: false, httpStatus: 404, error: "Work package not found." });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Work package not found.");
  });

  it("returns the auth error untouched", async () => {
    workAuth.mockResolvedValue({ error: Response.json({ error: "Unauthorized." }, { status: 401 }) });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(401);
    expect(getChangeOrderSummary).not.toHaveBeenCalled();
  });
});

describe("POST /api/work-packages/[packageId]/change-orders", () => {
  it("creates with 201 and the server-assigned number", async () => {
    createChangeOrder.mockResolvedValue({
      ok: true,
      changeOrder: { id: "forge_wco_1", changeOrderNumber: 1, status: "estimated" },
      packageStatus: "in_progress",
    });
    const response = await POST(
      new Request("https://test/x", {
        method: "POST",
        body: JSON.stringify({ type: "bust", description: "Rework spool 7", estimatedCostCents: 12000, reason: "Shop piece arrived wrong" }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(201);
    expect(createChangeOrder).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1",
      input: { type: "bust", description: "Rework spool 7", estimatedCostCents: 12000, reason: "Shop piece arrived wrong" },
    });
  });

  it("returns 400 when the service rejects the input", async () => {
    createChangeOrder.mockResolvedValue({ ok: false, httpStatus: 400, error: "Type must be one of the change order types." });
    const response = await POST(
      new Request("https://test/x", { method: "POST", body: JSON.stringify({ type: "scope_change" }) }),
      { params: params() },
    );
    expect(response.status).toBe(400);
  });
});
