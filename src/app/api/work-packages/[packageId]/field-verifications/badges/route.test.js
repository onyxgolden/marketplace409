import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  requirePackageScope: vi.fn(async () => null),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/fieldVerifications", () => ({
  listFieldVerificationBadges: vi.fn(),
}));

import { workAuth, requirePackageScope } from "../../../_lib/auth.js";
import { listFieldVerificationBadges } from "@/application/work-management/fieldVerifications";
import { GET } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
  requirePackageScope.mockResolvedValue(null);
});

describe("GET /api/work-packages/[packageId]/field-verifications/badges", () => {
  it("returns the badges grouped by step and line", async () => {
    listFieldVerificationBadges.mockResolvedValue({
      ok: true,
      byWorkStep: { forge_step_1: { count: 1, statuses: ["DRAFT"] } },
      byTakeoffLine: { forge_line_1: { count: 2, statuses: ["ACCEPTED", "SUBMITTED"] } },
    });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(200);
    expect(listFieldVerificationBadges).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1",
    });
    const body = await response.json();
    expect(body.byTakeoffLine.forge_line_1.count).toBe(2);
  });

  it("returns the auth error untouched", async () => {
    workAuth.mockResolvedValue({ error: Response.json({ error: "Unauthorized." }, { status: 401 }) });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(401);
    expect(listFieldVerificationBadges).not.toHaveBeenCalled();
  });
});
