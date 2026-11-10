import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => request.json(),
}));
vi.mock("@/application/work-management/plannerAdmin", () => ({
  assignRole: vi.fn(),
}));

import { workAuth } from "../../_lib/auth.js";
import { assignRole } from "@/application/work-management/plannerAdmin";
import { POST } from "./route.js";

const request = (body) =>
  new Request("https://test/api/work-packages/admin/assignments", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/work-packages/admin/assignments", () => {
  it("assigns a role and returns 201", async () => {
    workAuth.mockResolvedValue({ db: {}, ownerId: "owner_1", actor: "owner_1" });
    assignRole.mockResolvedValue({ ok: true, assignment: { id: "assign_1", role_id: "role_1" } });
    const response = await POST(request({ assigneeUserId: "staff_1", roleId: "role_1" }));
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.assignment.role_id).toBe("role_1");
  });

  it("rejects assigning the owner/co-owner with a 403", async () => {
    workAuth.mockResolvedValue({ db: {}, ownerId: "owner_1", actor: "owner_1" });
    assignRole.mockResolvedValue({ ok: false, httpStatus: 403, error: "The owner and active co-owners already have full access and cannot be assigned a role." });
    const response = await POST(request({ assigneeUserId: "owner_1", roleId: "role_1" }));
    expect(response.status).toBe(403);
  });
});
