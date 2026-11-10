import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/changeOrders", () => ({
  listChangeOrderRevisions: vi.fn(),
}));

import { workAuth } from "../../../../_lib/auth.js";
import { listChangeOrderRevisions } from "@/application/work-management/changeOrders";
import { GET } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1", changeOrderId: "forge_wco_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("GET /api/work-packages/[packageId]/change-orders/[changeOrderId]/revisions", () => {
  it("forwards paging to the service and returns the history", async () => {
    listChangeOrderRevisions.mockResolvedValue({
      ok: true,
      changeOrder: { id: "forge_wco_1", changeOrderNumber: 1 },
      revisions: [{ id: "rev_1", action: "create", version: 1 }],
      hasMore: false, packageStatus: "in_progress",
    });
    const response = await GET(new Request("https://test/x?limit=50&offset=0"), { params: params() });
    expect(response.status).toBe(200);
    expect(listChangeOrderRevisions).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1", changeOrderId: "forge_wco_1",
      limit: "50", offset: "0",
    });
    expect((await response.json()).revisions).toHaveLength(1);
  });

  it("returns 404 when the change order is not found", async () => {
    listChangeOrderRevisions.mockResolvedValue({ ok: false, httpStatus: 404, error: "Change order not found." });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(404);
  });
});
