import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  requirePackageScope: vi.fn(async () => null),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/fieldVerifications", () => ({
  linkFieldVerificationTarget: vi.fn(),
}));

import { workAuth, requirePackageScope } from "../../../../_lib/auth.js";
import { linkFieldVerificationTarget } from "@/application/work-management/fieldVerifications";
import { POST } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1", verificationId: "forge_wpfv_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
  requirePackageScope.mockResolvedValue(null);
});

describe("POST /api/work-packages/[packageId]/field-verifications/[verificationId]/links", () => {
  it("links with 201 and the created link", async () => {
    linkFieldVerificationTarget.mockResolvedValue({
      ok: true, link: { id: "forge_wpfvl_1", targetKind: "BUST", targetLabel: "Bust — QUANTITY (OPEN)" },
    });
    const response = await POST(
      new Request("https://test/x", {
        method: "POST",
        body: JSON.stringify({ targetKind: "BUST", targetId: "forge_bust_1", requestId: "req_1" }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(201);
    expect(linkFieldVerificationTarget).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1", verificationId: "forge_wpfv_1",
      targetKind: "BUST", targetId: "forge_bust_1", requestId: "req_1", reason: null,
    });
    expect((await response.json()).link.targetLabel).toBe("Bust — QUANTITY (OPEN)");
  });

  it("returns the duplicate-link 409", async () => {
    linkFieldVerificationTarget.mockResolvedValue({
      ok: false, httpStatus: 409, error: "That link is already attached to this verification.",
    });
    const response = await POST(
      new Request("https://test/x", {
        method: "POST",
        body: JSON.stringify({ targetKind: "BUST", targetId: "forge_bust_1" }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(409);
  });
});
