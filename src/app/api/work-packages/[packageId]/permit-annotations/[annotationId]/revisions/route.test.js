import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  requirePackageScope: vi.fn(async () => null),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
}));
vi.mock("@/application/work-management/permitAnnotations", () => ({ getPermitAnnotationHistory: vi.fn() }));

import { workAuth } from "../../../../_lib/auth.js";
import { getPermitAnnotationHistory } from "@/application/work-management/permitAnnotations";
import { GET } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1", annotationId: "forge_wppa_1" });

beforeEach(() => { vi.clearAllMocks(); workAuth.mockResolvedValue(AUTH); });

describe("GET /api/work-packages/[packageId]/permit-annotations/[annotationId]/revisions", () => {
  it("returns the revision history", async () => {
    getPermitAnnotationHistory.mockResolvedValue({ ok: true, revisions: [{ id: "r1", action: "create" }] });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revisions: [{ id: "r1", action: "create" }] });
    expect(getPermitAnnotationHistory).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1", annotationId: "forge_wppa_1",
    });
  });

  it("maps a missing annotation to 404", async () => {
    getPermitAnnotationHistory.mockResolvedValue({ ok: false, httpStatus: 404, error: "Permit link not found." });
    const response = await GET(new Request("https://test/x"), { params: params() });
    expect(response.status).toBe(404);
  });
});
