import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  requirePackageScope: vi.fn(async () => null),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/budgetAllocations", () => ({
  getBudgetAllocation: vi.fn(),
  replaceBudgetAllocation: vi.fn(),
}));

import { workAuth } from "../../_lib/auth.js";
import {
  getBudgetAllocation,
  replaceBudgetAllocation,
} from "@/application/work-management/budgetAllocations";
import { GET, POST } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1" });
const request = (method = "GET", body = undefined) => new Request("https://test/x", {
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("GET /api/work-packages/[packageId]/budget-allocation", () => {
  it("returns the allocation, estimate, and labor forecast", async () => {
    getBudgetAllocation.mockResolvedValue({
      ok: true,
      notApplied: false,
      packageCode: "SYN-A",
      packageTitle: "Synthetic exchanger [SYNTHETIC]",
      packageStatus: "in_progress",
      estimate: { id: "est_a", currentControlEstimateCents: 250000, version: 1 },
      allocation: { id: "forge_wba_1", allocatedTotalCents: 250000, version: 1, lines: [] },
      plannedLaborForecastCents: 90000,
    });
    const response = await GET(request(), { params: params() });
    expect(response.status).toBe(200);
    expect(getBudgetAllocation).toHaveBeenCalledWith(AUTH.db, { ownerId: "owner_1", packageId: "pkg_1" });
    const body = await response.json();
    expect(body.packageCode).toBe("SYN-A");
    expect(body.estimate.currentControlEstimateCents).toBe(250000);
    expect(body.plannedLaborForecastCents).toBe(90000);
  });

  it("returns 404 when the service cannot find the package", async () => {
    getBudgetAllocation.mockResolvedValue({ ok: false, httpStatus: 404, error: "Work package not found." });
    const response = await GET(request(), { params: params() });
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Work package not found.");
  });
});

describe("POST /api/work-packages/[packageId]/budget-allocation", () => {
  it("forwards the body to the service and returns the saved allocation with category totals", async () => {
    replaceBudgetAllocation.mockResolvedValue({
      ok: true,
      allocation: { id: "forge_wba_1", allocatedTotalCents: 250000, version: 1 },
      categoryTotals: { labor: 150000, material: 100000, equipment: 0, external_services: 0, rental: 0 },
      packageStatus: "in_progress",
    });
    const input = {
      expectedAllocationVersion: 0,
      expectedEstimateId: "est_a",
      expectedEstimateVersion: 1,
      lines: [
        { category: "labor", description: "Crew", amountCents: 150000 },
        { category: "material", description: "Pipe", amountCents: 100000 },
      ],
      reason: "First allocation",
    };
    const response = await POST(request("POST", input), { params: params() });
    expect(response.status).toBe(200);
    expect(replaceBudgetAllocation).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1",
      packageId: "pkg_1",
      input,
    });
    const body = await response.json();
    expect(body.categoryTotals.labor).toBe(150000);
  });

  it("returns 400 when the lines do not add up to the estimate", async () => {
    replaceBudgetAllocation.mockResolvedValue({
      ok: false,
      httpStatus: 400,
      error: "The lines must add up to the current control estimate exactly.",
    });
    const response = await POST(request("POST", { reason: "Short" }), { params: params() });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("The lines must add up to the current control estimate exactly.");
  });

  it("returns 409 when the allocation moved under the editor", async () => {
    replaceBudgetAllocation.mockResolvedValue({
      ok: false,
      httpStatus: 409,
      error: "The budget allocation was changed by someone else — refresh and try again.",
    });
    const response = await POST(request("POST", { reason: "Stale" }), { params: params() });
    expect(response.status).toBe(409);
  });
});
