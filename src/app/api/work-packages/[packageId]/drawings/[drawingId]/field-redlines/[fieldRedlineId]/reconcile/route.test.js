import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  requirePackageScope: vi.fn(async () => null),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/drawingReviews", () => ({
  reconcileFieldRedline: vi.fn(),
}));

import { workAuth } from "../../../../../../_lib/auth.js";
import { reconcileFieldRedline } from "@/application/work-management/drawingReviews";
import { POST } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1", drawingId: "dwg_1", fieldRedlineId: "forge_wpdfr_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("POST reconcile", () => {
  it("reconciles a field redline and returns it", async () => {
    reconcileFieldRedline.mockResolvedValue({
      ok: true,
      fieldRedline: { id: "forge_wpdfr_1", recordState: "RECONCILED", reconciledRevisionId: "forge_wpdrv_2" },
    });
    const input = { reconciledRevisionId: "forge_wpdrv_2", reason: "Drafter issued rev B." };
    const response = await POST(
      new Request("https://test/x", { method: "POST", body: JSON.stringify(input) }),
      { params: params() },
    );
    expect(response.status).toBe(200);
    expect(reconcileFieldRedline).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1", drawingId: "dwg_1",
      fieldRedlineId: "forge_wpdfr_1", input,
    });
    expect((await response.json()).fieldRedline.recordState).toBe("RECONCILED");
  });

  it("forwards an already-reconciled field redline as 409", async () => {
    reconcileFieldRedline.mockResolvedValue({ ok: false, httpStatus: 409, error: "This field redline is already reconciled." });
    const response = await POST(
      new Request("https://test/x", {
        method: "POST", body: JSON.stringify({ reconciledRevisionId: "forge_wpdrv_2" }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(409);
  });
});
