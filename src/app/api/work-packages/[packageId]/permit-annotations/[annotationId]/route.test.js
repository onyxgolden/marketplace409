import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => request.json(),
}));
vi.mock("@/application/work-management/permitAnnotations", () => ({ updatePermitAnnotation: vi.fn() }));

import { workAuth } from "../../../_lib/auth.js";
import { updatePermitAnnotation } from "@/application/work-management/permitAnnotations";
import { PATCH } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1", annotationId: "forge_wppa_1" });

beforeEach(() => { vi.clearAllMocks(); workAuth.mockResolvedValue(AUTH); });

describe("PATCH /api/work-packages/[packageId]/permit-annotations/[annotationId]", () => {
  it("updates the annotation", async () => {
    updatePermitAnnotation.mockResolvedValue({ ok: true, annotation: { id: "forge_wppa_1", version: 2 } });
    const request = new Request("https://test/x", {
      method: "PATCH",
      body: JSON.stringify({ expectedVersion: 1, label: "Renamed" }),
    });
    const response = await PATCH(request, { params: params() });
    expect(response.status).toBe(200);
    expect(updatePermitAnnotation).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1", annotationId: "forge_wppa_1",
      patch: { expectedVersion: 1, label: "Renamed" },
    });
  });

  it("maps a version conflict to 409", async () => {
    updatePermitAnnotation.mockResolvedValue({ ok: false, httpStatus: 409, error: "This permit link was changed by someone else — refresh and try again." });
    const request = new Request("https://test/x", {
      method: "PATCH",
      body: JSON.stringify({ expectedVersion: 1, label: "Renamed" }),
    });
    const response = await PATCH(request, { params: params() });
    expect(response.status).toBe(409);
  });
});
