// Foundation PR B fix round 1 — GET /api/rental/work-packages.
// The separate explicit Rental boundary for the property ledger's
// work-package read. The Planner list route no longer serves an
// unscoped owner-wide list, so the ledger reads here instead: an
// authenticated caller in the effective workspace, one canonical
// property, read-only. A missing propertyId is a 400; an
// unauthenticated caller never reaches the service.
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({
  createAuthenticatedForgeApplication: vi.fn(),
}));
vi.mock("@/application/work-management/workPackages", () => ({
  listWorkPackagesForRentalLedger: vi.fn(),
}));

import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { listWorkPackagesForRentalLedger } from "@/application/work-management/workPackages";
import { GET } from "./route.js";

const AUTH = { supabaseClient: {}, effectiveOwnerId: "owner_1", user: { id: "user_9" } };

beforeEach(() => {
  vi.clearAllMocks();
  createAuthenticatedForgeApplication.mockResolvedValue(AUTH);
});

describe("GET /api/rental/work-packages", () => {
  it("returns one property's packages, owner-scoped through the Rental boundary", async () => {
    listWorkPackagesForRentalLedger.mockResolvedValue({
      ok: true, packages: [{ id: "forge_wp_1", code: "WP-0007", title: "Turnover", status: "draft" }],
    });
    const response = await GET(new Request("https://test/api/rental/work-packages?propertyId=4800-kent-ave"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.packages).toHaveLength(1);
    expect(listWorkPackagesForRentalLedger).toHaveBeenCalledWith({}, {
      ownerId: "owner_1", propertyId: "4800-kent-ave",
    });
  });
  it("refuses a missing propertyId (400) without touching the service", async () => {
    const response = await GET(new Request("https://test/api/rental/work-packages"));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toMatch(/property is required/);
    expect(listWorkPackagesForRentalLedger).not.toHaveBeenCalled();
  });
  it("returns 401 when unauthenticated", async () => {
    createAuthenticatedForgeApplication.mockResolvedValueOnce({
      response: Response.json({ error: "no" }, { status: 401 }),
    });
    const response = await GET(new Request("https://test/api/rental/work-packages?propertyId=4800-kent-ave"));
    expect(response.status).toBe(401);
    expect(listWorkPackagesForRentalLedger).not.toHaveBeenCalled();
  });
});
