import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/drawingReviews", () => ({
  createFieldRedline: vi.fn(),
  listFieldRedlines: vi.fn(),
}));

import { workAuth } from "../../../../_lib/auth.js";
import { createFieldRedline, listFieldRedlines } from "@/application/work-management/drawingReviews";
import { GET, POST } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1", drawingId: "dwg_1" });
const SHA = "a".repeat(64);

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("GET field-redlines", () => {
  it("lists field redlines for the drawing", async () => {
    listFieldRedlines.mockResolvedValue({
      ok: true,
      drawing: { id: "dwg_1", drawingNumber: "P-101" },
      fieldRedlines: [{ id: "forge_wpdfr_1", recordState: "HISTORICAL_PENDING_RECONCILIATION" }],
    });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(200);
    expect(listFieldRedlines).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1", drawingId: "dwg_1", limit: null, offset: null,
    });
    expect((await response.json()).fieldRedlines).toHaveLength(1);
  });
});

describe("POST field-redlines", () => {
  it("captures a field redline and returns 201", async () => {
    createFieldRedline.mockResolvedValue({
      ok: true, fieldRedline: { id: "forge_wpdfr_1", recordState: "HISTORICAL_PENDING_RECONCILIATION" },
    });
    const input = {
      drawingRevisionId: "forge_wpdrv_1", artifactRef: "s3://forge/field/scan.pdf",
      sha256: SHA, fieldReason: "No time to send pipe back; hand-marked on site.",
    };
    const response = await POST(
      new Request("https://test/x", { method: "POST", body: JSON.stringify(input) }),
      { params: params() },
    );
    expect(response.status).toBe(201);
    expect(createFieldRedline).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1", drawingId: "dwg_1", input,
    });
  });

  it("forwards a missing reason as 400", async () => {
    createFieldRedline.mockResolvedValue({ ok: false, httpStatus: 400, error: "A reason is required for this change." });
    const response = await POST(
      new Request("https://test/x", {
        method: "POST",
        body: JSON.stringify({
          drawingRevisionId: "forge_wpdrv_1", artifactRef: "s3://forge/field/scan.pdf", sha256: SHA,
        }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(400);
  });
});
