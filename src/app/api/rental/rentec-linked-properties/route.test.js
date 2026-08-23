import { beforeEach, describe, expect, it, vi } from "vitest";

const authenticated = { user: { id: "owner_1" }, supabaseClient: {} };
const unauthenticatedResponse = { response: new Response(JSON.stringify({ error: "Authenticated owner id is required." }), { status: 401 }) };
const createAuthenticatedForgeApplication = vi.fn(async () => authenticated);
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({ createAuthenticatedForgeApplication: (...args) => createAuthenticatedForgeApplication(...args) }));

import { GET } from "./route.js";

function chain(data) {
  const calls = { eq: [], not: [] };
  const node = {
    eq: (...args) => { calls.eq.push(args); return node; },
    not: (...args) => { calls.not.push(args); return node; },
    order: () => node,
    then: (resolve) => resolve({ data, error: null }),
  };
  node.__calls = calls;
  return { select: () => node };
}

describe("rentec linked properties route", () => {
  beforeEach(() => { vi.clearAllMocks(); createAuthenticatedForgeApplication.mockResolvedValue(authenticated); });

  it("rejects unauthenticated callers", async () => {
    createAuthenticatedForgeApplication.mockResolvedValueOnce(unauthenticatedResponse);
    const response = await GET();
    expect(response.status).toBe(401);
  });

  it("returns only this owner's Rentec-linked units, with a human-readable label", async () => {
    const rows = [{ id: "unit_1", label: "1218 Wagner St", property_id: "kent" }];
    createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: { from: () => chain(rows) } });
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.properties).toEqual([{ id: "unit_1", label: "1218 Wagner St" }]);
  });

  it("scopes the query to owner_id, source_system='rentec', and a non-null source_record_id — never an unlinked unit", async () => {
    const table = chain([]);
    createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: { from: () => table } });
    await GET();
    expect(table.select().__calls.eq).toContainEqual(["owner_id", "owner_1"]);
    expect(table.select().__calls.eq).toContainEqual(["source_system", "rentec"]);
    expect(table.select().__calls.not).toContainEqual(["source_record_id", "is", null]);
  });

  it("returns an empty list — never an error — when no properties are linked yet", async () => {
    createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: { from: () => chain([]) } });
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.properties).toEqual([]);
  });

  it("disambiguates two linked units that share the exact same label by appending the FORGE property grouping", async () => {
    const rows = [
      { id: "unit_1", label: "Main St", property_id: "kent" },
      { id: "unit_2", label: "Main St", property_id: "rachal" },
    ];
    createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: { from: () => chain(rows) } });
    const response = await GET();
    const body = await response.json();
    expect(body.properties).toEqual([
      { id: "unit_1", label: "Main St (kent)" },
      { id: "unit_2", label: "Main St (rachal)" },
    ]);
  });

  it("does not disambiguate a unique label", async () => {
    const rows = [{ id: "unit_1", label: "1218 Wagner St", property_id: "kent" }];
    createAuthenticatedForgeApplication.mockResolvedValueOnce({ ...authenticated, supabaseClient: { from: () => chain(rows) } });
    const response = await GET();
    const body = await response.json();
    expect(body.properties[0].label).toBe("1218 Wagner St");
  });
});
