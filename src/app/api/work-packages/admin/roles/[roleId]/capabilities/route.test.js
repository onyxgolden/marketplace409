import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => request.json(),
}));
vi.mock("@/application/work-management/plannerAdmin", () => ({
  setRoleCapability: vi.fn(),
}));

import { workAuth } from "../../../../_lib/auth.js";
import { setRoleCapability } from "@/application/work-management/plannerAdmin";
import { PATCH } from "./route.js";

const request = (body) =>
  new Request("https://test/api/work-packages/admin/roles/role_1/capabilities", { method: "PATCH", body: JSON.stringify(body) });
const params = Promise.resolve({ roleId: "role_1" });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/work-packages/admin/roles/[roleId]/capabilities", () => {
  it("grants a capability and returns the updated role", async () => {
    workAuth.mockResolvedValue({ db: {}, ownerId: "owner_1", actor: "owner_1" });
    setRoleCapability.mockResolvedValue({ ok: true, role: { id: "role_1", version: 2 } });
    const response = await PATCH(request({ capabilityKey: "planner.packages.read", grant: true, expectedVersion: 1 }), { params });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.role.version).toBe(2);
    expect(setRoleCapability).toHaveBeenCalledWith({}, expect.objectContaining({
      ownerId: "owner_1", roleId: "role_1", capabilityKey: "planner.packages.read", grant: true, expectedVersion: 1,
    }));
  });

  it("returns 409 on a stale expectedVersion", async () => {
    workAuth.mockResolvedValue({ db: {}, ownerId: "owner_1", actor: "owner_1" });
    setRoleCapability.mockResolvedValue({ ok: false, httpStatus: 409, error: "This role or assignment was changed by someone else. Reload and try again." });
    const response = await PATCH(request({ capabilityKey: "planner.packages.read", grant: true, expectedVersion: 1 }), { params });
    expect(response.status).toBe(409);
  });

  it("coerces a falsy/missing grant to false rather than passing undefined through", async () => {
    workAuth.mockResolvedValue({ db: {}, ownerId: "owner_1", actor: "owner_1" });
    setRoleCapability.mockResolvedValue({ ok: true, role: {} });
    await PATCH(request({ capabilityKey: "planner.packages.read", expectedVersion: 1 }), { params });
    expect(setRoleCapability).toHaveBeenCalledWith({}, expect.objectContaining({ grant: false }));
  });
});
