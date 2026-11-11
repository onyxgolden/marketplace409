import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../_lib/auth.js", () => ({
  schedulingAdminAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
}));
vi.mock("@/domains/scheduling/schedulingAdmin", () => ({
  getAuditLog: vi.fn(),
}));

import { schedulingAdminAuth } from "../_lib/auth.js";
import { getAuditLog } from "@/domains/scheduling/schedulingAdmin";
import { GET } from "./route.js";

const getRequest = (qs = "") => new Request(`https://test/api/forge/scheduling/admin/audit${qs}`);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/forge/scheduling/admin/audit", () => {
  it("returns the audit entries", async () => {
    schedulingAdminAuth.mockResolvedValue({ db: {}, ownerId: "owner_1", actor: "owner_1" });
    getAuditLog.mockResolvedValue({ ok: true, entries: [{ id: "a1", action: "role_create" }] });
    const response = await GET(getRequest());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.entries).toHaveLength(1);
  });

  it("passes limit/offset from the query string through", async () => {
    schedulingAdminAuth.mockResolvedValue({ db: {}, ownerId: "owner_1", actor: "owner_1" });
    getAuditLog.mockResolvedValue({ ok: true, entries: [] });
    await GET(getRequest("?limit=10&offset=20"));
    expect(getAuditLog).toHaveBeenCalledWith({}, { ownerId: "owner_1", limit: "10", offset: "20" });
  });

  it("surfaces a 400 for an invalid limit", async () => {
    schedulingAdminAuth.mockResolvedValue({ db: {}, ownerId: "owner_1", actor: "owner_1" });
    getAuditLog.mockResolvedValue({ ok: false, httpStatus: 400, error: "Limit must be a whole number from 1 to 200." });
    const response = await GET(getRequest("?limit=5000"));
    expect(response.status).toBe(400);
  });
});
