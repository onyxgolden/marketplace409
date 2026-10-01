import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
vi.mock("@/lib/supabase/isOwnerOrActiveCoOwner", () => ({ isOwnerOrActiveCoOwner: vi.fn() }));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { isOwnerOrActiveCoOwner } from "@/lib/supabase/isOwnerOrActiveCoOwner";
import { GET, POST } from "./route";

// Chainable supabase stub with canned responses and call recording.
function makeDb(overrides = {}) {
  const calls = { upsert: [] };
  const table = {
    select() { return table; },
    eq() { return table; },
    async maybeSingle() { return { data: overrides.oneRow ?? null, error: null }; },
    upsert(rows, options) { calls.upsert.push([rows, options]); return table; },
    async single() { return { data: overrides.upsertedRow ?? null, error: overrides.upsertError || null }; },
  };
  return { db: { from: vi.fn(() => table) }, calls };
}

const VALID_TERMS = {
  tenant: { singular: "resident", plural: "residents" },
  property: { singular: "unit", plural: "units" },
  lease: { singular: "rental agreement", plural: "rental agreements" },
  owner: { singular: "landlord", plural: "landlords" },
  vendor: { singular: "contractor", plural: "contractors" },
};

// The workspace role model: the primary owner has no membership row and an
// active co-owner row means the spouse — both pass isOwnerOrActiveCoOwner.
// Staff roles (manager, bookkeeper, read_only) must be rejected.
function authAs(db, household = true) {
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    user: { id: "user_1" }, effectiveOwnerId: "owner_1", supabaseClient: db,
  });
  isOwnerOrActiveCoOwner.mockResolvedValue(household);
}

beforeEach(() => { vi.clearAllMocks(); });

describe("terminology route", () => {
  it("GET returns defaults when no row exists", async () => {
    const { db } = makeDb({ oneRow: null });
    authAs(db);
    const res = await GET(new Request("https://t/"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.terms.tenant).toEqual({ singular: "tenant", plural: "tenants" });
    expect(body.updatedAt).toBeNull();
  });

  it("GET merges a stored row over the defaults", async () => {
    const { db } = makeDb({ oneRow: { terms: { tenant: { singular: "resident", plural: "residents" } }, updated_at: "2026-10-01T00:00:00Z" } });
    authAs(db);
    const res = await GET(new Request("https://t/"));
    const body = await res.json();
    expect(body.terms.tenant).toEqual({ singular: "resident", plural: "residents" });
    expect(body.terms.vendor).toEqual({ singular: "vendor", plural: "vendors" });
    expect(body.updatedAt).toBe("2026-10-01T00:00:00Z");
  });

  it("POST validates, trims, and upserts the cleaned map", async () => {
    const { db, calls } = makeDb({ upsertedRow: { terms: VALID_TERMS, updated_at: "2026-10-01T00:00:00Z" } });
    authAs(db);
    const res = await POST(new Request("https://t/", { method: "POST", body: JSON.stringify({ terms: VALID_TERMS }) }));
    expect(res.status).toBe(200);
    expect(calls.upsert).toHaveLength(1);
    const [rows, options] = calls.upsert[0];
    expect(rows.owner_id).toBe("owner_1");
    expect(rows.terms).toEqual(VALID_TERMS);
    expect(rows.updated_by).toBe("user_1");
    expect(options).toMatchObject({ onConflict: "owner_id" });
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("POST rejects invalid maps with 400 and never writes", async () => {
    const { db, calls } = makeDb();
    authAs(db);
    const res = await POST(new Request("https://t/", {
      method: "POST",
      body: JSON.stringify({ terms: { ...VALID_TERMS, owner: { singular: "Resident", plural: "landlords" } } }),
    }));
    expect(res.status).toBe(400);
    expect(calls.upsert).toHaveLength(0);
    const body = await res.json();
    expect(body.error).toMatch(/already used/);
  });

  it("POST rejects staff roles with 403 — only owner/co-owner may change terminology", async () => {
    for (const [role, household] of [["manager", false], ["bookkeeper", false], ["read_only", false]]) {
      vi.clearAllMocks();
      const { db, calls } = makeDb();
      authAs(db, household);
      const res = await POST(new Request("https://t/", { method: "POST", body: JSON.stringify({ terms: VALID_TERMS }) }));
      expect(res.status, role).toBe(403);
      expect(calls.upsert, role).toHaveLength(0);
      expect(isOwnerOrActiveCoOwner).toHaveBeenCalledWith({
        supabaseClient: db,
        actorUserId: "user_1",
      });
    }
  });

  it("POST allows the primary owner and active co-owner", async () => {
    for (const [role, household] of [["primary owner (no membership row)", true], ["co_owner", true]]) {
      vi.clearAllMocks();
      const { db, calls } = makeDb({ upsertedRow: { terms: VALID_TERMS, updated_at: "2026-10-01T00:00:00Z" } });
      authAs(db, household);
      const res = await POST(new Request("https://t/", { method: "POST", body: JSON.stringify({ terms: VALID_TERMS }) }));
      expect(res.status, role).toBe(200);
      expect(calls.upsert, role).toHaveLength(1);
    }
  });

  it("GET stays readable for read-only members", async () => {
    const { db } = makeDb({ oneRow: null });
    authAs(db, "read_only");
    const res = await GET(new Request("https://t/"));
    expect(res.status).toBe(200);
  });
});
