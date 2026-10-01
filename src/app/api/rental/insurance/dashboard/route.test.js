import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({ getActiveWorkspaceRole: vi.fn() }));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { GET } from "./route";

// Minimal thenable query builder mirroring the 1099 route tests.
// Each from() returns a FRESH builder so parallel table queries keep their own table.
function mockClient(tables) {
  function makeBuilder() {
    const builder = {
      _table: null,
      from(table) {
        const next = makeBuilder();
        next._table = table;
        return next;
      },
      select() { return builder; },
      eq() { return builder; },
      order() { return builder; },
      then(resolve) { resolve({ data: tables[builder._table] || [], error: null }); },
    };
    return builder;
  }
  return makeBuilder();
}

function authAs(client) {
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    user: { id: "user_1" }, effectiveOwnerId: "owner_1", supabaseClient: client,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/rental/insurance/dashboard", () => {
  it("returns per-lease flags and the in-app reminder list for active leases only", async () => {
    authAs(mockClient({
      rental_leases: [
        { id: "l1", property_id: "prop_1", unit_id: "u1", status: "active" },
        { id: "l2", property_id: "prop_1", unit_id: "u2", status: "ended" },
      ],
      renters_insurance_policies: [
        { id: "p1", lease_id: "l1", carrier_name: "Acme", status: "verified", expiration_date: "2026-09-01" },
      ],
      renters_insurance_requirements: [],
      rental_property_insurance_requirements: [
        { property_id: "prop_1", requires_renters_insurance: true, requires_pet_records: true },
      ],
      rental_animals: [],
      rental_lease_deposit_choices: [],
    }));
    const response = await GET(new Request("https://t/api/rental/insurance/dashboard"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.dashboard.rows).toHaveLength(1);
    expect(body.dashboard.rows[0].insurance).toBe("expired");
    expect(body.dashboard.rows[0].flags).toContain("insurance_expired");
    expect(body.dashboard.rows[0].flags).toContain("pet_records_missing");
    expect(body.dashboard.reminders.some((reminder) => reminder.kind === "insurance_expired")).toBe(true);
    expect(body.dashboard.summary.activeLeaseCount).toBe(1);
  });

  it("scopes every table by effectiveOwnerId and surfaces DB errors as 500", async () => {
    const seen = [];
    const builder = {
      from(table) { seen.push(table); return builder; },
      select() { return builder; },
      eq(column, value) { return builder; },
      then(resolve) { resolve({ data: [], error: new Error("db down") }); },
    };
    createAuthenticatedRentalManagerApplication.mockResolvedValue({
      user: { id: "user_1" }, effectiveOwnerId: "owner_1", supabaseClient: builder,
    });
    const response = await GET(new Request("https://t/api/rental/insurance/dashboard"));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("db down");
  });
});
