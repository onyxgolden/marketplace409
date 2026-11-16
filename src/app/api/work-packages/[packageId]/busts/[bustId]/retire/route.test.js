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
  retireBust: vi.fn(),
}));

import { workAuth, requirePackageScope } from "../../../../_lib/auth.js";
import { retireBust } from "@/application/work-management/busts";
import { POST } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1", bustId: "forge_wpbust_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
  requirePackageScope.mockResolvedValue(null);
});

describe("POST /api/work-packages/[packageId]/busts/[bustId]/retire", () => {
  it("retires the bust version-guarded with a reason", async () => {
    retireBust.mockResolvedValue({
      ok: true,
      bust: { id: "forge_wpbust_1", status: "RETIRED", version: 2 },
    });
    const response = await POST(
      new Request("https://test/x", {
        method: "POST",
        body: JSON.stringify({ expectedVersion: 1, reason: "Duplicate of a re-detected bust." }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(200);
    expect(retireBust).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1", bustId: "forge_wpbust_1",
      expectedVersion: 1, reason: "Duplicate of a re-detected bust.",
    });
    expect((await response.json()).bust.status).toBe("RETIRED");
  });

  it("returns 409 when the bust is already retired", async () => {
    retireBust.mockResolvedValue({ ok: false, httpStatus: 409, error: "This bust is already retired." });
    const response = await POST(
      new Request("https://test/x", {
        method: "POST",
        body: JSON.stringify({ expectedVersion: 2, reason: "Retiring again." }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(409);
  });

  it("returns the auth error untouched", async () => {
    workAuth.mockResolvedValue({ error: Response.json({ error: "Unauthorized." }, { status: 401 }) });
    const response = await POST(
      new Request("https://test/x", { method: "POST", body: JSON.stringify({ expectedVersion: 1, reason: "Retiring." }) }),
      { params: params() },
    );
    expect(response.status).toBe(401);
    expect(retireBust).not.toHaveBeenCalled();
  });

  it("returns the package-scope failure untouched", async () => {
    requirePackageScope.mockResolvedValue(Response.json({ error: "Package not found." }, { status: 404 }));
    const response = await POST(
      new Request("https://test/x", { method: "POST", body: JSON.stringify({ expectedVersion: 1, reason: "Retiring." }) }),
      { params: params() },
    );
    expect(response.status).toBe(404);
    expect(retireBust).not.toHaveBeenCalled();
  });
});
