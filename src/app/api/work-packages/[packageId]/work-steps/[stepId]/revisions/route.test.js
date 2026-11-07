import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
}));
vi.mock("@/application/work-management/workSteps", () => ({
  listWorkStepRevisions: vi.fn(),
}));

import { workAuth } from "../../../../_lib/auth.js";
import { listWorkStepRevisions } from "@/application/work-management/workSteps";
import { GET } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1", stepId: "forge_wps_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("GET /api/work-packages/[packageId]/work-steps/[stepId]/revisions", () => {
  it("returns the step plus its revisions", async () => {
    listWorkStepRevisions.mockResolvedValue({
      ok: true,
      step: { id: "forge_wps_1" },
      revisions: [{ id: "forge_wpsr_1", action: "create", version: 1 }],
    });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(200);
    expect(listWorkStepRevisions).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1",
      packageId: "pkg_1",
      stepId: "forge_wps_1",
    });
    const body = await response.json();
    expect(body.revisions).toHaveLength(1);
  });

  it("returns 404 for an unknown step", async () => {
    listWorkStepRevisions.mockResolvedValue({ ok: false, httpStatus: 404, error: "Work step not found." });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(404);
  });
});
