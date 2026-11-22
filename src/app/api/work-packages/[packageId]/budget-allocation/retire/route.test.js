import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  requirePackageScope: vi.fn(async () => null),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/budgetAllocations", () => ({
  retireBudgetAllocation: vi.fn(),
}));

import { workAuth } from "../../../_lib/auth.js";
import { retireBudgetAllocation } from "@/application/work-management/budgetAllocations";
import { POST } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("POST /api/work-packages/[packageId]/budget-allocation/retire", () => {
  it("forwards the body to the service and returns the retire result", async () => {
    retireBudgetAllocation.mockResolvedValue({
      ok: true,
      allocation: { retired: true, version: 2 },
      packageStatus: "in_progress",
    });
    const response = await POST(
      new Request("https://test/x", {
        method: "POST",
        body: JSON.stringify({ expectedVersion: 1, reason: "Wrong split" }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(200);
    expect(retireBudgetAllocation).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1",
      packageId: "pkg_1",
      input: { expectedVersion: 1, reason: "Wrong split" },
    });
    expect((await response.json()).allocation).toEqual({ retired: true, version: 2 });
  });

  it("returns 409 when the allocation moved under the editor", async () => {
    retireBudgetAllocation.mockResolvedValue({
      ok: false,
      httpStatus: 409,
      error: "The budget allocation was changed by someone else — refresh and try again.",
    });
    const response = await POST(
      new Request("https://test/x", {
        method: "POST",
        body: JSON.stringify({ expectedVersion: 1, reason: "Wrong split" }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("The budget allocation was changed by someone else — refresh and try again.");
  });

  it("returns 400 when no reason is given", async () => {
    retireBudgetAllocation.mockResolvedValue({
      ok: false,
      httpStatus: 400,
      error: "A reason is required for this change.",
    });
    const response = await POST(
      new Request("https://test/x", {
        method: "POST",
        body: JSON.stringify({ expectedVersion: 1, reason: "" }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(400);
  });
});
