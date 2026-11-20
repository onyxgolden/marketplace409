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
  getFieldVerificationSources: vi.fn(),
}));

import { workAuth, requirePackageScope } from "../../../_lib/auth.js";
import { getFieldVerificationSources } from "@/application/work-management/fieldVerifications";
import { GET } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
  requirePackageScope.mockResolvedValue(null);
});

describe("GET /api/work-packages/[packageId]/field-verifications/sources", () => {
  it("returns the assembled source preview for the requested target", async () => {
    getFieldVerificationSources.mockResolvedValue({
      ok: true,
      packageId: "pkg_1", packageStatus: "in_progress", asOf: "2026-11-15",
      targetType: "TAKEOFF_LINE", targetId: "forge_line_1",
      plannedLineQuantity: 10, unit: "EA", installedAsOf: 12.5,
      progressEntryIds: ["forge_pe_1"], sourceFingerprint: "b".repeat(32),
    });
    const response = await GET(
      new Request("https://test/x?targetType=TAKEOFF_LINE&targetId=forge_line_1&asOf=2026-11-15"),
      { params: params() },
    );
    expect(response.status).toBe(200);
    expect(getFieldVerificationSources).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1",
      targetType: "TAKEOFF_LINE", targetId: "forge_line_1", asOf: "2026-11-15",
    });
    const body = await response.json();
    expect(body.sourceFingerprint).toBe("b".repeat(32));
    expect(body.installedAsOf).toBe(12.5);
  });

  it("returns the service error status", async () => {
    getFieldVerificationSources.mockResolvedValue({ ok: false, httpStatus: 400, error: "Choose a step or a takeoff line to verify." });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(400);
  });

  it("returns the auth error untouched", async () => {
    workAuth.mockResolvedValue({ error: Response.json({ error: "Unauthorized." }, { status: 401 }) });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(401);
    expect(getFieldVerificationSources).not.toHaveBeenCalled();
  });
});
