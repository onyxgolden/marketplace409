import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/takeoff", () => ({ createTakeoffLine: vi.fn(), listTakeoffLinesForDrawing: vi.fn() }));

import { workAuth } from "../../../../_lib/auth.js";
import { createTakeoffLine, listTakeoffLinesForDrawing } from "@/application/work-management/takeoff";
import { GET, POST } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1", drawingId: "dwg_1" });

beforeEach(() => { vi.clearAllMocks(); workAuth.mockResolvedValue(AUTH); });

describe("GET .../drawings/[drawingId]/takeoff-lines", () => {
  it("lists the lines for the drawing", async () => {
    listTakeoffLinesForDrawing.mockResolvedValue({ ok: true, lines: [{ id: "line_1", lineNo: 1 }] });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(200);
    expect((await response.json()).lines).toHaveLength(1);
    expect(listTakeoffLinesForDrawing).toHaveBeenCalledWith(AUTH.db, { ownerId: "owner_1", packageId: "pkg_1", drawingId: "dwg_1" });
  });
});

describe("POST .../drawings/[drawingId]/takeoff-lines", () => {
  it("creates a line, merging the route's drawingId into the body", async () => {
    createTakeoffLine.mockResolvedValue({ ok: true, line: { id: "line_1", lineNo: 1 } });
    const response = await POST(
      new Request("https://test/x", { method: "POST", body: JSON.stringify({ description: "pipe", quantity: 10, unit: "ft", category: "pipe", fabLocation: "shop" }) }),
      { params: params() },
    );
    expect(response.status).toBe(201);
    expect(createTakeoffLine).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1", actor: "user_9",
      input: { description: "pipe", quantity: 10, unit: "ft", category: "pipe", fabLocation: "shop", drawingId: "dwg_1" },
    });
  });
});
