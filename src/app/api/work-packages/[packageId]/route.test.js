import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({
    error: result.error,
    ...(result.blockers ? { blockers: result.blockers } : {}),
  }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => request.json(),
}));
vi.mock("@/application/work-management/workPackages", () => ({
  getWorkPackageDetail: vi.fn(),
  updateWorkPackage: vi.fn(),
  deleteWorkPackage: vi.fn(),
}));

import { workAuth } from "../_lib/auth.js";
import { getWorkPackageDetail, updateWorkPackage, deleteWorkPackage } from "@/application/work-management/workPackages";
import { GET, PATCH, DELETE } from "./route.js";

const AUTH = { db: {}, ownerId: "owner_1", actor: "user_9" };
const params = (packageId = "forge_wp_1") => Promise.resolve({ packageId });
function request(body, method = "GET") {
  return new Request("https://test/api/work-packages/forge_wp_1", {
    method,
    headers: { "content-type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("GET /api/work-packages/[packageId]", () => {
  it("returns the full package detail", async () => {
    getWorkPackageDetail.mockResolvedValue({
      ok: true, package: { id: "forge_wp_1", code: "WP-0001" },
      transitions: [], attestations: [], baselines: [], currentBaseline: null,
      scopeChanges: [], observations: [],
    });
    const response = await GET(request(null), { params: params() });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.package.code).toBe("WP-0001");
    expect(getWorkPackageDetail).toHaveBeenCalledWith({}, { ownerId: "owner_1", actor: "user_9", packageId: "forge_wp_1" });
  });
  it("maps not-found to 404", async () => {
    getWorkPackageDetail.mockResolvedValue({ ok: false, httpStatus: 404, error: "Work package not found." });
    const response = await GET(request(null), { params: params("nope") });
    expect(response.status).toBe(404);
  });
});

describe("PATCH /api/work-packages/[packageId]", () => {
  it("updates the package", async () => {
    updateWorkPackage.mockResolvedValue({ ok: true, package: { id: "forge_wp_1", title: "Renamed" } });
    const response = await PATCH(request({ title: "Renamed" }, "PATCH"), { params: params() });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.package.title).toBe("Renamed");
    expect(updateWorkPackage).toHaveBeenCalledWith({}, {
      ownerId: "owner_1", actor: "user_9", packageId: "forge_wp_1", patch: { title: "Renamed" },
    });
  });
  it("maps terminal-state edits to 409", async () => {
    updateWorkPackage.mockResolvedValue({ ok: false, httpStatus: 409, error: "Package is verified_closed; reopen it before editing." });
    const response = await PATCH(request({ title: "Renamed" }, "PATCH"), { params: params() });
    expect(response.status).toBe(409);
  });
  it("passes a property assignment/clear patch through", async () => {
    updateWorkPackage.mockResolvedValue({ ok: true, package: { id: "forge_wp_1", property_id: "1900-w-decker" } });
    const response = await PATCH(request({ property_id: "1900-west-decker" }, "PATCH"), { params: params() });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.package.property_id).toBe("1900-w-decker");
    expect(updateWorkPackage).toHaveBeenCalledWith({}, {
      ownerId: "owner_1", actor: "user_9", packageId: "forge_wp_1",
      patch: { property_id: "1900-west-decker" },
    });
  });
});

describe("PATCH /api/work-packages/[packageId] date normalization (D6)", () => {
  it("passes the live-shaped dateless-edit payload through verbatim", async () => {
    updateWorkPackage.mockResolvedValue({ ok: true, package: { id: "forge_wp_1", property_id: "308-paula", planned_finish: null } });
    const patch = { title: "Turnover", description: "", planned_finish: null, property_id: "308-paula" };
    const response = await PATCH(request(patch, "PATCH"), { params: params() });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.package.property_id).toBe("308-paula");
    expect(updateWorkPackage).toHaveBeenCalledWith({}, {
      ownerId: "owner_1", actor: "user_9", packageId: "forge_wp_1", patch,
    });
  });
  it("maps a malformed-date 400 from the service (never a 500)", async () => {
    updateWorkPackage.mockResolvedValue({
      ok: false, httpStatus: 400,
      error: "planned_finish must be a valid date in YYYY-MM-DD format.",
    });
    const response = await PATCH(request({ planned_finish: "next Friday" }, "PATCH"), { params: params() });
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toMatch(/YYYY-MM-DD/);
  });
});

