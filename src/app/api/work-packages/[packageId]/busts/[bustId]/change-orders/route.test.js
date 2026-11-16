import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  requirePackageScope: vi.fn(async () => null),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/busts", () => ({
  linkChangeOrder: vi.fn(),
}));

import { workAuth, requirePackageScope } from "../../../../_lib/auth.js";
import { linkChangeOrder } from "@/application/work-management/busts";
import { POST } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1", bustId: "forge_wpbust_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
  requirePackageScope.mockResolvedValue(null);
});

describe("POST /api/work-packages/[packageId]/busts/[bustId]/change-orders", () => {
  it("links the order with 201 and the link row", async () => {
    linkChangeOrder.mockResolvedValue({
      ok: true,
      link: { id: "forge_wpbustco_1", changeOrderId: "co_2", version: 1 },
    });
    const response = await POST(
      new Request("https://test/x", {
        method: "POST",
        body: JSON.stringify({ changeOrderId: "co_2", requestId: "req_link_1", reason: "Covers the overrun." }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(201);
    expect(linkChangeOrder).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1", bustId: "forge_wpbust_1",
      changeOrderId: "co_2", requestId: "req_link_1", reason: "Covers the overrun.",
    });
    expect((await response.json()).link.id).toBe("forge_wpbustco_1");
  });

  it("returns 409 on a double link", async () => {
    linkChangeOrder.mockResolvedValue({ ok: false, httpStatus: 409, error: "This change order is already linked to the bust." });
    const response = await POST(
      new Request("https://test/x", {
        method: "POST",
        body: JSON.stringify({ changeOrderId: "co_2", reason: "Linking again." }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(409);
  });

  it("returns the auth error untouched", async () => {
    workAuth.mockResolvedValue({ error: Response.json({ error: "Unauthorized." }, { status: 401 }) });
    const response = await POST(
      new Request("https://test/x", { method: "POST", body: JSON.stringify({ changeOrderId: "co_2", reason: "Linking." }) }),
      { params: params() },
    );
    expect(response.status).toBe(401);
    expect(linkChangeOrder).not.toHaveBeenCalled();
  });

  it("returns the package-scope failure untouched", async () => {
    requirePackageScope.mockResolvedValue(Response.json({ error: "Package not found." }, { status: 404 }));
    const response = await POST(
      new Request("https://test/x", { method: "POST", body: JSON.stringify({ changeOrderId: "co_2", reason: "Linking." }) }),
      { params: params() },
    );
    expect(response.status).toBe(404);
    expect(linkChangeOrder).not.toHaveBeenCalled();
  });
});
