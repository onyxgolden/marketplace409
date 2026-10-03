import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./_lib/auth.js", () => ({
  workAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => request.json(),
}));
vi.mock("@/application/work-management/workPackages", () => ({
  createWorkPackage: vi.fn(),
  listWorkPackages: vi.fn(),
}));

import { workAuth } from "./_lib/auth.js";
import { createWorkPackage, listWorkPackages } from "@/application/work-management/workPackages";
import { GET, POST } from "./route.js";

const AUTH = { db: {}, ownerId: "owner_1", actor: "user_9" };
function request(body, method = "GET", query = "") {
  const url = method === "GET" ? `https://test/api/work-packages${query}` : "https://test/api/work-packages";
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("GET /api/work-packages", () => {
  it("returns 401 when unauthenticated", async () => {
    workAuth.mockResolvedValueOnce({ error: Response.json({ error: "no" }, { status: 401 }) });
    const response = await GET(request(null));
    expect(response.status).toBe(401);
  });
  it("lists packages with status filter", async () => {
    listWorkPackages.mockResolvedValue({ ok: true, packages: [{ id: "forge_wp_1", code: "WP-0001" }] });
    const response = await GET(request(null, "GET", "?status=draft"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.packages).toHaveLength(1);
    expect(listWorkPackages).toHaveBeenCalledWith({}, { ownerId: "owner_1", status: "draft", packageType: undefined });
  });
});

describe("POST /api/work-packages", () => {
  it("creates a package and returns 201", async () => {
    createWorkPackage.mockResolvedValue({ ok: true, package: { id: "forge_wp_1", code: "WP-0007", status: "draft" } });
    const response = await POST(request({ title: "Turnover", package_type: "rental_turn" }, "POST"));
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.package.code).toBe("WP-0007");
    expect(createWorkPackage).toHaveBeenCalledWith({}, {
      ownerId: "owner_1", actor: "user_9",
      input: { title: "Turnover", package_type: "rental_turn" },
    });
  });
  it("maps validation failures to the right status", async () => {
    createWorkPackage.mockResolvedValue({ ok: false, httpStatus: 400, error: "A title is required." });
    const response = await POST(request({ title: " " }, "POST"));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toMatch("title");
  });
});
