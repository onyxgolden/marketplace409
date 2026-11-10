import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../_lib/auth.js", () => ({
  workAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => { try { return await request.json(); } catch { return {}; } },
}));
vi.mock("@/application/work-management/changeOrders", () => ({
  setCraftRate: vi.fn(),
}));

import { workAuth } from "../../_lib/auth.js";
import { setCraftRate } from "@/application/work-management/changeOrders";
import { PUT } from "./route.js";

const AUTH = { db: { marker: "db" }, ownerId: "owner_1", actor: "user_9" };
const params = () => Promise.resolve({ packageId: "pkg_1" });

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("PUT /api/work-packages/[packageId]/craft-rates", () => {
  it("forwards the body to the service", async () => {
    setCraftRate.mockResolvedValue({
      ok: true,
      craftRate: { id: "forge_wcr_1", craftKey: "pipefitter", rateCentsPerHour: 10000, version: 1 },
      packageStatus: "in_progress",
    });
    const response = await PUT(
      new Request("https://test/x", {
        method: "PUT",
        body: JSON.stringify({ craftKey: "pipefitter", craftLabel: "Pipefitter", rateCentsPerHour: 10000, reason: "Site rate" }),
      }),
      { params: params() },
    );
    expect(response.status).toBe(200);
    expect(setCraftRate).toHaveBeenCalledWith(AUTH.db, {
      ownerId: "owner_1", packageId: "pkg_1",
      input: { craftKey: "pipefitter", craftLabel: "Pipefitter", rateCentsPerHour: 10000, reason: "Site rate" },
    });
    expect((await response.json()).craftRate.rateCentsPerHour).toBe(10000);
  });

  it("returns 400 when the service rejects the rate", async () => {
    setCraftRate.mockResolvedValue({ ok: false, httpStatus: 400, error: "Labor rate must be a whole number of cents per hour from 1 to 100,000." });
    const response = await PUT(
      new Request("https://test/x", { method: "PUT", body: JSON.stringify({ craftKey: "pipefitter", craftLabel: "Pipefitter", rateCentsPerHour: 0, reason: "Free labor" }) }),
      { params: params() },
    );
    expect(response.status).toBe(400);
  });
});
