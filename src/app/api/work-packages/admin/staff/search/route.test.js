import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
}));
vi.mock("@/application/work-management/plannerAdmin", () => ({
  searchStaff: vi.fn(),
}));

import { workAuth } from "../../../_lib/auth.js";
import { searchStaff } from "@/application/work-management/plannerAdmin";
import { GET } from "./route.js";

const request = (qs) => new Request(`https://test/api/work-packages/admin/staff/search${qs}`);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/work-packages/admin/staff/search", () => {
  it("finds a user by exact email", async () => {
    workAuth.mockResolvedValue({ db: {}, ownerId: "owner_1", actor: "owner_1" });
    searchStaff.mockResolvedValue({ ok: true, results: [{ user_id: "staff_1", email: "staff1@example.com" }] });
    const response = await GET(request("?email=staff1@example.com"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.results).toHaveLength(1);
  });

  it("returns an empty array for no match -- never a 404 that could leak existence", async () => {
    workAuth.mockResolvedValue({ db: {}, ownerId: "owner_1", actor: "owner_1" });
    searchStaff.mockResolvedValue({ ok: true, results: [] });
    const response = await GET(request("?email=nobody@example.com"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.results).toEqual([]);
  });

  it("surfaces an unauthorized caller as 403, not a result shape", async () => {
    workAuth.mockResolvedValue({ db: {}, ownerId: "owner_1", actor: "stranger_1" });
    searchStaff.mockResolvedValue({ ok: false, httpStatus: 403, error: "You do not have permission to do that." });
    const response = await GET(request("?userId=staff_1"));
    expect(response.status).toBe(403);
  });
});
