import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/takeoff", () => ({ updateDrawing: vi.fn(), deleteDrawing: vi.fn() }));

import { workAuth } from "../../../_lib/auth.js";
import { updateDrawing, deleteDrawing } from "@/application/work-management/takeoff";
import { PATCH, DELETE } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1", drawingId: "dwg_1" });

beforeEach(() => { vi.clearAllMocks(); workAuth.mockResolvedValue(AUTH); });

describe("PATCH /api/work-packages/[packageId]/drawings/[drawingId]", () => {
  it("updates the drawing with the patch body", async () => {
    updateDrawing.mockResolvedValue({ ok: true, drawing: { id: "dwg_1", drawingNumber: "P-102" } });
    const response = await PATCH(
      new Request("https://test/x", { method: "PATCH", body: JSON.stringify({ drawingNumber: "P-102" }) }),
      { params: params() },
    );
    expect(response.status).toBe(200);
    expect(updateDrawing).toHaveBeenCalledWith(AUTH.db, { ownerId: "owner_1", drawingId: "dwg_1", patch: { drawingNumber: "P-102" } });
  });

  it("maps a not-found drawing to 404", async () => {
    updateDrawing.mockResolvedValue({ ok: false, httpStatus: 404, error: "Drawing not found." });
    const response = await PATCH(
      new Request("https://test/x", { method: "PATCH", body: JSON.stringify({ title: "New title" }) }),
      { params: params() },
    );
    expect(response.status).toBe(404);
  });
});

describe("DELETE /api/work-packages/[packageId]/drawings/[drawingId]", () => {
  it("deletes the drawing", async () => {
    deleteDrawing.mockResolvedValue({ ok: true });
    const response = await DELETE(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(200);
    expect(deleteDrawing).toHaveBeenCalledWith(AUTH.db, { ownerId: "owner_1", drawingId: "dwg_1" });
  });

  it("maps a conflict (children/lines still attached) to 409", async () => {
    deleteDrawing.mockResolvedValue({ ok: false, httpStatus: 409, error: "This drawing still has takeoff lines — remove those first." });
    const response = await DELETE(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(409);
  });
});
