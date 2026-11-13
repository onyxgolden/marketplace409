import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  requirePackageScope: vi.fn(async () => null),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
}));
vi.mock("@/application/work-management/progress", () => ({
  listProgressRevisions: vi.fn(),
}));

import { workAuth } from "../../../../_lib/auth.js";
import { listProgressRevisions } from "@/application/work-management/progress";
import { GET } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1", entryId: "forge_wprg_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("GET /api/work-packages/[packageId]/progress/[entryId]/revisions", () => {
  it("returns the entry with its audit history", async () => {
    listProgressRevisions.mockResolvedValue({
      ok: true,
      entry: { id: "forge_wprg_1" },
      revisions: [{ id: "forge_wprv_1", action: "create" }],
    });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(200);
    expect(listProgressRevisions).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1", entryId: "forge_wprg_1",
    });
    expect((await response.json()).revisions).toHaveLength(1);
  });
});
