import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  fetchEvents: vi.fn(),
}));
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({
  createAuthenticatedRentalManagerApplication: mocks.authenticate,
}));
vi.mock("@/domains/rentec-financial-history-import/fetchAllOwnerFinancialEvents", () => ({
  fetchAllOwnerFinancialEvents: mocks.fetchEvents,
}));

import { GET } from "./route";

// Minimal thenable query builder: every chain method returns the builder, and
// awaiting it resolves the canned result for the table.
function fakeQuery(result) {
  const builder = {};
  for (const method of ["select", "eq", "order", "limit"]) {
    builder[method] = () => builder;
  }
  builder.then = (resolve) => resolve(result);
  return builder;
}

const accountRows = [
  { id: "acct-1", name: "Business Checking", official_name: "Chase Business Checking", type: "depository", active: true },
];

function fakeClient({ eventRows = [], unitRows = [], tenantRows = [] } = {}) {
  return {
    from: (table) => {
      if (table === "financial_accounts") return fakeQuery({ data: accountRows, error: null });
      if (table === "rental_units") return fakeQuery({ data: unitRows, error: null });
      if (table === "rental_tenants") return fakeQuery({ data: tenantRows, error: null });
      return fakeQuery({ data: [], error: null });
    },
  };
}

function authed(client) {
  mocks.authenticate.mockResolvedValue({
    response: null,
    user: { id: "user-1" },
    supabaseClient: client,
    effectiveOwnerId: "owner-1",
  });
}

function getRequest(bankAccountId = "acct-1") {
  return new Request(`http://localhost/api/rental/bank-ledger?bankAccountId=${bankAccountId}`);
}

describe("GET /api/rental/bank-ledger", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the register with transfer metadata and property/tenant labels", async () => {
    mocks.fetchEvents.mockResolvedValue([
      {
        id: "event-out", event_date: "2026-09-05", description: "Transfer to Business Savings",
        amount: 500, transaction_kind: "expense", normalized_category: "transfer",
        property_id: null, payee: null, check_number: null, bank_account_id: "acct-1",
        cleared: false, cleared_at: null, source_system: "manual", status: "active", is_deleted: false,
        transfer_group_id: "transfer_abc",
        metadata: {
          memo: "Owner draw",
          transfer_direction: "out",
          counterpart_account_id: "acct-2",
          counterpart_account_name: "Business Savings",
          counterpart_event_id: "event-in",
        },
      },
      {
        id: "event-rent", event_date: "2026-09-01", description: "Rent received",
        amount: 1600, transaction_kind: "income", normalized_category: "rental income",
        property_id: "prop-1", payee: null, check_number: null, bank_account_id: "acct-1",
        cleared: true, cleared_at: "2026-09-02T10:00:00Z", source_system: "manual", status: "active", is_deleted: false,
        transfer_group_id: null,
        metadata: { tenant_id: "tenant-1" },
      },
    ]);
    authed(fakeClient({
      unitRows: [{ property_id: "prop-1", label: "308 Paula" }],
      tenantRows: [{ id: "tenant-1", display_name: "Eric Carrillo" }],
    }));

    const response = await GET(getRequest());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.ledger.entries).toHaveLength(2);

    const transferLeg = body.ledger.entries.find((entry) => entry.sourceId === "event-out");
    expect(transferLeg.transferGroupId).toBe("transfer_abc");
    expect(transferLeg.transferDirection).toBe("out");
    expect(transferLeg.counterpartAccountId).toBe("acct-2");
    expect(transferLeg.counterpartAccountName).toBe("Business Savings");
    expect(transferLeg.counterpartEventId).toBe("event-in");
    expect(transferLeg.memo).toBe("Owner draw");

    const rentRow = body.ledger.entries.find((entry) => entry.sourceId === "event-rent");
    expect(rentRow.propertyId).toBe("prop-1");
    expect(rentRow.propertyLabel).toBe("308 Paula");
    expect(rentRow.tenantId).toBe("tenant-1");
    expect(rentRow.tenantLabel).toBe("Eric Carrillo");
  });

  it("404s on an unknown account id", async () => {
    mocks.fetchEvents.mockResolvedValue([]);
    const client = fakeClient();
    client.from = (table) => {
      if (table === "financial_accounts") return fakeQuery({ data: [], error: null });
      return fakeQuery({ data: [], error: null });
    };
    authed(client);

    const response = await GET(getRequest("nope"));
    expect(response.status).toBe(404);
  });
});
