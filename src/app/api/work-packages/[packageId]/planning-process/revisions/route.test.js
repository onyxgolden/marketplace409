// Work Package Planner — planning-process revisions route.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/planningProcess", () => ({
  listPlanningRevisions: vi.fn(),
}));

import { workAuth } from "../../../_lib/auth.js";
import { listPlanningRevisions } from "@/application/work-management/planningProcess";
import { GET } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("GET /api/work-packages/[packageId]/planning-process/revisions", () => {
  it("forwards paging to the service and returns the revisions", async () => {
    listPlanningRevisions.mockResolvedValue({
      ok: true,
      revisions: [{ id: "forge_ppr_1", action: "status_change" }],
    });
    const response = await GET(
      new Request("https://test/x?limit=10&offset=0"),
      { params: params() },
    );
    expect(response.status).toBe(200);
    expect(listPlanningRevisions).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1",
      packageId: "pkg_1",
      limit: "10",
      offset: "0",
    });
    const body = await response.json();
    expect(body.revisions).toHaveLength(1);
  });

  it("returns the service error status", async () => {
    listPlanningRevisions.mockResolvedValue({ ok: false, httpStatus: 400, error: "limit must be a whole number between 1 and 200." });
    const response = await GET(new Request("https://test/x?limit=999"), { params: params() });
    expect(response.status).toBe(400);
  });
});
