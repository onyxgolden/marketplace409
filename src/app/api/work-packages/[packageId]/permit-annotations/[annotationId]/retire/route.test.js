import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  requirePackageScope: vi.fn(async () => null),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => request.json(),
}));
vi.mock("@/application/work-management/permitAnnotations", () => ({ retirePermitAnnotation: vi.fn() }));

import { workAuth } from "../../../../_lib/auth.js";
import { retirePermitAnnotation } from "@/application/work-management/permitAnnotations";
import { POST } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1", annotationId: "forge_wppa_1" });

beforeEach(() => { vi.clearAllMocks(); workAuth.mockResolvedValue(AUTH); });

describe("POST /api/work-packages/[packageId]/permit-annotations/[annotationId]/retire", () => {
  it("retires the annotation", async () => {
    retirePermitAnnotation.mockResolvedValue({ ok: true, annotation: { id: "forge_wppa_1", version: 2 } });
    const request = new Request("https://test/x", {
      method: "POST",
      body: JSON.stringify({ expectedVersion: 1, reason: "Superseded" }),
    });
    const response = await POST(request, { params: params() });
    expect(response.status).toBe(200);
    expect(retirePermitAnnotation).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1", annotationId: "forge_wppa_1",
      input: { expectedVersion: 1, reason: "Superseded" },
    });
  });

  it("maps an already-retired annotation to 409", async () => {
    retirePermitAnnotation.mockResolvedValue({ ok: false, httpStatus: 409, error: "Retired permit links cannot be changed." });
    const request = new Request("https://test/x", {
      method: "POST",
      body: JSON.stringify({ expectedVersion: 1 }),
    });
    const response = await POST(request, { params: params() });
    expect(response.status).toBe(409);
  });
});
