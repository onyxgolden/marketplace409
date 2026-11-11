import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../_lib/auth.js", () => ({
  schedulingAdminAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => request.json(),
}));
vi.mock("@/domains/scheduling/schedulingAdmin", () => ({
  setRoleCapability: vi.fn(),
}));

import { schedulingAdminAuth } from "../../../_lib/auth.js";
import { setRoleCapability } from "@/domains/scheduling/schedulingAdmin";
import { PATCH } from "./route.js";

const patchRequest = (body) =>
  new Request("https://test/api/forge/scheduling/admin/roles/role_1/capabilities", { method: "PATCH", body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/forge/scheduling/admin/roles/[roleId]/capabilities", () => {
  it("grants a capability and returns the updated role", async () => {
    schedulingAdminAuth.mockResolvedValue({ db: {}, ownerId: "owner_1", actor: "owner_1" });
    setRoleCapability.mockResolvedValue({ ok: true, role: { id: "role_1", version: 2 } });
    const response = await PATCH(patchRequest({ capabilityKey: "scheduling.schedules.read", grant: true, expectedVersion: 1 }), { params: Promise.resolve({ roleId: "role_1" }) });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.role.version).toBe(2);
    expect(setRoleCapability).toHaveBeenCalledWith({}, expect.objectContaining({ ownerId: "owner_1", roleId: "role_1", capabilityKey: "scheduling.schedules.read", grant: true, expectedVersion: 1 }));
  });

  it("surfaces a stale-version conflict as 409", async () => {
    schedulingAdminAuth.mockResolvedValue({ db: {}, ownerId: "owner_1", actor: "owner_1" });
    setRoleCapability.mockResolvedValue({ ok: false, httpStatus: 409, error: "This role or assignment was changed by someone else. Reload and try again." });
    const response = await PATCH(patchRequest({ capabilityKey: "scheduling.schedules.read", grant: true, expectedVersion: 1 }), { params: Promise.resolve({ roleId: "role_1" }) });
    expect(response.status).toBe(409);
  });

  it("coerces a truthy/falsy grant value to a real boolean", async () => {
    schedulingAdminAuth.mockResolvedValue({ db: {}, ownerId: "owner_1", actor: "owner_1" });
    setRoleCapability.mockResolvedValue({ ok: true, role: {} });
    await PATCH(patchRequest({ capabilityKey: "scheduling.schedules.read", grant: "true", expectedVersion: 1 }), { params: Promise.resolve({ roleId: "role_1" }) });
    expect(setRoleCapability.mock.calls[0][1].grant).toBe(true);
  });
});
