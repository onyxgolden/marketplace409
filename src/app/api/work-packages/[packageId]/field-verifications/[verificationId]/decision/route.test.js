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
  decideFieldVerification: vi.fn(),
}));

import { workAuth, requirePackageScope } from "../../../../_lib/auth.js";
import { decideFieldVerification } from "@/application/work-management/fieldVerifications";
import { POST } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1", verificationId: "forge_wpfv_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
  requirePackageScope.mockResolvedValue(null);
});

describe("POST /api/work-packages/[packageId]/field-verifications/[verificationId]/decision", () => {
  it("accepts with the reviewed fingerprint and the review statement", async () => {
    decideFieldVerification.mockResolvedValue({
      ok: true, verification: { id: "forge_wpfv_1", status: "ACCEPTED", version: 3 },
    });
    const response = await POST(
      new Request("https://test/x", {
        method: "POST",
        body: JSON.stringify({
          action: "accept", expectedVersion: 2,
          sourceFingerprint: "b".repeat(32),
          reviewNote: "Checked the welds against R2; matches.",
          requestId: "req_1",
        }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(200);
    expect(decideFieldVerification).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1", verificationId: "forge_wpfv_1",
      action: "accept", expectedVersion: 2, sourceFingerprint: "b".repeat(32),
      reason: null, reviewNote: "Checked the welds against R2; matches.", requestId: "req_1",
    });
    expect((await response.json()).verification.status).toBe("ACCEPTED");
  });

  it("returns the self-review 409", async () => {
    decideFieldVerification.mockResolvedValue({
      ok: false, httpStatus: 409,
      error: "The reviewer must be a different person from the submitter. Ask another workspace member to review it.",
    });
    const response = await POST(
      new Request("https://test/x", {
        method: "POST",
        body: JSON.stringify({ action: "accept", expectedVersion: 2, sourceFingerprint: "b".repeat(32), reviewNote: "Looks good." }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(409);
  });

  it("returns the auth error untouched", async () => {
    workAuth.mockResolvedValue({ error: Response.json({ error: "Unauthorized." }, { status: 401 }) });
    const response = await POST(
      new Request("https://test/x", { method: "POST", body: JSON.stringify({ action: "submit", expectedVersion: 1 }) }),
      { params: params() },
    );
    expect(response.status).toBe(401);
    expect(decideFieldVerification).not.toHaveBeenCalled();
  });
});
