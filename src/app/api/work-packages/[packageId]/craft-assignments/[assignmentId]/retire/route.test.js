import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  requirePackageScope: vi.fn(async () => null),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/craftAssignments", () => ({
  retireCraftAssignment: vi.fn(),
}));

import { workAuth } from "../../../../_lib/auth.js";
import { retireCraftAssignment } from "@/application/work-management/craftAssignments";
import { POST } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1", assignmentId: "forge_wpca_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("POST /api/work-packages/[packageId]/craft-assignments/[assignmentId]/retire", () => {
  it("forwards version, reason and correction flag to the service", async () => {
    retireCraftAssignment.mockResolvedValue({ ok: true, assignment: { id: "forge_wpca_1", version: 2, retiredAt: "t2" } });
    const response = await POST(
      new Request("https://test/x", {
        method: "POST",
        body: JSON.stringify({ expectedVersion: 1, reason: "Crew stood down", historicalCorrection: false }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(200);
    expect(retireCraftAssignment).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1",
      packageId: "pkg_1",
      assignmentId: "forge_wpca_1",
      expectedVersion: 1,
      reason: "Crew stood down",
      historicalCorrection: false,
    });
  });

  it("returns 400 when the service requires a reason", async () => {
    retireCraftAssignment.mockResolvedValue({ ok: false, httpStatus: 400, error: "reason is required and must be at most 1000 characters." });
    const response = await POST(
      new Request("https://test/x", { method: "POST", body: JSON.stringify({ expectedVersion: 1, reason: "" }) }),
      { params: params() },
    );
    expect(response.status).toBe(400);
  });
});
