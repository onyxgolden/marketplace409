// Slice-7 PDF blockers — artifacts list + preview route tests. Same
// scope contract as the intake route: in-scope reaches the service,
// out-of-scope returns the scope 404 without calling it.
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  requirePackageScope: vi.fn(async () => null),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
}));
vi.mock("@/application/work-management/drawingIntake", () => ({
  listArtifacts: vi.fn(),
  getArtifactPreviewUrl: vi.fn(),
}));

import { workAuth, requirePackageScope } from "../../../../_lib/auth.js";
import { listArtifacts, getArtifactPreviewUrl } from "@/application/work-management/drawingIntake";
import { GET } from "./route.js";
import { GET as GET_PREVIEW } from "./[artifactId]/preview/route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = (packageId = "pkg_1", drawingId = "forge_wdwg_1") => Promise.resolve({ packageId, drawingId });
const previewParams = (artifactId = "forge_wpa_1") => Promise.resolve({ packageId: "pkg_1", drawingId: "forge_wdwg_1", artifactId });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
  requirePackageScope.mockResolvedValue(null);
});

describe("GET /api/work-packages/[packageId]/drawings/[drawingId]/artifacts", () => {
  it("lists the drawing's artifacts for an in-scope package", async () => {
    listArtifacts.mockResolvedValue({
      ok: true,
      drawing: { id: "forge_wdwg_1", drawingNumber: "W-0005-1" },
      artifacts: [{ id: "forge_wpa_1", purpose: "ifa_issued" }],
    });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.drawing.drawingNumber).toBe("W-0005-1");
    expect(body.artifacts).toHaveLength(1);
    expect(listArtifacts).toHaveBeenCalledWith(AUTH.db, { ownerId: "owner_1", packageId: "pkg_1", drawingId: "forge_wdwg_1" });
  });

  it("returns the scope 404 and never calls the service when the package is out of scope", async () => {
    requirePackageScope.mockResolvedValue(Response.json({ error: "Work package not found." }, { status: 404 }));
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(404);
    expect(listArtifacts).not.toHaveBeenCalled();
  });

  it("maps a service 404 (drawing in another package) through", async () => {
    listArtifacts.mockResolvedValue({ ok: false, httpStatus: 404, error: "Drawing not found in this package." });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Drawing not found in this package.");
  });
});

describe("GET /api/work-packages/[packageId]/drawings/[drawingId]/artifacts/[artifactId]/preview", () => {
  it("returns the signed preview URL for an in-scope package", async () => {
    getArtifactPreviewUrl.mockResolvedValue({
      ok: true, url: "https://signed.example/controlled.pdf", expiresInSeconds: 3600,
      artifact: { id: "forge_wpa_1" },
    });
    const response = await GET_PREVIEW(new Request("https://test/x"), { params: previewParams() });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.url).toBe("https://signed.example/controlled.pdf");
    expect(getArtifactPreviewUrl).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1", drawingId: "forge_wdwg_1", artifactId: "forge_wpa_1",
    });
  });

  it("returns the scope 404 and never calls the service when the package is out of scope", async () => {
    requirePackageScope.mockResolvedValue(Response.json({ error: "Work package not found." }, { status: 404 }));
    const response = await GET_PREVIEW(new Request("https://test/x"), { params: previewParams() });
    expect(response.status).toBe(404);
    expect(getArtifactPreviewUrl).not.toHaveBeenCalled();
  });
});
