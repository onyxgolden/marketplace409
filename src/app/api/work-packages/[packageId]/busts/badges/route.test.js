import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  requirePackageScope: vi.fn(async () => null),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
}));
vi.mock("@/application/work-management/busts", () => ({
  listBustBadges: vi.fn(),
}));

import { workAuth, requirePackageScope } from "../../../_lib/auth.js";
import { listBustBadges } from "@/application/work-management/busts";
import { GET } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
  requirePackageScope.mockResolvedValue(null);
});

describe("GET /api/work-packages/[packageId]/busts/badges", () => {
  it("returns the badge maps for the step and manpower views", async () => {
    listBustBadges.mockResolvedValue({
      ok: true,
      byTakeoffLine: { line_1: { count: 1, dimensions: ["INSTALLED_QUANTITY"] } },
      byWorkStep: { step_1: { count: 1, dimensions: ["LABOR_HOURS"] } },
      byCraftDay: { "pipefitters|2026-11-09": { count: 1, dimensions: ["MANPOWER_SHORTFALL"] } },
    });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(200);
    expect(listBustBadges).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1",
    });
    const body = await response.json();
    expect(body.byTakeoffLine.line_1.count).toBe(1);
    expect(body.byWorkStep.step_1.count).toBe(1);
    expect(body.byCraftDay["pipefitters|2026-11-09"].count).toBe(1);
  });

  it("returns the service error status", async () => {
    listBustBadges.mockResolvedValue({ ok: false, httpStatus: 404, error: "Work package not found." });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Work package not found.");
  });

  it("returns the auth error untouched", async () => {
    workAuth.mockResolvedValue({ error: Response.json({ error: "Unauthorized." }, { status: 401 }) });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(401);
    expect(listBustBadges).not.toHaveBeenCalled();
  });

  it("returns the package-scope failure untouched", async () => {
    requirePackageScope.mockResolvedValue(Response.json({ error: "Package not found." }, { status: 404 }));
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(404);
    expect(listBustBadges).not.toHaveBeenCalled();
  });
});
