import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  requirePackageScope: vi.fn(async () => null),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/busts", () => ({
  transitionBust: vi.fn(),
}));

import { workAuth, requirePackageScope } from "../../../../_lib/auth.js";
import { transitionBust } from "@/application/work-management/busts";
import { POST } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1", bustId: "forge_wpbust_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
  requirePackageScope.mockResolvedValue(null);
});

describe("POST /api/work-packages/[packageId]/busts/[bustId]/transition", () => {
  it("moves the bust with the disposition and baseline proofs", async () => {
    transitionBust.mockResolvedValue({
      ok: true,
      bust: { id: "forge_wpbust_1", status: "RESOLVED_BY_CHANGE", version: 5 },
    });
    const response = await POST(
      new Request("https://test/x", {
        method: "POST",
        body: JSON.stringify({
          expectedVersion: 4,
          toStatus: "RESOLVED_BY_CHANGE",
          dispositionReason: "Resolved by change.",
          resolvedBaselineId: "base_2",
          reason: "Closing the bust against the new baseline.",
        }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(200);
    expect(transitionBust).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1", bustId: "forge_wpbust_1",
      expectedVersion: 4, toStatus: "RESOLVED_BY_CHANGE",
      dispositionReason: "Resolved by change.",
      resolvedBaselineId: "base_2",
      reason: "Closing the bust against the new baseline.",
    });
    expect((await response.json()).bust.status).toBe("RESOLVED_BY_CHANGE");
  });

  it("returns 400 when the disposition proof is missing", async () => {
    transitionBust.mockResolvedValue({
      ok: false, httpStatus: 400,
      error: "Resolving by change needs a linked approved change order.",
    });
    const response = await POST(
      new Request("https://test/x", {
        method: "POST",
        body: JSON.stringify({ expectedVersion: 2, toStatus: "RESOLVED_BY_CHANGE", reason: "Closing it." }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("approved change order");
  });

  it("returns the auth error untouched", async () => {
    workAuth.mockResolvedValue({ error: Response.json({ error: "Unauthorized." }, { status: 401 }) });
    const response = await POST(
      new Request("https://test/x", { method: "POST", body: JSON.stringify({ expectedVersion: 1, toStatus: "UNDER_REVIEW" }) }),
      { params: params() },
    );
    expect(response.status).toBe(401);
    expect(transitionBust).not.toHaveBeenCalled();
  });

  it("returns the package-scope failure untouched", async () => {
    requirePackageScope.mockResolvedValue(Response.json({ error: "Package not found." }, { status: 404 }));
    const response = await POST(
      new Request("https://test/x", { method: "POST", body: JSON.stringify({ expectedVersion: 1, toStatus: "UNDER_REVIEW" }) }),
      { params: params() },
    );
    expect(response.status).toBe(404);
    expect(transitionBust).not.toHaveBeenCalled();
  });
});
