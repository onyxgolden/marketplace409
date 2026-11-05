import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
}));
vi.mock("@/application/work-management/progress", () => ({
  getProgressSummary: vi.fn(),
}));

import { workAuth } from "../../../_lib/auth.js";
import { getProgressSummary } from "@/application/work-management/progress";
import { GET } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = (packageId = "pkg_1") => Promise.resolve({ packageId });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("GET /api/work-packages/[packageId]/progress/summary", () => {
  it("forwards asOf and lineId to the service", async () => {
    getProgressSummary.mockResolvedValue({ ok: true, summary: { packageId: "pkg_1" } });
    const response = await GET(new Request("https://test/x?asOf=2026-11-05&lineId=line_1"), { params: params() });
    expect(response.status).toBe(200);
    expect(getProgressSummary).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1", asOf: "2026-11-05", lineId: "line_1",
    });
  });

  it("returns the auth response before calling the service", async () => {
    workAuth.mockResolvedValue({ error: Response.json({ error: "Unauthorized" }, { status: 401 }) });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(401);
    expect(getProgressSummary).not.toHaveBeenCalled();
  });
});
