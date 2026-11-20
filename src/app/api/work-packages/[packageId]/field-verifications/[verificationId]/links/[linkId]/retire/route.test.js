import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  requirePackageScope: vi.fn(async () => null),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/fieldVerifications", () => ({
  unlinkFieldVerificationLink: vi.fn(),
}));

import { workAuth, requirePackageScope } from "../../../../../../_lib/auth.js";
import { unlinkFieldVerificationLink } from "@/application/work-management/fieldVerifications";
import { POST } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1", verificationId: "forge_wpfv_1", linkId: "forge_wpfvl_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
  requirePackageScope.mockResolvedValue(null);
});

describe("POST /api/work-packages/[packageId]/field-verifications/[verificationId]/links/[linkId]/retire", () => {
  it("unlinks with the required reason", async () => {
    unlinkFieldVerificationLink.mockResolvedValue({
      ok: true, link: { id: "forge_wpfvl_1", retiredAt: "t2", version: 2 },
    });
    const response = await POST(
      new Request("https://test/x", {
        method: "POST",
        body: JSON.stringify({ expectedVersion: 1, reason: "Wrong bust." }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(200);
    expect(unlinkFieldVerificationLink).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1", verificationId: "forge_wpfv_1",
      linkId: "forge_wpfvl_1", expectedVersion: 1, reason: "Wrong bust.",
    });
    expect((await response.json()).link.retiredAt).toBe("t2");
  });

  it("returns the auth error untouched", async () => {
    workAuth.mockResolvedValue({ error: Response.json({ error: "Unauthorized." }, { status: 401 }) });
    const response = await POST(
      new Request("https://test/x", { method: "POST", body: JSON.stringify({ expectedVersion: 1, reason: "Wrong bust." }) }),
      { params: params() },
    );
    expect(response.status).toBe(401);
    expect(unlinkFieldVerificationLink).not.toHaveBeenCalled();
  });
});
