import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  requirePackageScope: vi.fn(async () => null),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/workSteps", () => ({
  listStepDrawings: vi.fn(),
  createStepDrawingLink: vi.fn(),
}));

import { workAuth } from "../../../../_lib/auth.js";
import { listStepDrawings, createStepDrawingLink } from "@/application/work-management/workSteps";
import { GET, POST } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1", stepId: "forge_wps_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("GET /api/work-packages/[packageId]/work-steps/[stepId]/drawings", () => {
  it("returns the step plus its drawing links", async () => {
    listStepDrawings.mockResolvedValue({
      ok: true,
      step: { id: "forge_wps_1" },
      links: [{ id: "forge_wpsl_1", drawingId: "dwg_1" }],
    });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(200);
    expect(listStepDrawings).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1",
      packageId: "pkg_1",
      stepId: "forge_wps_1",
    });
    const body = await response.json();
    expect(body.links).toHaveLength(1);
  });

  it("forwards paging to the service", async () => {
    listStepDrawings.mockResolvedValue({ ok: true, step: { id: "forge_wps_1" }, links: [] });
    const response = await GET(new Request("https://test/x?limit=50&offset=50"), { params: params() });
    expect(response.status).toBe(200);
    expect(listStepDrawings).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1",
      packageId: "pkg_1",
      stepId: "forge_wps_1",
      limit: "50",
      offset: "50",
    });
  });
});

describe("POST /api/work-packages/[packageId]/work-steps/[stepId]/drawings", () => {
  it("forwards the body to the service and returns 201", async () => {
    createStepDrawingLink.mockResolvedValue({ ok: true, link: { id: "forge_wpsl_1", version: 1 } });
    const response = await POST(
      new Request("https://test/x", {
        method: "POST",
        body: JSON.stringify({ drawingId: "dwg_1", refinementNote: "Per P&ID rev C" }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(201);
    expect(createStepDrawingLink).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1",
      packageId: "pkg_1",
      stepId: "forge_wps_1",
      input: { drawingId: "dwg_1", refinementNote: "Per P&ID rev C" },
    });
  });

  it("returns 409 on a duplicate link", async () => {
    createStepDrawingLink.mockResolvedValue({ ok: false, httpStatus: 409, error: "This step is already linked to that drawing." });
    const response = await POST(
      new Request("https://test/x", {
        method: "POST",
        body: JSON.stringify({ drawingId: "dwg_1" }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(409);
  });
});
