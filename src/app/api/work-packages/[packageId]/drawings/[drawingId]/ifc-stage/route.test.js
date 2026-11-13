// Slice-7 PDF blockers — IFC stage route test: same scope contract as
// the intake route (in-scope reaches the service, out-of-scope returns
// the scope 404 without calling it), staging bytes with no revision.
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  requirePackageScope: vi.fn(async () => null),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
}));
vi.mock("@/application/work-management/drawingIntake", () => ({
  stageIfcArtifact: vi.fn(),
}));

import { workAuth, requirePackageScope } from "../../../../_lib/auth.js";
import { stageIfcArtifact } from "@/application/work-management/drawingIntake";
import { MAX_PDF_BYTES, MAX_UPLOAD_BYTES } from "@/domains/work-management/drawingReviews.js";
import { POST } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1", drawingId: "forge_wdwg_1" });
const PDF = new TextEncoder().encode("%PDF-1.7\n%ifc candidate\n%%EOF\n");

function stageRequest() {
  const form = new FormData();
  form.append("file", new File([PDF], "W-0005-1-IFC.pdf", { type: "application/pdf" }));
  form.append("requestId", "req-stage");
  return new Request("https://test/x", { method: "POST", body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
  requirePackageScope.mockResolvedValue(null);
});

describe("POST /api/work-packages/[packageId]/drawings/[drawingId]/ifc-stage", () => {
  it("stages the IFC bytes for an in-scope package and returns 201", async () => {
    stageIfcArtifact.mockResolvedValue({
      ok: true, replayed: false, artifact: { id: "forge_wpa_2", purpose: "ifc_candidate" },
    });
    const response = await POST(stageRequest(), { params: params() });
    expect(response.status).toBe(201);
    expect((await response.json()).artifact.purpose).toBe("ifc_candidate");
    expect(stageIfcArtifact).toHaveBeenCalledTimes(1);
    const args = stageIfcArtifact.mock.calls[0][1];
    expect(args.drawingId).toBe("forge_wdwg_1");
    expect(args.input.requestId).toBe("req-stage");
    expect(args.file.originalFilename).toBe("W-0005-1-IFC.pdf");
  });

  it("returns the scope 404 and never calls the service when the package is out of scope", async () => {
    requirePackageScope.mockResolvedValue(Response.json({ error: "Work package not found." }, { status: 404 }));
    const response = await POST(stageRequest(), { params: params() });
    expect(response.status).toBe(404);
    expect(stageIfcArtifact).not.toHaveBeenCalled();
  });

  it("maps the same-digest guard to 409", async () => {
    stageIfcArtifact.mockResolvedValue({
      ok: false, httpStatus: 409,
      error: "The staged file is identical to the latest issued revision — IFC needs a different drafter-issued PDF.",
    });
    const response = await POST(stageRequest(), { params: params() });
    expect(response.status).toBe(409);
  });

  // Fix round 1: same pre-buffer size enforcement as the intake
  // route — an oversized file never reaches the service and its bytes
  // are never read; an over-limit declared body is refused first.
  it("rejects a file larger than 25 MB without invoking the service or reading its bytes", async () => {
    const bigBytes = new Uint8Array(MAX_PDF_BYTES + 1);
    bigBytes.set(new TextEncoder().encode("%PDF-1.7\n"));
    const bigFile = new File([bigBytes], "big.pdf", { type: "application/pdf" });
    const arrayBufferSpy = vi.spyOn(bigFile, "arrayBuffer");
    const form = new FormData();
    form.append("file", bigFile);
    form.append("requestId", "req-big");
    const response = await POST(new Request("https://test/x", { method: "POST", body: form }), { params: params() });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("too large");
    expect(stageIfcArtifact).not.toHaveBeenCalled();
    expect(arrayBufferSpy).not.toHaveBeenCalled();
  });

  it("rejects a declared Content-Length above the upload limit before parsing the body", async () => {
    const request = new Request("https://test/x", {
      method: "POST",
      headers: { "content-length": String(MAX_UPLOAD_BYTES + 1) },
      body: null,
    });
    const response = await POST(request, { params: params() });
    expect(response.status).toBe(413);
    expect((await response.json()).error).toContain("too large");
    expect(stageIfcArtifact).not.toHaveBeenCalled();
  });
});
