import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({ getActiveWorkspaceRole: vi.fn() }));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { GET as exportFile } from "./route";

// R23 CHANGES fix: full-TIN export is primary owner / active co-owner ONLY.
// Managers, bookkeepers, and read-only members must get 403 — the endpoint
// decrypts full TINs, and those never leave the owner's hands.

function chain(data = []) {
  const q = {
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    then: undefined,
  };
  q.then = (resolve) => Promise.resolve({ data, error: null }).then(resolve);
  return q;
}

function authAs(role) {
  const supabaseClient = { from: vi.fn(() => chain([])) };
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    user: { id: "user_1" },
    effectiveOwnerId: "owner_1",
    supabaseClient,
  });
  // Primary owners have no workspace_members row (null role).
  getActiveWorkspaceRole.mockResolvedValue(role);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("1099 export full-TIN authorization", () => {
  it("allows the primary owner (null role)", async () => {
    authAs(null);
    const response = await exportFile(new Request("https://t/api/rental/1099/export?taxYear=2026&format=csv"));
    // CSV export with no recipients succeeds (200) — the point is it is NOT 403.
    expect(response.status).not.toBe(403);
  });

  it("allows an active co-owner", async () => {
    authAs("co_owner");
    const response = await exportFile(new Request("https://t/api/rental/1099/export?taxYear=2026&format=csv"));
    expect(response.status).not.toBe(403);
  });

  it("403s a manager (full TINs never leave the owner's hands)", async () => {
    authAs("manager");
    const response = await exportFile(new Request("https://t/api/rental/1099/export?taxYear=2026&format=csv"));
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toContain("primary owner");
  });

  it("403s a bookkeeper", async () => {
    authAs("bookkeeper");
    const response = await exportFile(new Request("https://t/api/rental/1099/export?taxYear=2026&format=csv"));
    expect(response.status).toBe(403);
  });

  it("403s a read-only member", async () => {
    authAs("read_only");
    const response = await exportFile(new Request("https://t/api/rental/1099/export?taxYear=2026&format=csv"));
    expect(response.status).toBe(403);
  });
});
