import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => request.json(),
}));
vi.mock("@/application/work-management/permitAnnotations", () => ({
  listPermitAnnotations: vi.fn(),
  createPermitAnnotation: vi.fn(),
}));

import { workAuth } from "../../_lib/auth.js";
import { listPermitAnnotations, createPermitAnnotation } from "@/application/work-management/permitAnnotations";
import { GET, POST } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1" });

beforeEach(() => { vi.clearAllMocks(); workAuth.mockResolvedValue(AUTH); });

describe("GET /api/work-packages/[packageId]/permit-annotations", () => {
  it("lists annotations, passing filters through", async () => {
    listPermitAnnotations.mockResolvedValue({ ok: true, annotations: [{ id: "a1" }] });
    const response = await GET(
      new Request("https://test/x?targetKind=drawing&drawingId=dwg_1&includeRetired=true"),
      { params: params() },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ annotations: [{ id: "a1" }] });
    expect(listPermitAnnotations).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1",
      targetKind: "drawing", drawingId: "dwg_1", includeRetired: true,
      limit: undefined, offset: undefined,
    });
  });

  it("maps a service failure to its status", async () => {
    listPermitAnnotations.mockResolvedValue({ ok: false, httpStatus: 404, error: "Drawing not found in this package." });
    const response = await GET(new Request("https://test/x?drawingId=dwg_9"), { params: params() });
    expect(response.status).toBe(404);
  });
});

describe("POST /api/work-packages/[packageId]/permit-annotations", () => {
  it("creates the annotation and returns 201", async () => {
    createPermitAnnotation.mockResolvedValue({ ok: true, annotation: { id: "forge_wppa_1" } });
    const request = new Request("https://test/x", {
      method: "POST",
      body: JSON.stringify({ targetKind: "package", label: "Portal", url: "https://example.com/x" }),
    });
    const response = await POST(request, { params: params() });
    expect(response.status).toBe(201);
    expect(createPermitAnnotation).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1",
      input: { targetKind: "package", label: "Portal", url: "https://example.com/x" },
    });
  });

  it("maps a validation failure to 400", async () => {
    createPermitAnnotation.mockResolvedValue({ ok: false, httpStatus: 400, error: "Enter a valid secure (https) web address." });
    const request = new Request("https://test/x", {
      method: "POST",
      body: JSON.stringify({ targetKind: "package", label: "Portal", url: "http://example.com/x" }),
    });
    const response = await POST(request, { params: params() });
    expect(response.status).toBe(400);
  });
});
