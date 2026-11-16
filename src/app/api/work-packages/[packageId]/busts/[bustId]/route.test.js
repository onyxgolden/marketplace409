import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  requirePackageScope: vi.fn(async () => null),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/busts", () => ({
  getBustDetail: vi.fn(),
  updateBust: vi.fn(),
}));

import { workAuth, requirePackageScope } from "../../../_lib/auth.js";
import { getBustDetail, updateBust } from "@/application/work-management/busts";
import { GET, PATCH } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1", bustId: "forge_wpbust_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
  requirePackageScope.mockResolvedValue(null);
});

describe("GET /api/work-packages/[packageId]/busts/[bustId]", () => {
  it("returns the bust with its history and links", async () => {
    getBustDetail.mockResolvedValue({
      ok: true,
      bust: { id: "forge_wpbust_1", status: "OPEN", version: 1 },
      revisions: [{ version: 1, action: "create" }],
      links: [{ id: "forge_wpbustco_1", changeOrderId: "co_2" }],
      activeLinks: [{ id: "forge_wpbustco_1" }],
    });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(200);
    expect(getBustDetail).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1", bustId: "forge_wpbust_1",
    });
    const body = await response.json();
    expect(body.bust.id).toBe("forge_wpbust_1");
    expect(body.revisions).toHaveLength(1);
    expect(body.activeLinks).toHaveLength(1);
  });

  it("returns 404 when the bust is not in this package", async () => {
    getBustDetail.mockResolvedValue({ ok: false, httpStatus: 404, error: "Bust not found in this work package." });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Bust not found in this work package.");
  });

  it("returns the auth error untouched", async () => {
    workAuth.mockResolvedValue({ error: Response.json({ error: "Unauthorized." }, { status: 401 }) });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(401);
    expect(getBustDetail).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/work-packages/[packageId]/busts/[bustId]", () => {
  it("updates the evidence with the version guard and reason", async () => {
    updateBust.mockResolvedValue({
      ok: true,
      bust: { id: "forge_wpbust_1", status: "OPEN", version: 2 },
    });
    const response = await PATCH(
      new Request("https://test/x", {
        method: "PATCH",
        body: JSON.stringify({
          expectedVersion: 1,
          evidenceSummary: "Revised evidence: the overrun is confirmed by the signed timesheets.",
          setEvidenceSummary: true,
          reason: "Corrected the evidence wording.",
        }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(200);
    expect(updateBust).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1", bustId: "forge_wpbust_1",
      expectedVersion: 1,
      evidenceSummary: "Revised evidence: the overrun is confirmed by the signed timesheets.",
      setEvidenceSummary: true,
      evidenceRef: null, setEvidenceRef: false,
      reason: "Corrected the evidence wording.",
    });
    expect((await response.json()).bust.version).toBe(2);
  });

  it("returns 409 on a stale version", async () => {
    updateBust.mockResolvedValue({ ok: false, httpStatus: 409, error: "This bust changed since you loaded it. Reload and try again." });
    const response = await PATCH(
      new Request("https://test/x", {
        method: "PATCH",
        body: JSON.stringify({ expectedVersion: 1, reason: "x".repeat(10) }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(409);
  });

  it("returns the auth error untouched", async () => {
    workAuth.mockResolvedValue({ error: Response.json({ error: "Unauthorized." }, { status: 401 }) });
    const response = await PATCH(
      new Request("https://test/x", { method: "PATCH", body: JSON.stringify({ expectedVersion: 1 }) }),
      { params: params() },
    );
    expect(response.status).toBe(401);
    expect(updateBust).not.toHaveBeenCalled();
  });
});
