import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/craftAssignments", () => ({
  listCraftAssignments: vi.fn(),
  createCraftAssignment: vi.fn(),
}));

import { workAuth } from "../../_lib/auth.js";
import { listCraftAssignments, createCraftAssignment } from "@/application/work-management/craftAssignments";
import { GET, POST } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("GET /api/work-packages/[packageId]/craft-assignments", () => {
  it("forwards filters and paging to the service and returns the read model", async () => {
    listCraftAssignments.mockResolvedValue({
      ok: true,
      assignments: [{ id: "forge_wpca_1" }],
      dayTotals: [{ workDate: "2026-11-09", plannedPersonHours: 48, assignmentCount: 1 }],
      from: "2026-11-09",
      to: "2026-11-09",
      packageStatus: "in_progress",
    });
    const response = await GET(
      new Request("https://test/x?from=2026-11-09&to=2026-11-09&craft=Pipefitter&shift=day&includeRetired=false&limit=10&offset=0"),
      { params: params() },
    );
    expect(response.status).toBe(200);
    expect(listCraftAssignments).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1",
      packageId: "pkg_1",
      from: "2026-11-09",
      to: "2026-11-09",
      craft: "Pipefitter",
      shift: "day",
      includeRetired: false,
      limit: "10",
      offset: "0",
    });
    const body = await response.json();
    expect(body.assignments).toHaveLength(1);
    expect(body.dayTotals[0].plannedPersonHours).toBe(48);
    expect(body.packageStatus).toBe("in_progress");
  });

  it("returns the service error status", async () => {
    listCraftAssignments.mockResolvedValue({ ok: false, httpStatus: 404, error: "Work package not found." });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(404);
  });
});

describe("POST /api/work-packages/[packageId]/craft-assignments", () => {
  it("forwards the body to the service and returns 201", async () => {
    createCraftAssignment.mockResolvedValue({ ok: true, assignment: { id: "forge_wpca_1", version: 1 } });
    const response = await POST(
      new Request("https://test/x", {
        method: "POST",
        body: JSON.stringify({ workDate: "2026-11-09", craft: "Pipefitter", shiftKind: "day", crewSize: 6, hoursPerPerson: 8 }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(201);
    expect(createCraftAssignment).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1",
      packageId: "pkg_1",
      input: { workDate: "2026-11-09", craft: "Pipefitter", shiftKind: "day", crewSize: 6, hoursPerPerson: 8 },
    });
  });

  it("returns 503 when the migration is not yet applied", async () => {
    createCraftAssignment.mockResolvedValue({
      ok: false,
      httpStatus: 503,
      error: "Craft assignments aren't available yet — the database change for this feature hasn't been applied.",
    });
    const response = await POST(
      new Request("https://test/x", { method: "POST", body: JSON.stringify({ workDate: "2026-11-09" }) }),
      { params: params() },
    );
    expect(response.status).toBe(503);
  });
});
