// Slice-7 PDF blockers — intake route tests: the scope contract and
// the multipart handoff to the intake service.
//
// Scope-matrix note: the six legs (explicit unassigned 200, assigned
// 200, omitted scope 404, wrong project 404, cross-owner 404,
// archived/invalid scope 404) are proven at the provePackageInScope /
// fetchScopedPackage / resolvePlannerProjectScope level in
// src/application/work-management/projectScope.test.js. These route
// tests prove the route's half of the contract: an in-scope request
// reaches the service, and an out-of-scope request returns the scope
// 404 without ever calling it.
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  requirePackageScope: vi.fn(async () => null),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
}));
vi.mock("@/application/work-management/drawingIntake", () => ({
  uploadControlledDrawing: vi.fn(),
}));

import { workAuth, requirePackageScope } from "../../../_lib/auth.js";
import { uploadControlledDrawing } from "@/application/work-management/drawingIntake";
import { POST } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = (packageId = "pkg_1") => Promise.resolve({ packageId });
const PDF = new TextEncoder().encode("%PDF-1.7\n%test isometric\n%%EOF\n");

function intakeRequest(fields = {}) {
  const form = new FormData();
  form.append("file", new File([PDF], "W-0005-1.pdf", { type: "application/pdf" }));
  form.append("drawingType", fields.drawingType ?? "isometric");
  form.append("drawingNumber", fields.drawingNumber ?? "W-0005-1");
  form.append("lineNumber", fields.lineNumber ?? '2"-PL-101');
  form.append("revisionCode", fields.revisionCode ?? "0");
  form.append("issueDate", fields.issueDate ?? "2026-11-13");
  form.append("issuerRef", fields.issuerRef ?? "Drafter A");
  form.append("title", fields.title ?? "Test isometric");
  form.append("requestId", fields.requestId ?? "req-1");
  return new Request("https://test/x", { method: "POST", body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
  requirePackageScope.mockResolvedValue(null);
});

describe("POST /api/work-packages/[packageId]/drawings/intake", () => {
  it("intakes an in-scope package (explicit scope) and returns 201 with the receipt", async () => {
    uploadControlledDrawing.mockResolvedValue({
      ok: true, replayed: false,
      artifact: { id: "forge_wpa_1", contentSha256: "a".repeat(64) },
      drawing: { id: "forge_wdwg_1" }, revision: { id: "forge_wpdrv_1" },
    });
    const response = await POST(intakeRequest(), { params: params() });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.artifact.id).toBe("forge_wpa_1");
    expect(body.replayed).toBe(false);
    expect(requirePackageScope).toHaveBeenCalledWith(AUTH, "pkg_1");
    expect(uploadControlledDrawing).toHaveBeenCalledTimes(1);
    const args = uploadControlledDrawing.mock.calls[0][1];
    expect(args.ownerId).toBe("owner_1");
    expect(args.packageId).toBe("pkg_1");
    expect(args.input.drawingNumber).toBe("W-0005-1");
    expect(args.input.requestId).toBe("req-1");
    expect(args.file.mimeType).toBe("application/pdf");
    expect(args.file.originalFilename).toBe("W-0005-1.pdf");
    expect(args.file.bytes).toEqual(new Uint8Array(PDF));
  });

  it("returns the original receipt on a replayed submit", async () => {
    uploadControlledDrawing.mockResolvedValue({
      ok: true, replayed: true, artifact: { id: "forge_wpa_1" }, drawing: null, revision: null,
    });
    const response = await POST(intakeRequest(), { params: params() });
    expect(response.status).toBe(201);
    expect((await response.json()).replayed).toBe(true);
  });

  it("returns the scope 404 and never calls the service when the package is out of scope", async () => {
    requirePackageScope.mockResolvedValue(Response.json({ error: "Work package not found." }, { status: 404 }));
    const response = await POST(intakeRequest(), { params: params() });
    expect(response.status).toBe(404);
    expect(uploadControlledDrawing).not.toHaveBeenCalled();
  });

  it("returns the auth response before calling the service", async () => {
    workAuth.mockResolvedValue({ error: Response.json({ error: "Unauthorized" }, { status: 401 }) });
    const response = await POST(intakeRequest(), { params: params() });
    expect(response.status).toBe(401);
    expect(uploadControlledDrawing).not.toHaveBeenCalled();
  });

  it("400s with no file, before the service runs", async () => {
    const form = new FormData();
    form.append("drawingNumber", "W-0005-1");
    const response = await POST(new Request("https://test/x", { method: "POST", body: form }), { params: params() });
    expect(response.status).toBe(400);
    expect(uploadControlledDrawing).not.toHaveBeenCalled();
  });

  it("maps a service validation failure to its httpStatus", async () => {
    uploadControlledDrawing.mockResolvedValue({ ok: false, httpStatus: 400, error: "Drawing type must be one of: isometric, p_id, cut_sheet." });
    const response = await POST(intakeRequest({ drawingType: "sketch" }), { params: params() });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("Drawing type must be one of");
  });

  it("generates a request id when the client sends none, so the submit is still idempotent", async () => {
    uploadControlledDrawing.mockResolvedValue({
      ok: true, replayed: false, artifact: { id: "forge_wpa_1" }, drawing: null, revision: null,
    });
    const form = new FormData();
    form.append("file", new File([PDF], "W-0005-1.pdf", { type: "application/pdf" }));
    form.append("drawingType", "isometric");
    form.append("drawingNumber", "W-0005-1");
    form.append("revisionCode", "0");
    form.append("issueDate", "2026-11-13");
    const response = await POST(new Request("https://test/x", { method: "POST", body: form }), { params: params() });
    expect(response.status).toBe(201);
    const requestId = uploadControlledDrawing.mock.calls[0][1].input.requestId;
    expect(typeof requestId).toBe("string");
    expect(requestId.length).toBeGreaterThan(0);
  });
});
