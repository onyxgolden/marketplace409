import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/progress", () => ({
  voidProgressEntry: vi.fn(),
}));

import { workAuth } from "../../../../_lib/auth.js";
import { voidProgressEntry } from "@/application/work-management/progress";
import { POST } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1", entryId: "forge_wprg_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("POST /api/work-packages/[packageId]/progress/[entryId]/void", () => {
  it("forwards expectedVersion and reason to the service", async () => {
    voidProgressEntry.mockResolvedValue({ ok: true, entry: { id: "forge_wprg_1", version: 2 } });
    const response = await POST(
      new Request("https://test/x", {
        method: "POST",
        body: JSON.stringify({ expectedVersion: 1, reason: "duplicate day" }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(200);
    expect(voidProgressEntry).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1", entryId: "forge_wprg_1",
      expectedVersion: 1, reason: "duplicate day",
    });
  });
});