describe("PATCH /api/work-packages/[packageId] budget revisions (Slice 3)", () => {
  it("returns the atomic budget revision written by the service", async () => {
    updateWorkPackage.mockResolvedValue({
      ok: true,
      package: { id: "forge_wp_1", planned_cost_cents: 125000 },
      budgetRevision: { id: "rev_1", new_planned_cost_cents: 125000 },
    });
    const response = await PATCH(request({
      planned_budget: "1250.00", budget_reason: "Initial budget", expected_version: 3,
    }, "PATCH"), { params: params() });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.package.planned_cost_cents).toBe(125000);
    expect(body.budgetRevision.id).toBe("rev_1");
  });
});

describe("GET /api/work-packages/[packageId] deletion eligibility (D7)", () => {
  it("passes the actor and returns deletionEligibility for display", async () => {
    getWorkPackageDetail.mockResolvedValue({
      ok: true, package: { id: "forge_wp_1", code: "WP-0001" },
      transitions: [], attestations: [], baselines: [], currentBaseline: null,
      scopeChanges: [], observations: [],
      deletionEligibility: {
        isOwner: true, canDelete: true, status: "draft", packageVersion: 1, blockers: [],
      },
    });
    const response = await GET(request(null), { params: params() });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.deletionEligibility.canDelete).toBe(true);
    expect(getWorkPackageDetail).toHaveBeenCalledWith({}, {
      ownerId: "owner_1", actor: "user_9", packageId: "forge_wp_1",
    });
  });
});

describe("DELETE /api/work-packages/[packageId] (D7)", () => {
  it("deletes an empty draft package for the owner", async () => {
    deleteWorkPackage.mockResolvedValue({
      ok: true,
      deletion: { package_id: "forge_wp_1", code: "WP-0001", prior_status: "draft" },
    });
    const response = await DELETE(
      request({ confirmCode: "WP-0001", expectedVersion: 1 }, "DELETE"),
      { params: params() },
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      deletion: { package_id: "forge_wp_1", code: "WP-0001", prior_status: "draft" },
    });
    expect(deleteWorkPackage).toHaveBeenCalledWith({}, {
      ownerId: "owner_1", actor: "user_9", packageId: "forge_wp_1",
      confirmCode: "WP-0001", expectedVersion: 1,
    });
  });

  it("rejects malformed bodies with 400 before any service call", async () => {
    for (const bad of [
      {},
      { confirmCode: "", expectedVersion: 1 },
      { confirmCode: 42, expectedVersion: 1 },
      { confirmCode: "WP-0001" },
      { confirmCode: "WP-0001", expectedVersion: "1" },
      { confirmCode: "WP-0001", expectedVersion: 0 },
      { confirmCode: "WP-0001", expectedVersion: 1.5 },
    ]) {
      const response = await DELETE(request(bad, "DELETE"), { params: params() });
      expect(response.status).toBe(400);
    }
    expect(deleteWorkPackage).not.toHaveBeenCalled();
  });

  it("maps service 403/404/409 outcomes without false success", async () => {
    deleteWorkPackage.mockResolvedValue({
      ok: false, httpStatus: 403, error: "Only the workspace owner can delete a work package.",
    });
    let response = await DELETE(
      request({ confirmCode: "WP-0001", expectedVersion: 1 }, "DELETE"), { params: params() });
    expect(response.status).toBe(403);

    deleteWorkPackage.mockResolvedValue({
      ok: false, httpStatus: 404, error: "Work package not found.",
    });
    response = await DELETE(
      request({ confirmCode: "WP-0001", expectedVersion: 1 }, "DELETE"), { params: params() });
    expect(response.status).toBe(404);

    deleteWorkPackage.mockResolvedValue({
      ok: false, httpStatus: 409,
      error: "This package has records that must be kept, so it can't be deleted.",
      blockers: [{ type: "links", count: 2, label: "Linked records", action: "Unlink them in the Links section below, then try again." }],
    });
    response = await DELETE(
      request({ confirmCode: "WP-0001", expectedVersion: 1 }, "DELETE"), { params: params() });
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.blockers).toEqual([
      { type: "links", count: 2, label: "Linked records", action: "Unlink them in the Links section below, then try again." },
    ]);
  });

  it("fails closed with 500 when the service throws", async () => {
    deleteWorkPackage.mockRejectedValue(new Error("rpc down"));
    const response = await DELETE(
      request({ confirmCode: "WP-0001", expectedVersion: 1 }, "DELETE"), { params: params() });
    expect(response.status).toBe(500);
  });

  it("does not call the service when unauthenticated", async () => {
    workAuth.mockResolvedValue({
      error: Response.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const response = await DELETE(
      request({ confirmCode: "WP-0001", expectedVersion: 1 }, "DELETE"), { params: params() });
    expect(response.status).toBe(401);
    expect(deleteWorkPackage).not.toHaveBeenCalled();
  });
});
