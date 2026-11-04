import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/takeoff", () => ({ updateTakeoffLine: vi.fn(), deleteTakeoffLine: vi.fn() }));

import { workAuth } from "../../../../../_lib/auth.js";
import { updateTakeoffLine, deleteTakeoffLine } from "@/application/work-management/takeoff";
import { PATCH, DELETE } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1", drawingId: "dwg_1", lineId: "line_1" });

beforeEach(() => { vi.clearAllMocks(); workAuth.mockResolvedValue(AUTH); });

describe("PATCH .../takeoff-lines/[lineId]", () => {
  it("updates the line with the patch body", async () => {
    updateTakeoffLine.mockResolvedValue({ ok: true, line: { id: "line_1", quantity: 55 } });
    const response = await PATCH(
      new Request("https://test/x", { method: "PATCH", body: JSON.stringify({ quantity: 55 }) }),
      { params: params() },
    );
    expect(response.status).toBe(200);
    expect(updateTakeoffLine).toHaveBeenCalledWith(AUTH.db, { ownerId: "owner_1", lineId: "line_1", patch: { quantity: 55 } });
  });
});

describe("DELETE .../takeoff-lines/[lineId]", () => {
  it("deletes the line", async () => {
    deleteTakeoffLine.mockResolvedValue({ ok: true });
    const response = await DELETE(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(200);
    expect(deleteTakeoffLine).toHaveBeenCalledWith(AUTH.db, { ownerId: "owner_1", lineId: "line_1" });
  });
});
