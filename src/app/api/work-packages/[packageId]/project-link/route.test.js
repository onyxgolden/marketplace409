// Foundation PR B — POST /api/work-packages/[packageId]/project-link.
// The route enforces the active scope first (a package outside the
// scope 404s, non-disclosing), then delegates the link to the RPC
// service with the caller's version + idempotency key.
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  requirePackageScope: vi.fn(async () => null),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => request.json(),
}));
vi.mock("@/application/work-management/projectScope", () => ({
  setPackageProject: vi.fn(),
}));

import { workAuth, requirePackageScope } from "../../_lib/auth.js";
import { setPackageProject } from "@/application/work-management/projectScope";
import { POST } from "./route.js";

const AUTH = { db: {}, ownerId: "owner_1", actor: "user_9", scope: { scope: "PROJECT", forgeProjectId: "forge_prj_1" } };
function request(body) {
  return new Request("https://test/api/work-packages/forge_wp_1/project-link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const PARAMS = Promise.resolve({ packageId: "forge_wp_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
  requirePackageScope.mockResolvedValue(null);
});

describe("POST /api/work-packages/[packageId]/project-link", () => {
  it("returns 401 when unauthenticated", async () => {
    workAuth.mockResolvedValueOnce({ error: Response.json({ error: "no" }, { status: 401 }) });
    const response = await POST(request({ forgeProjectId: "forge_prj_2", expectedVersion: 3, requestId: "req_1" }), { params: PARAMS });
    expect(response.status).toBe(401);
    expect(setPackageProject).not.toHaveBeenCalled();
  });

  it("returns the scope check's 404 when the package is outside the active scope", async () => {
    requirePackageScope.mockResolvedValueOnce(Response.json({ error: "not found" }, { status: 404 }));
    const response = await POST(request({ forgeProjectId: "forge_prj_2", expectedVersion: 3, requestId: "req_1" }), { params: PARAMS });
    expect(response.status).toBe(404);
    expect(setPackageProject).not.toHaveBeenCalled();
  });

  it("links the package through the service with version + request id", async () => {
    setPackageProject.mockResolvedValue({
      ok: true,
      package: { id: "forge_wp_1", code: "WP-0007", version: 4, forge_project_id: "forge_prj_2" },
    });
    const response = await POST(request({ forgeProjectId: "forge_prj_2", expectedVersion: 3, requestId: "req_1", reason: "Moved to Revamp" }), { params: PARAMS });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.package.forge_project_id).toBe("forge_prj_2");
    expect(setPackageProject).toHaveBeenCalledWith({}, {
      ownerId: "owner_1",
      packageId: "forge_wp_1",
      forgeProjectId: "forge_prj_2",
      expectedVersion: 3,
      requestId: "req_1",
      reason: "Moved to Revamp",
    });
  });

  it("passes a null target through for an unlink", async () => {
    setPackageProject.mockResolvedValue({
      ok: true,
      package: { id: "forge_wp_1", code: "WP-0007", version: 5, forge_project_id: null },
    });
    const response = await POST(request({ forgeProjectId: null, expectedVersion: 4, requestId: "req_2" }), { params: PARAMS });
    expect(response.status).toBe(200);
    expect(setPackageProject).toHaveBeenCalledWith({}, expect.objectContaining({ forgeProjectId: null }));
  });

  it("maps a stale version to 409", async () => {
    setPackageProject.mockResolvedValue({
      ok: false, httpStatus: 409,
      error: "This package changed while you were editing — refresh and retry.",
    });
    const response = await POST(request({ forgeProjectId: "forge_prj_2", expectedVersion: 2, requestId: "req_3" }), { params: PARAMS });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toContain("changed while you were editing");
  });
});
