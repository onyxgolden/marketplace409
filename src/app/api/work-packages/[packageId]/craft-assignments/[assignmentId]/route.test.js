import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  requirePackageScope: vi.fn(async () => null),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/craftAssignments", () => ({
  updateCraftAssignment: vi.fn(),
}));

import { workAuth } from "../../../_lib/auth.js";
import { updateCraftAssignment } from "@/application/work-management/craftAssignments";
import { PATCH } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1", assignmentId: "forge_wpca_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("PATCH /api/work-packages/[packageId]/craft-assignments/[assignmentId]", () => {
  it("forwards the patch body to the service", async () => {
    updateCraftAssignment.mockResolvedValue({ ok: true, assignment: { id: "forge_wpca_1", version: 2 } });
    const response = await PATCH(
      new Request("https://test/x", {
        method: "PATCH",
        body: JSON.stringify({ expectedVersion: 1, crewSize: 4, note: null, reason: "Reduced crew" }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(200);
    expect(updateCraftAssignment).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1",
      packageId: "pkg_1",
      assignmentId: "forge_wpca_1",
      patch: { expectedVersion: 1, crewSize: 4, note: null, reason: "Reduced crew" },
    });
  });

  it("returns the service error status on a version conflict", async () => {
    updateCraftAssignment.mockResolvedValue({
      ok: false, httpStatus: 409, error: "This craft assignment was changed by someone else — refresh and try again.",
    });
    const response = await PATCH(
      new Request("https://test/x", {
        method: "PATCH",
        body: JSON.stringify({ expectedVersion: 1, crewSize: 4 }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(409);
  });
});
