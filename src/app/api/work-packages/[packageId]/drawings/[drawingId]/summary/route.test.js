import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
}));
vi.mock("@/application/work-management/takeoff", () => ({ getPidTakeoffSummary: vi.fn() }));

import { workAuth } from "../../../../_lib/auth.js";
import { getPidTakeoffSummary } from "@/application/work-management/takeoff";
import { GET } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1", drawingId: "dwg_pid1" });

beforeEach(() => { vi.clearAllMocks(); workAuth.mockResolvedValue(AUTH); });

describe("GET .../drawings/[drawingId]/summary", () => {
  it("returns the P&ID takeoff summary", async () => {
    getPidTakeoffSummary.mockResolvedValue({ ok: true, summary: { pIdDrawingId: "dwg_pid1", totals: { lineCount: 2 } } });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(200);
    expect((await response.json()).summary.totals.lineCount).toBe(2);
    expect(getPidTakeoffSummary).toHaveBeenCalledWith(AUTH.db, { ownerId: "owner_1", pIdDrawingId: "dwg_pid1" });
  });

  it("maps 'not a P&ID' to 400", async () => {
    getPidTakeoffSummary.mockResolvedValue({ ok: false, httpStatus: 400, error: "This drawing is not a P&ID — summaries are built per P&ID." });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(400);
  });
});
