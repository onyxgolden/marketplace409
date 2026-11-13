import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  requirePackageScope: vi.fn(async () => null),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/drawingReviews", () => ({
  createIfcRelease: vi.fn(),
  listIfcReleases: vi.fn(),
}));

import { workAuth } from "../../../../_lib/auth.js";
import { createIfcRelease, listIfcReleases } from "@/application/work-management/drawingReviews";
import { GET, POST } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1", drawingId: "dwg_1" });
const SHA = "a".repeat(64);

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("GET ifc-releases", () => {
  it("lists releases for the drawing", async () => {
    listIfcReleases.mockResolvedValue({
      ok: true,
      drawing: { id: "dwg_1", drawingNumber: "P-101" },
      releases: [{ id: "forge_wpdifc_1", ifcRevisionId: "forge_wpdrv_2" }],
    });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(200);
    expect(listIfcReleases).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1", drawingId: "dwg_1", limit: null, offset: null,
    });
    expect((await response.json()).releases).toHaveLength(1);
  });
});

describe("POST ifc-releases", () => {
  it("issues an IFC revision and returns 201", async () => {
    createIfcRelease.mockResolvedValue({
      ok: true, release: { id: "forge_wpdifc_1", ifcRevisionId: "forge_wpdrv_2" },
    });
    const input = {
      reviewId: "forge_wpdrvw_1", ifcRevisionCode: "C",
      documentRef: "s3://forge/p-101-c.pdf", contentSha256: SHA,
    };
    const response = await POST(
      new Request("https://test/x", { method: "POST", body: JSON.stringify(input) }),
      { params: params() },
    );
    expect(response.status).toBe(201);
    expect(createIfcRelease).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1", drawingId: "dwg_1", input,
    });
  });

  it("forwards an unapproved review as 409", async () => {
    createIfcRelease.mockResolvedValue({ ok: false, httpStatus: 409, error: "Only an approved review can issue an IFC revision." });
    const response = await POST(
      new Request("https://test/x", {
        method: "POST",
        body: JSON.stringify({
          reviewId: "forge_wpdrvw_1", ifcRevisionCode: "C",
          documentRef: "s3://forge/p-101-c.pdf", contentSha256: SHA,
        }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(409);
  });
});
