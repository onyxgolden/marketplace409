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
  retireFieldVerification: vi.fn(),
}));

import { workAuth, requirePackageScope } from "../../../../_lib/auth.js";
import { retireFieldVerification } from "@/application/work-management/fieldVerifications";
import { POST } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1", verificationId: "forge_wpfv_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
  requirePackageScope.mockResolvedValue(null);
});

describe("POST /api/work-packages/[packageId]/field-verifications/[verificationId]/retire", () => {
  it("retires with the required reason", async () => {
    retireFieldVerification.mockResolvedValue({
      ok: true, verification: { id: "forge_wpfv_1", status: "RETIRED", version: 2 },
    });
    const response = await POST(
      new Request("https://test/x", {
        method: "POST",
        body: JSON.stringify({ expectedVersion: 1, reason: "Recorded against the wrong step." }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(200);
    expect(retireFieldVerification).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1", verificationId: "forge_wpfv_1",
      expectedVersion: 1, reason: "Recorded against the wrong step.",
    });
    expect((await response.json()).verification.status).toBe("RETIRED");
  });

  it("returns the missing-reason 400", async () => {
    retireFieldVerification.mockResolvedValue({
      ok: false, httpStatus: 400, error: "A reason is required for this change.",
    });
    const response = await POST(
      new Request("https://test/x", { method: "POST", body: JSON.stringify({ expectedVersion: 1, reason: "" }) }),
      { params: params() },
    );
    expect(response.status).toBe(400);
  });
});
