import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({ createAuthenticatedForgeApplication: vi.fn() }));
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { PATCH } from "./route";

function mutateQuery(row) {
  const maybeSingle = vi.fn(async () => ({ data: row, error: null }));
  const query = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), maybeSingle };
  return { client: { from: vi.fn(() => query) }, query };
}
function request(body) {
  return new Request("https://test/api/forge/scheduling/p1/blocks/A1010", {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}
const params = Promise.resolve({ projectId: "p1", taskCode: "A1010" });

describe("PATCH /api/forge/scheduling/[projectId]/blocks/[taskCode]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates percent complete, clamped to 0-100", async () => {
    const db = mutateQuery({ id: "p1_b1" });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await PATCH(request({ percentComplete: 150 }), { params });
    expect(response.status).toBe(200);
    expect(db.query.update).toHaveBeenCalledWith({ percent_complete: 100 });
    expect(db.query.eq).toHaveBeenCalledWith("schedule_project_id", "p1");
    expect(db.query.eq).toHaveBeenCalledWith("task_code", "A1010");
    expect(db.query.eq).toHaveBeenCalledWith("owner_id", "user_1");
  });

  it("updates actual start and finish dates together", async () => {
    const db = mutateQuery({ id: "p1_b1" });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await PATCH(request({ actualStart: "2026-01-05", actualFinish: "2026-01-10" }), { params });
    expect(response.status).toBe(200);
    expect(db.query.update).toHaveBeenCalledWith({ actual_start: "2026-01-05", actual_finish: "2026-01-10" });
  });

  it("clears an actual date when given an empty string", async () => {
    const db = mutateQuery({ id: "p1_b1" });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    await PATCH(request({ actualFinish: "" }), { params });
    expect(db.query.update).toHaveBeenCalledWith({ actual_finish: null });
  });

  it("rejects a body with nothing recognized to update", async () => {
    const db = mutateQuery({ id: "p1_b1" });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await PATCH(request({ label: "Renamed" }), { params });
    expect(response.status).toBe(400);
    expect(db.query.update).not.toHaveBeenCalled();
  });

  it("404s when the block doesn't exist or the caller doesn't own the project", async () => {
    const db = mutateQuery(null);
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await PATCH(request({ percentComplete: 50 }), { params });
    expect(response.status).toBe(404);
  });
});
