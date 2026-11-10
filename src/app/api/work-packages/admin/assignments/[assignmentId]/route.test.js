import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => request.json(),
}));
vi.mock("@/application/work-management/plannerAdmin", () => ({
  revokeAssignment: vi.fn(),
}));

import { workAuth } from "../../../_lib/auth.js";
import { revokeAssignment } from "@/application/work-management/plannerAdmin";
import { DELETE } from "./route.js";

const request = (body) =>
  new Request("https://test/api/work-packages/admin/assignments/assign_1", { method: "DELETE", body: JSON.stringify(body) });
const params = Promise.resolve({ assignmentId: "assign_1" });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DELETE /api/work-packages/admin/assignments/[assignmentId]", () => {
  it("revokes an assignment", async () => {
    workAuth.mockResolvedValue({ db: {}, ownerId: "owner_1", actor: "owner_1" });
    revokeAssignment.mockResolvedValue({ ok: true, assignment: { id: "assign_1", retired_at: "t1" } });
    const response = await DELETE(request({ expectedVersion: 1 }), { params });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.assignment.retired_at).toBe("t1");
  });

  it("returns 404 when the assignment doesn't exist", async () => {
    workAuth.mockResolvedValue({ db: {}, ownerId: "owner_1", actor: "owner_1" });
    revokeAssignment.mockResolvedValue({ ok: false, httpStatus: 404, error: "Assignment not found." });
    const response = await DELETE(request({ expectedVersion: 1 }), { params });
    expect(response.status).toBe(404);
  });
});
