import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/progress", () => ({
  listProgressEntries: vi.fn(),
  createProgressEntry: vi.fn(),
}));

import { workAuth } from "../../_lib/auth.js";
import { listProgressEntries, createProgressEntry } from "@/application/work-management/progress";
import { GET, POST } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = (packageId = "pkg_1") => Promise.resolve({ packageId });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("GET /api/work-packages/[packageId]/progress", () => {
  it("forwards filters and the includeVoided=false mapping to the service", async () => {
    listProgressEntries.mockResolvedValue({ ok: true, entries: [{ id: "e1" }], from: "2026-11-01", to: "2026-11-30" });
    const response = await GET(
      new Request("https://test/x?lineId=line_1&from=2026-11-01&to=2026-11-30&includeVoided=false&limit=50&offset=10"),
      { params: params() },
    );
    expect(response.status).toBe(200);
    expect(listProgressEntries).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1", lineId: "line_1",
      from: "2026-11-01", to: "2026-11-30", includeVoided: false, limit: "50", offset: "10",
    });
  });

  it("returns the auth response before calling the service", async () => {
    workAuth.mockResolvedValue({ error: Response.json({ error: "Unauthorized" }, { status: 401 }) });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(401);
    expect(listProgressEntries).not.toHaveBeenCalled();
  });
});

describe("POST /api/work-packages/[packageId]/progress", () => {
  it("creates an entry at 201, passing the body straight through", async () => {
    createProgressEntry.mockResolvedValue({ ok: true, entry: { id: "forge_wprg_1" } });
    const response = await POST(
      new Request("https://test/x", {
        method: "POST",
        body: JSON.stringify({ lineId: "line_1", workDate: "2026-11-01", installedQuantity: 10 }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(201);
    expect(createProgressEntry).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", actor: "user_9", packageId: "pkg_1",
      input: { lineId: "line_1", workDate: "2026-11-01", installedQuantity: 10 },
    });
  });

  it("maps a service validation failure to its httpStatus", async () => {
    createProgressEntry.mockResolvedValue({ ok: false, httpStatus: 400, error: "Work date cannot be in the future." });
    const response = await POST(
      new Request("https://test/x", {
        method: "POST",
        body: JSON.stringify({ lineId: "line_1", workDate: "2999-01-01", installedQuantity: 10 }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/future/);
  });
});
