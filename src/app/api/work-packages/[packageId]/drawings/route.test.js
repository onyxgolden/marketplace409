import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  requirePackageScope: vi.fn(async () => null),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/takeoff", () => ({
  createDrawing: vi.fn(),
  listDrawingsForPackage: vi.fn(),
}));

import { workAuth } from "../../_lib/auth.js";
import { createDrawing, listDrawingsForPackage } from "@/application/work-management/takeoff";
import { GET, POST } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = (packageId = "pkg_1") => Promise.resolve({ packageId });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("GET /api/work-packages/[packageId]/drawings", () => {
  it("lists the owner-scoped drawings for the package", async () => {
    listDrawingsForPackage.mockResolvedValue({ ok: true, drawings: [{ id: "dwg_1" }] });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(200);
    expect((await response.json()).drawings).toHaveLength(1);
    expect(listDrawingsForPackage).toHaveBeenCalledWith(AUTH.db, { ownerId: "owner_1", packageId: "pkg_1" });
  });

  it("returns the auth response before calling the service", async () => {
    workAuth.mockResolvedValue({ error: Response.json({ error: "Unauthorized" }, { status: 401 }) });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(401);
    expect(listDrawingsForPackage).not.toHaveBeenCalled();
  });
});

describe("POST /api/work-packages/[packageId]/drawings", () => {
  it("creates a drawing, merging the route's packageId into the body", async () => {
    createDrawing.mockResolvedValue({ ok: true, drawing: { id: "dwg_1", drawingNumber: "P-101" } });
    const response = await POST(
      new Request("https://test/x", { method: "POST", body: JSON.stringify({ drawingNumber: "P-101", drawingType: "p_id" }) }),
      { params: params() },
    );
    expect(response.status).toBe(201);
    expect(createDrawing).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", actor: "user_9",
      input: { drawingNumber: "P-101", drawingType: "p_id", packageId: "pkg_1" },
    });
  });

  it("maps a validation failure to its httpStatus", async () => {
    createDrawing.mockResolvedValue({ ok: false, httpStatus: 400, error: "drawingNumber is required." });
    const response = await POST(new Request("https://test/x", { method: "POST", body: "{}" }), { params: params() });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("drawingNumber is required.");
  });
});
