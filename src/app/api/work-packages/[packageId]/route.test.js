import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => request.json(),
}));
vi.mock("@/application/work-management/workPackages", () => ({
  getWorkPackageDetail: vi.fn(),
  updateWorkPackage: vi.fn(),
}));

import { workAuth } from "../_lib/auth.js";
import { getWorkPackageDetail, updateWorkPackage } from "@/application/work-management/workPackages";
import { GET, PATCH } from "./route.js";

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
    expect(getWorkPackageDetail).toHaveBeenCalledWith({}, { ownerId: "owner_1", packageId: "forge_wp_1" });
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
