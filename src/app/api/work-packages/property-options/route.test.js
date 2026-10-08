import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => request.json(),
}));
vi.mock("@/application/work-management/workPackages", () => ({
  listPackagePropertyOptions: vi.fn(),
}));

import { workAuth } from "../_lib/auth.js";
import { listPackagePropertyOptions } from "@/application/work-management/workPackages";
import { GET } from "./route.js";

const request = () => new Request("https://test/api/work-packages/property-options");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/work-packages/property-options", () => {
  it("requires an authenticated workspace (401)", async () => {
    workAuth.mockResolvedValue({ error: Response.json({ error: "Sign in required." }, { status: 401 }) });
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(listPackagePropertyOptions).not.toHaveBeenCalled();
  });

  it("returns canonical property options for the effective owner only", async () => {
    workAuth.mockResolvedValue({ db: {}, ownerId: "owner_1", actor: "user_9" });
    listPackagePropertyOptions.mockResolvedValue({
      ok: true,
      properties: [{ slug: "1900-w-decker", label: "1900 W. Decker" }],
    });
    const response = await GET(request());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.properties).toEqual([{ slug: "1900-w-decker", label: "1900 W. Decker" }]);
    // Owner identity comes from the authenticated session, never the client.
    expect(listPackagePropertyOptions).toHaveBeenCalledWith({}, { ownerId: "owner_1" });
  });

  it("returns no options rather than fabricating properties", async () => {
    workAuth.mockResolvedValue({ db: {}, ownerId: "owner_1", actor: "user_9" });
    listPackagePropertyOptions.mockResolvedValue({ ok: true, properties: [] });
    const response = await GET(request());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.properties).toEqual([]);
  });
});
