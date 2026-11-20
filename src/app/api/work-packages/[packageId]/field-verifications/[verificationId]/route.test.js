import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  requirePackageScope: vi.fn(async () => null),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/fieldVerifications", () => ({
  getFieldVerificationDetail: vi.fn(),
  updateFieldVerification: vi.fn(),
}));

import { workAuth, requirePackageScope } from "../../../_lib/auth.js";
import { getFieldVerificationDetail, updateFieldVerification } from "@/application/work-management/fieldVerifications";
import { GET, PATCH } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1", verificationId: "forge_wpfv_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
  requirePackageScope.mockResolvedValue(null);
});

describe("GET /api/work-packages/[packageId]/field-verifications/[verificationId]", () => {
  it("returns the verification with its history and links", async () => {
    getFieldVerificationDetail.mockResolvedValue({
      ok: true,
      verification: { id: "forge_wpfv_1", status: "DRAFT" },
      revisions: [{ id: "forge_wpfvr_1", action: "create" }],
      links: [],
      activeLinks: [],
    });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(200);
    expect(getFieldVerificationDetail).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1", verificationId: "forge_wpfv_1",
    });
    const body = await response.json();
    expect(body.verification.id).toBe("forge_wpfv_1");
    expect(body.revisions).toHaveLength(1);
  });

  it("returns the service error status", async () => {
    getFieldVerificationDetail.mockResolvedValue({ ok: false, httpStatus: 404, error: "Field verification not found." });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(404);
  });

  it("returns the auth error untouched", async () => {
    workAuth.mockResolvedValue({ error: Response.json({ error: "Unauthorized." }, { status: 401 }) });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(401);
    expect(getFieldVerificationDetail).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/work-packages/[packageId]/field-verifications/[verificationId]", () => {
  it("updates with the set flags and the required reason", async () => {
    updateFieldVerification.mockResolvedValue({
      ok: true, verification: { id: "forge_wpfv_1", status: "DRAFT", version: 2 },
    });
    const response = await PATCH(
      new Request("https://test/x", {
        method: "PATCH",
        body: JSON.stringify({
          expectedVersion: 1,
          setObservationNote: true, observationNote: "Corrected note.",
          reason: "Typo in the note.",
        }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(200);
    expect(updateFieldVerification).toHaveBeenCalledWith(AUTH.db, expect.objectContaining({
      ownerId: "owner_1", packageId: "pkg_1", verificationId: "forge_wpfv_1",
      expectedVersion: 1, setObservationNote: true, observationNote: "Corrected note.",
      setEvidenceRef: false, reason: "Typo in the note.",
    }));
    expect((await response.json()).verification.version).toBe(2);
  });

  it("returns the version-conflict 409", async () => {
    updateFieldVerification.mockResolvedValue({
      ok: false, httpStatus: 409,
      error: "This verification changed since you loaded it. Reload it and try again.",
    });
    const response = await PATCH(
      new Request("https://test/x", {
        method: "PATCH",
        body: JSON.stringify({ expectedVersion: 1, reason: "Fixing a typo." }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(409);
  });
});
