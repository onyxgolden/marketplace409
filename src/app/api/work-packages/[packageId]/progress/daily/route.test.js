import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  requirePackageScope: vi.fn(async () => null),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
}));
vi.mock("@/application/work-management/progress", () => ({
  getDailyProgressTotals: vi.fn(),
}));

import { workAuth } from "../../../_lib/auth.js";
import { getDailyProgressTotals } from "@/application/work-management/progress";
import { GET } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = (packageId = "pkg_1") => Promise.resolve({ packageId });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("GET /api/work-packages/[packageId]/progress/daily", () => {
  it("forwards the window and line filter to the service", async () => {
    getDailyProgressTotals.mockResolvedValue({ ok: true, from: "2026-11-01", to: "2026-11-30", days: [] });
    const response = await GET(new Request("https://test/x?from=2026-11-01&to=2026-11-30&lineId=line_1"), { params: params() });
    expect(response.status).toBe(200);
    expect(getDailyProgressTotals).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1",
      from: "2026-11-01", to: "2026-11-30", lineId: "line_1",
    });
  });
});
