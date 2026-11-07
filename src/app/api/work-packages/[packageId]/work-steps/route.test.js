import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/workSteps", () => ({
  listWorkSteps: vi.fn(),
  createWorkStep: vi.fn(),
}));

import { workAuth } from "../../_lib/auth.js";
import { listWorkSteps, createWorkStep } from "@/application/work-management/workSteps";
import { GET, POST } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("GET /api/work-packages/[packageId]/work-steps", () => {
  it("forwards filters and paging to the service and returns the read model", async () => {
    listWorkSteps.mockResolvedValue({
      ok: true,
      steps: [{ id: "forge_wps_1", sequenceNo: 1 }],
      generation: 2,
      packageStatus: "in_progress",
    });
    const response = await GET(
      new Request("https://test/x?includeRetired=true&limit=10&offset=0"),
      { params: params() },
    );
    expect(response.status).toBe(200);
    expect(listWorkSteps).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1",
      packageId: "pkg_1",
      includeRetired: true,
      retiredOnly: false,
      limit: "10",
      offset: "0",
    });
    const body = await response.json();
    expect(body.steps).toHaveLength(1);
    expect(body.generation).toBe(2);
    expect(body.packageStatus).toBe("in_progress");
  });

  it("forwards a retired-only request to the service", async () => {
    listWorkSteps.mockResolvedValue({
      ok: true,
      steps: [{ id: "forge_wps_3", sequenceNo: 3, retiredAt: "t2" }],
      generation: 2,
      packageStatus: "in_progress",
    });
    const response = await GET(
      new Request("https://test/x?retiredOnly=true&limit=100&offset=100"),
      { params: params() },
    );
    expect(response.status).toBe(200);
    expect(listWorkSteps).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1",
      packageId: "pkg_1",
      includeRetired: undefined,
      retiredOnly: true,
      limit: "100",
      offset: "100",
    });
  });

  it("returns the service error status", async () => {
    listWorkSteps.mockResolvedValue({ ok: false, httpStatus: 404, error: "Work package not found." });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(404);
  });
});

describe("POST /api/work-packages/[packageId]/work-steps", () => {
  it("forwards the body to the service and returns 201", async () => {
    createWorkStep.mockResolvedValue({ ok: true, step: { id: "forge_wps_1", version: 1 } });
    const response = await POST(
      new Request("https://test/x", {
        method: "POST",
        body: JSON.stringify({ title: "Fabricate pipe spool", craftLabel: "Pipefitter" }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(201);
    expect(createWorkStep).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1",
      packageId: "pkg_1",
      input: { title: "Fabricate pipe spool", craftLabel: "Pipefitter" },
    });
  });

  it("returns 503 when the migration is not yet applied", async () => {
    createWorkStep.mockResolvedValue({
      ok: false,
      httpStatus: 503,
      error: "Work steps aren't available yet — the database change for this feature hasn't been applied.",
    });
    const response = await POST(
      new Request("https://test/x", { method: "POST", body: JSON.stringify({ title: "x" }) }),
      { params: params() },
    );
    expect(response.status).toBe(503);
  });
});
