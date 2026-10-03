import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => request.json(),
}));
vi.mock("@/application/work-management/workPackages", () => ({
  transitionWorkPackage: vi.fn(),
}));

import { workAuth } from "../../_lib/auth.js";
import { transitionWorkPackage } from "@/application/work-management/workPackages";
import { POST } from "./route.js";

const AUTH = { db: {}, ownerId: "owner_1", actor: "user_9" };
const params = (packageId = "forge_wp_1") => Promise.resolve({ packageId });
function request(body) {
  return new Request("https://test/api/work-packages/forge_wp_1/transition", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("POST /api/work-packages/[packageId]/transition", () => {
  it("transitions and returns the updated package", async () => {
    transitionWorkPackage.mockResolvedValue({ ok: true, package: { id: "forge_wp_1", status: "in_progress" } });
    const response = await POST(request({ to: "in_progress", userConfirmedStart: true }), { params: params() });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.package.status).toBe("in_progress");
    expect(transitionWorkPackage).toHaveBeenCalledWith({}, {
      ownerId: "owner_1", actor: "user_9", packageId: "forge_wp_1",
      to: "in_progress", ctx: { userConfirmedStart: true },
    });
  });
  it("requires a target status", async () => {
    const response = await POST(request({}), { params: params() });
    expect(response.status).toBe(400);
  });
  it("maps illegal transitions to 409", async () => {
    transitionWorkPackage.mockResolvedValue({ ok: false, httpStatus: 409, error: "Illegal transition draft -> in_progress." });
    const response = await POST(request({ to: "in_progress" }), { params: params() });
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.error).toMatch("Illegal transition");
  });
});
