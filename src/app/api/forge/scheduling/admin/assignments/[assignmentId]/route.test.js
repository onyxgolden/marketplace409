import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../_lib/auth.js", () => ({
  schedulingAdminAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => request.json(),
}));
vi.mock("@/domains/scheduling/schedulingAdmin", () => ({
  revokeAssignment: vi.fn(),
}));

import { schedulingAdminAuth } from "../../_lib/auth.js";
import { revokeAssignment } from "@/domains/scheduling/schedulingAdmin";
import { DELETE } from "./route.js";

const deleteRequest = (body = {}) =>
  new Request("https://test/api/forge/scheduling/admin/assignments/assign_1", { method: "DELETE", body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DELETE /api/forge/scheduling/admin/assignments/[assignmentId]", () => {
  it("revokes the assignment", async () => {
    schedulingAdminAuth.mockResolvedValue({ db: {}, ownerId: "owner_1", actor: "owner_1" });
    revokeAssignment.mockResolvedValue({ ok: true, assignment: { id: "assign_1", retired_at: "t1" } });
    const response = await DELETE(deleteRequest({ expectedVersion: 1 }), { params: Promise.resolve({ assignmentId: "assign_1" }) });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.assignment.id).toBe("assign_1");
    expect(revokeAssignment).toHaveBeenCalledWith({}, expect.objectContaining({ ownerId: "owner_1", assignmentId: "assign_1", expectedVersion: 1 }));
  });

  it("surfaces a self-revoke rejection as 403", async () => {
    schedulingAdminAuth.mockResolvedValue({ db: {}, ownerId: "owner_1", actor: "admin_1" });
    revokeAssignment.mockResolvedValue({ ok: false, httpStatus: 403, error: "You cannot edit your own role or assignment." });
    const response = await DELETE(deleteRequest({ expectedVersion: 1 }), { params: Promise.resolve({ assignmentId: "assign_1" }) });
    expect(response.status).toBe(403);
  });
});
