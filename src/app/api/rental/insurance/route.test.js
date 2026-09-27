import { beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.fn();
const authenticated = { user: { id: "owner_1" }, supabaseClient: { from } };
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({ createAuthenticatedForgeApplication: vi.fn(async () => authenticated) }));
import { GET } from "./route.js";

// Every query-builder method returns the chain itself; the chain is directly
// thenable, matching how route.js awaits it.
function chain(result) {
  const value = {};
  for (const method of ["select", "order"]) {
    value[method] = vi.fn(() => value);
  }
  value.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return value;
}

describe("rental insurance GET", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns just the owner's insurance policies as a small scoped query", async () => {
    const policies = [{ id: "pol_1", carrier_name: "Acme", status: "verified", expiration_date: "2027-01-01" }];
    from.mockReturnValue(chain({ data: policies, error: null }));
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.policies).toEqual(policies);
    // Scoped to the one small table the panel needs -- not the /api/rental
    // aggregate that pulls dozens of tables (that was the ~50s load).
    expect(from).toHaveBeenCalledWith("renters_insurance_policies");
    const selectArg = from.mock.results[0].value.select.mock.calls[0][0];
    for (const column of ["id", "carrier_name", "status", "expiration_date", "policy_number_masked", "effective_date", "liability_limit_cents", "verified_at"]) {
      expect(selectArg).toContain(column);
    }
  });

  it("returns a 500 with a message when the query fails", async () => {
    from.mockReturnValue(chain({ data: null, error: new Error("db down") }));
    const response = await GET();
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBeTruthy();
  });
});
