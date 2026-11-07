import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/craftAssignments", () => ({
  listCraftAssignmentRevisions: vi.fn(),
}));

import { workAuth } from "../../../../_lib/auth.js";
import { listCraftAssignmentRevisions } from "@/application/work-management/craftAssignments";
import { GET } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1", assignmentId: "forge_wpca_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("GET /api/work-packages/[packageId]/craft-assignments/[assignmentId]/revisions", () => {
  it("returns the assignment with its history", async () => {
    listCraftAssignmentRevisions.mockResolvedValue({
      ok: true,
      assignment: { id: "forge_wpca_1", version: 2 },
      revisions: [{ id: "forge_wpcr_1", version: 1, action: "create" }],
    });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.assignment.id).toBe("forge_wpca_1");
    expect(body.revisions).toHaveLength(1);
    expect(listCraftAssignmentRevisions).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1", assignmentId: "forge_wpca_1",
    });
  });

  it("returns 404 for an assignment in another package", async () => {
    listCraftAssignmentRevisions.mockResolvedValue({ ok: false, httpStatus: 404, error: "Craft assignment not found." });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(404);
  });
});
