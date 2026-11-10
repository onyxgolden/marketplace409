import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
}));
vi.mock("@/application/work-management/plannerAdmin", () => ({
  getAuditLog: vi.fn(),
}));

import { workAuth } from "../../_lib/auth.js";
import { getAuditLog } from "@/application/work-management/plannerAdmin";
import { GET } from "./route.js";

const request = (qs = "") => new Request(`https://test/api/work-packages/admin/audit${qs}`);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/work-packages/admin/audit", () => {
  it("returns audit entries newest-first", async () => {
    workAuth.mockResolvedValue({ db: {}, ownerId: "owner_1", actor: "owner_1" });
    getAuditLog.mockResolvedValue({ ok: true, entries: [{ id: "a1", action: "role_create" }] });
    const response = await GET(request());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.entries).toHaveLength(1);
  });

  it("passes limit/offset query params through", async () => {
    workAuth.mockResolvedValue({ db: {}, ownerId: "owner_1", actor: "owner_1" });
    getAuditLog.mockResolvedValue({ ok: true, entries: [] });
    await GET(request("?limit=10&offset=20"));
    expect(getAuditLog).toHaveBeenCalledWith({}, { ownerId: "owner_1", limit: "10", offset: "20" });
  });

  it("returns 400 for an invalid limit", async () => {
    workAuth.mockResolvedValue({ db: {}, ownerId: "owner_1", actor: "owner_1" });
    getAuditLog.mockResolvedValue({ ok: false, httpStatus: 400, error: "Limit must be a whole number from 1 to 200." });
    const response = await GET(request("?limit=9001"));
    expect(response.status).toBe(400);
  });
});
