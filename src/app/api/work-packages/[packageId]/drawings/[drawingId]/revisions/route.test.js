import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/drawingReviews", () => ({
  createRevision: vi.fn(),
  listRevisions: vi.fn(),
}));

import { workAuth } from "../../../../_lib/auth.js";
import { createRevision, listRevisions } from "@/application/work-management/drawingReviews";
import { GET, POST } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1", drawingId: "dwg_1" });
const SHA = "a".repeat(64);

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("GET revisions", () => {
  it("lists revisions for the drawing", async () => {
    listRevisions.mockResolvedValue({
      ok: true,
      drawing: { id: "dwg_1", drawingNumber: "P-101" },
      revisions: [{ id: "forge_wpdrv_1", revisionCode: "A", issuedAs: "IFA" }],
    });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(200);
    expect(listRevisions).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1", drawingId: "dwg_1", limit: null, offset: null,
    });
    const body = await response.json();
    expect(body.revisions).toHaveLength(1);
  });

  it("forwards a service failure with its status", async () => {
    listRevisions.mockResolvedValue({ ok: false, httpStatus: 404, error: "Drawing not found in this package." });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(404);
  });
});

describe("POST revisions", () => {
  it("creates an IFA revision and returns 201", async () => {
    createRevision.mockResolvedValue({
      ok: true, revision: { id: "forge_wpdrv_1", revisionCode: "A", issuedAs: "IFA" },
    });
    const input = { revisionCode: "A", documentRef: "s3://forge/p-101-a.pdf", contentSha256: SHA };
    const response = await POST(
      new Request("https://test/x", { method: "POST", body: JSON.stringify(input) }),
      { params: params() },
    );
    expect(response.status).toBe(201);
    expect(createRevision).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1", drawingId: "dwg_1", input,
    });
    expect((await response.json()).revision.revisionCode).toBe("A");
  });

  it("forwards a duplicate revision code as 409", async () => {
    createRevision.mockResolvedValue({ ok: false, httpStatus: 409, error: "A revision with this code already exists for the drawing." });
    const response = await POST(
      new Request("https://test/x", {
        method: "POST",
        body: JSON.stringify({ revisionCode: "A", documentRef: "s3://forge/x.pdf", contentSha256: SHA }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(409);
  });
});
