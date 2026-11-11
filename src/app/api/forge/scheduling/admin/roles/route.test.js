import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../_lib/auth.js", () => ({
  schedulingAdminAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => request.json(),
}));
vi.mock("@/domains/scheduling/schedulingAdmin", () => ({
  getRolesSnapshot: vi.fn(),
  createRole: vi.fn(),
}));

import { schedulingAdminAuth } from "../_lib/auth.js";
import { getRolesSnapshot, createRole } from "@/domains/scheduling/schedulingAdmin";
import { GET, POST } from "./route.js";

const getRequest = () => new Request("https://test/api/forge/scheduling/admin/roles");
const postRequest = (body) =>
  new Request("https://test/api/forge/scheduling/admin/roles", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/forge/scheduling/admin/roles", () => {
  it("requires an authenticated workspace (401)", async () => {
    schedulingAdminAuth.mockResolvedValue({ error: Response.json({ error: "Sign in required." }, { status: 401 }) });
    const response = await GET(getRequest());
    expect(response.status).toBe(401);
    expect(getRolesSnapshot).not.toHaveBeenCalled();
  });

  it("returns the snapshot for the effective owner only", async () => {
    schedulingAdminAuth.mockResolvedValue({ db: {}, ownerId: "owner_1", actor: "user_9" });
    getRolesSnapshot.mockResolvedValue({ ok: true, snapshot: { roles: [], capabilities: [], assignments: [] } });
    const response = await GET(getRequest());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.snapshot).toEqual({ roles: [], capabilities: [], assignments: [] });
    expect(getRolesSnapshot).toHaveBeenCalledWith({}, { ownerId: "owner_1" });
  });

  it("reports 503 before the migration is applied", async () => {
    schedulingAdminAuth.mockResolvedValue({ db: {}, ownerId: "owner_1", actor: "user_9" });
    getRolesSnapshot.mockResolvedValue({ ok: false, httpStatus: 503, error: "Scheduling role administration is not available yet." });
    const response = await GET(getRequest());
    expect(response.status).toBe(503);
  });
});

describe("POST /api/forge/scheduling/admin/roles", () => {
  it("creates a role and returns 201", async () => {
    schedulingAdminAuth.mockResolvedValue({ db: {}, ownerId: "owner_1", actor: "owner_1" });
    createRole.mockResolvedValue({ ok: true, role: { id: "forge_sr_1", role_key: "custom" } });
    const response = await POST(postRequest({ roleKey: "custom", name: "Custom" }));
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.role.role_key).toBe("custom");
  });

  it("surfaces an owner-only rejection as 403", async () => {
    schedulingAdminAuth.mockResolvedValue({ db: {}, ownerId: "owner_1", actor: "staff_1" });
    createRole.mockResolvedValue({ ok: false, httpStatus: 403, error: "You do not have permission to do that." });
    const response = await POST(postRequest({ roleKey: "custom", name: "Custom" }));
    expect(response.status).toBe(403);
  });

  it("generates a request id when the caller doesn't supply one", async () => {
    schedulingAdminAuth.mockResolvedValue({ db: {}, ownerId: "owner_1", actor: "owner_1" });
    createRole.mockResolvedValue({ ok: true, role: {} });
    await POST(postRequest({ roleKey: "custom", name: "Custom" }));
    const call = createRole.mock.calls[0][1];
    expect(typeof call.requestId).toBe("string");
    expect(call.requestId.length).toBeGreaterThan(0);
  });
});
