import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/progress", () => ({
  correctProgressEntry: vi.fn(),
}));

import { workAuth } from "../../../_lib/auth.js";
import { correctProgressEntry } from "@/application/work-management/progress";
import { PATCH } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1", entryId: "forge_wprg_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("PATCH /api/work-packages/[packageId]/progress/[entryId]", () => {
  it("forwards the patch body to the service", async () => {
    correctProgressEntry.mockResolvedValue({ ok: true, entry: { id: "forge_wprg_1", version: 2 } });
    const response = await PATCH(
      new Request("https://test/x", {
        method: "PATCH",
        body: JSON.stringify({ expectedVersion: 1, installedQuantity: 15, reason: "recount" }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(200);
    expect(correctProgressEntry).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1", entryId: "forge_wprg_1",
      patch: { expectedVersion: 1, installedQuantity: 15, reason: "recount" },
    });
  });

  it("maps a version conflict to 409", async () => {
    correctProgressEntry.mockResolvedValue({ ok: false, httpStatus: 409, error: "This progress entry was changed by someone else — refresh and try again." });
    const response = await PATCH(
      new Request("https://test/x", {
        method: "PATCH",
        body: JSON.stringify({ expectedVersion: 1, installedQuantity: 15 }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(409);
  });
});
