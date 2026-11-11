import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../_lib/auth.js", () => ({
  schedulingAdminAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => request.json(),
}));
vi.mock("@/domains/scheduling/schedulingAdmin", () => ({
  provisionStarterRoles: vi.fn(),
}));

import { schedulingAdminAuth } from "../../_lib/auth.js";
import { provisionStarterRoles } from "@/domains/scheduling/schedulingAdmin";
import { POST } from "./route.js";

const postRequest = (body = {}) =>
  new Request("https://test/api/forge/scheduling/admin/roles/provision", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/forge/scheduling/admin/roles/provision", () => {
  it("provisions the starter roles and returns them", async () => {
    schedulingAdminAuth.mockResolvedValue({ db: {}, ownerId: "owner_1", actor: "owner_1" });
    const roles = [{ role_key: "admin" }, { role_key: "scheduler" }, { role_key: "crew_lead" }, { role_key: "viewer" }];
    provisionStarterRoles.mockResolvedValue({ ok: true, roles });
    const response = await POST(postRequest());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.roles).toEqual(roles);
  });

  it("surfaces an owner-only rejection as 403", async () => {
    schedulingAdminAuth.mockResolvedValue({ db: {}, ownerId: "owner_1", actor: "staff_1" });
    provisionStarterRoles.mockResolvedValue({ ok: false, httpStatus: 403, error: "You do not have permission to do that." });
    const response = await POST(postRequest());
    expect(response.status).toBe(403);
  });
});
