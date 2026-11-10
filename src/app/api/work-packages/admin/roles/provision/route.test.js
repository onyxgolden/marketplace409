import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => request.json(),
}));
vi.mock("@/application/work-management/plannerAdmin", () => ({
  provisionStarterRoles: vi.fn(),
}));

import { workAuth } from "../../../_lib/auth.js";
import { provisionStarterRoles } from "@/application/work-management/plannerAdmin";
import { POST } from "./route.js";

const request = (body = {}) =>
  new Request("https://test/api/work-packages/admin/roles/provision", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/work-packages/admin/roles/provision", () => {
  it("requires an authenticated workspace", async () => {
    workAuth.mockResolvedValue({ error: Response.json({ error: "Sign in required." }, { status: 401 }) });
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(provisionStarterRoles).not.toHaveBeenCalled();
  });

  it("returns the five starter roles on success", async () => {
    workAuth.mockResolvedValue({ db: {}, ownerId: "owner_1", actor: "owner_1" });
    const roles = [{ role_key: "planner_admin" }, { role_key: "planner" }, { role_key: "scheduler" }, { role_key: "reviewer" }, { role_key: "read_only" }];
    provisionStarterRoles.mockResolvedValue({ ok: true, roles });
    const response = await POST(request());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.roles).toHaveLength(5);
  });

  it("surfaces owner-only rejection as 403 for a non-owner caller", async () => {
    workAuth.mockResolvedValue({ db: {}, ownerId: "owner_1", actor: "staff_1" });
    provisionStarterRoles.mockResolvedValue({ ok: false, httpStatus: 403, error: "You do not have permission to do that." });
    const response = await POST(request());
    expect(response.status).toBe(403);
  });
});
