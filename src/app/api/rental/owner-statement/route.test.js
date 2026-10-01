import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({
  createAuthenticatedRentalManagerApplication: vi.fn(),
}));
vi.mock("@/domains/rentec-financial-history-import/fetchAllOwnerFinancialEvents", () => ({
  fetchAllOwnerFinancialEvents: vi.fn(),
}));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { fetchAllOwnerFinancialEvents } from "@/domains/rentec-financial-history-import/fetchAllOwnerFinancialEvents";
import { GET } from "./route";

function chainFor({ list = { data: [], error: null } } = {}) {
  const chain = {};
  for (const method of ["select", "eq"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (resolve) => resolve(list);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/rental/owner-statement", () => {
  it("builds a monthly statement with beginning and ending balances", async () => {
    createAuthenticatedRentalManagerApplication.mockResolvedValue({
      user: { id: "user-1" },
      effectiveOwnerId: "owner_1",
      supabaseClient: {
        from: vi.fn(() => chainFor({ list: { data: [{ id: "m1", property_id: null, kind: "disbursement", amount: 300, movement_date: "2026-09-12", method: "check", memo: "Owner draw", status: "active" }], error: null } })),
      },
    });
    fetchAllOwnerFinancialEvents.mockResolvedValue([
      { id: "e0", event_date: "2026-08-20", description: "August rent", amount: 1600, transaction_kind: "income", normalized_category: "rental_income", property_id: null, status: "active", is_deleted: false },
      { id: "e1", event_date: "2026-09-05", description: "September rent", amount: 1600, transaction_kind: "income", normalized_category: "rental_income", property_id: null, status: "active", is_deleted: false },
      { id: "e2", event_date: "2026-09-08", description: "Plumber", amount: 250, transaction_kind: "expense", normalized_category: "property_repairs", property_id: null, status: "active", is_deleted: false },
    ]);

    const response = await GET(new Request("https://test/api/rental/owner-statement?month=2026-09"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.statement.periodStart).toBe("2026-09-01");
    expect(body.statement.periodEnd).toBe("2026-09-30");
    expect(body.statement.beginningBalanceCents).toBe(160000);
    expect(body.statement.periodIncomeCents).toBe(160000);
    expect(body.statement.periodExpenseCents).toBe(25000);
    expect(body.statement.periodDisbursementCents).toBe(30000);
    expect(body.statement.endingBalanceCents).toBe(160000 + 160000 - 25000 - 30000);
  });

  it("is readable by read-only members (no role gate on the read surface)", async () => {
    createAuthenticatedRentalManagerApplication.mockResolvedValue({
      user: { id: "user-2" },
      effectiveOwnerId: "owner_1",
      supabaseClient: { from: vi.fn(() => chainFor()) },
    });
    fetchAllOwnerFinancialEvents.mockResolvedValue([]);
    const response = await GET(new Request("https://test/api/rental/owner-statement?month=2026-09"));
    expect(response.status).toBe(200);
  });

  it("rejects a malformed month", async () => {
    createAuthenticatedRentalManagerApplication.mockResolvedValue({
      user: { id: "user-1" },
      effectiveOwnerId: "owner_1",
      supabaseClient: { from: vi.fn(() => chainFor()) },
    });
    for (const month of ["2026-13", "september", ""]) {
      const response = await GET(new Request(`https://test/api/rental/owner-statement?month=${month}`));
      expect(response.status).toBe(400);
    }
  });
});
