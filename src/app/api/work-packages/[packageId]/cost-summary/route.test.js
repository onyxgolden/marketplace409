import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
}));
vi.mock("@/application/work-management/packageCosts", () => ({
  getPackageCostSummary: vi.fn(),
}));

import { workAuth } from "../../_lib/auth.js";
import { getPackageCostSummary } from "@/application/work-management/packageCosts";
import { GET } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = (packageId = "forge_wp_1") => Promise.resolve({ packageId });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("GET /api/work-packages/[packageId]/cost-summary", () => {
  it("returns the authenticated owner-scoped package cost summary", async () => {
    getPackageCostSummary.mockResolvedValue({
      ok: true,
      summary: { packageId: "forge_wp_1", plannedCostCents: 15000, actualCostCents: 20000 },
    });
    const response = await GET(new Request("https://test/api/work-packages/forge_wp_1/cost-summary"), { params: params() });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.summary.actualCostCents).toBe(20000);
    expect(getPackageCostSummary).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "forge_wp_1",
    });
  });

  it("maps a missing or cross-owner package to 404", async () => {
    getPackageCostSummary.mockResolvedValue({
      ok: false, httpStatus: 404, error: "Work package not found.",
    });
    const response = await GET(new Request("https://test/api/work-packages/nope/cost-summary"), { params: params("nope") });
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Work package not found.");
  });

  it("returns the auth response before calling the service", async () => {
    const authResponse = Response.json({ error: "Unauthorized" }, { status: 401 });
    workAuth.mockResolvedValue({ error: authResponse });
    const response = await GET(new Request("https://test/api/work-packages/forge_wp_1/cost-summary"), { params: params() });
    expect(response.status).toBe(401);
    expect(getPackageCostSummary).not.toHaveBeenCalled();
  });
});
