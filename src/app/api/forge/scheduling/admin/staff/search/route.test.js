import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../_lib/auth.js", () => ({
  schedulingAdminAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
}));
vi.mock("@/domains/scheduling/schedulingAdmin", () => ({
  searchStaff: vi.fn(),
}));

import { schedulingAdminAuth } from "../../_lib/auth.js";
import { searchStaff } from "@/domains/scheduling/schedulingAdmin";
import { GET } from "./route.js";

const getRequest = (qs = "") => new Request(`https://test/api/forge/scheduling/admin/staff/search${qs}`);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/forge/scheduling/admin/staff/search", () => {
  it("finds a user by exact id", async () => {
    schedulingAdminAuth.mockResolvedValue({ db: {}, ownerId: "owner_1", actor: "owner_1" });
    searchStaff.mockResolvedValue({ ok: true, results: [{ user_id: "staff_1", email: "staff1@example.com" }] });
    const response = await GET(getRequest("?userId=staff_1"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.results).toHaveLength(1);
    expect(searchStaff).toHaveBeenCalledWith({}, { ownerId: "owner_1", userId: "staff_1", email: undefined });
  });

  it("returns an empty array for no match, not an error", async () => {
    schedulingAdminAuth.mockResolvedValue({ db: {}, ownerId: "owner_1", actor: "owner_1" });
    searchStaff.mockResolvedValue({ ok: true, results: [] });
    const response = await GET(getRequest("?email=nobody@example.com"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.results).toEqual([]);
  });

  it("surfaces an unauthorized search as 403", async () => {
    schedulingAdminAuth.mockResolvedValue({ db: {}, ownerId: "owner_1", actor: "stranger_1" });
    searchStaff.mockResolvedValue({ ok: false, httpStatus: 403, error: "You do not have permission to do that." });
    const response = await GET(getRequest("?userId=staff_1"));
    expect(response.status).toBe(403);
  });
});
