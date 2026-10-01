import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({ getActiveWorkspaceRole: vi.fn() }));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { GET, POST } from "./route";

const depositRow = {
  id: "rental_bank_deposit_1", deposit_date: "2026-09-30", bank_account_id: "bank_1", memo: "",
  total_amount_cents: 160000, item_count: 1, deposit_event_id: "event_d", status: "active",
  void_reason: null, voided_at: null, created_at: "2026-09-30T00:00:00Z", updated_at: null,
};

const itemRow = {
  deposit_id: "rental_bank_deposit_1", financial_event_id: "event_1", seq: 0,
  tender: "check", check_number: "4412", received_from: "Eric Carrillo", amount_cents: 160000,
};

const incomeRow = {
  id: "event_1", amount: 1600.0, transaction_kind: "income", bank_account_id: null,
  is_deleted: false, status: "active", metadata: {},
};

function listBuilder(rows) {
  const b = {
    select() { return b; }, eq() { return b; }, order() { return b; }, in() { return b; },
    is() { return b; }, neq() { return b; }, filter() { return b; }, limit() { return b; },
    then(resolve) { resolve({ data: rows, error: null }); },
  };
  return b;
}

function singleBuilder(row) {
  const b = {
    select() { return b; }, eq() { return b; },
    maybeSingle() { return Promise.resolve({ data: row, error: null }); },
  };
  return b;
}

function authAs(client, role = "owner") {
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    user: { id: "user_1" }, effectiveOwnerId: "owner_1", supabaseClient: client,
  });
  getActiveWorkspaceRole.mockResolvedValue(role);
}

const get = (query = "") => GET(new Request(`https://t/${query}`));
const post = (body) => POST(new Request("https://t/", { method: "POST", body: JSON.stringify(body) }));

const goodBody = {
  id: "rental_bank_deposit_1",
  depositDate: "2026-09-30",
  bankAccountId: "bank_1",
  memo: "",
  items: [{ eventId: "event_1", tender: "check", checkNumber: "4412", receivedFrom: "Eric Carrillo" }],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/rental/bank-deposits", () => {
  it("lists deposits with their items", async () => {
    const client = {
      from: vi.fn((table) => {
        if (table === "rental_bank_deposits") return listBuilder([depositRow]);
        return listBuilder([itemRow]);
      }),
    };
    authAs(client);
    const response = await get();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.deposits).toHaveLength(1);
    expect(body.deposits[0]).toMatchObject({ totalAmountCents: 160000, status: "active" });
    expect(body.deposits[0].items).toHaveLength(1);
  });

  it("lists undeposited receipts for the deposit picker", async () => {
    const receipt = {
      id: "event_1", event_date: "2026-09-29", description: "Rent — Eric Carrillo",
      payee: "Eric Carrillo", check_number: null, property_id: "prop_1", amount: 1600.0,
    };
    const client = { from: vi.fn(() => listBuilder([receipt])) };
    authAs(client);
    const response = await get("?undeposited=true");
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.receipts).toHaveLength(1);
    expect(body.receipts[0]).toMatchObject({ eventId: "event_1", amountCents: 160000 });
  });

  it("returns an empty list when the tables are not migrated yet", async () => {
    const client = {
      from: vi.fn(() => { throw { code: "42P01", message: 'relation "rental_bank_deposits" does not exist' }; }),
    };
    authAs(client);
    const response = await get();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.deposits).toEqual([]);
  });
});

describe("POST /api/rental/bank-deposits", () => {
  function createClient({ rpcResult = { depositId: "rental_bank_deposit_1" }, rpcError = null, existing = null } = {}) {
    const depositsLookup = {
      select() { return depositsLookup; }, eq() { return depositsLookup; },
      maybeSingle: vi.fn()
        .mockResolvedValueOnce({ data: existing, error: null })
        .mockResolvedValue({ data: depositRow, error: null }),
    };
    return {
      from: vi.fn((table) => {
        if (table === "financial_events") return listBuilder([incomeRow]);
        if (table === "rental_bank_deposit_items") return listBuilder([itemRow]);
        // rental_bank_deposits: idempotency pre-check (null) vs post-RPC read (row).
        if (table === "rental_bank_deposits") return depositsLookup;
        return singleBuilder(null);
      }),
      rpc: vi.fn().mockResolvedValue({ data: rpcResult, error: rpcError }),
    };
  }

  it("records a deposit and returns 201", async () => {
    const client = createClient();
    authAs(client);
    const response = await post(goodBody);
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.deposit).toMatchObject({ id: "rental_bank_deposit_1", totalAmountCents: 160000 });
    expect(client.rpc).toHaveBeenCalledWith("record_bank_deposit", expect.objectContaining({ p_owner_id: "owner_1" }));
    const payload = client.rpc.mock.calls[0][1].p_deposit;
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]).toMatchObject({ eventId: "event_1", tender: "check", amountCents: 160000 });
  });

  it("403s for read-only members", async () => {
    authAs(createClient(), "read_only");
    const response = await post(goodBody);
    expect(response.status).toBe(403);
  });

  it("400s when a receipt is already on another deposit", async () => {
    const client = {
      from: vi.fn((table) => {
        if (table === "financial_events") {
          return listBuilder([incomeRow].map((e) => ({ ...e, metadata: { deposit_id: "rental_bank_deposit_9" } })));
        }
        return singleBuilder(null);
      }),
      rpc: vi.fn(),
    };
    authAs(client);
    const response = await post(goodBody);
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toContain("already on another deposit");
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("400s when a receipt is already banked (no double-banking)", async () => {
    const client = {
      from: vi.fn((table) => {
        if (table === "financial_events") return listBuilder([{ ...incomeRow, bank_account_id: "bank_9" }]);
        return singleBuilder(null);
      }),
      rpc: vi.fn(),
    };
    authAs(client);
    const response = await post(goodBody);
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toContain("already recorded against a bank account");
  });

  it("dedupes a retried submit on the same id", async () => {
    const client = createClient({ existing: depositRow });
    authAs(client);
    // findOwnedDeposit returns the row before the RPC runs.
    const response = await post(goodBody);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.deduplicated).toBe(true);
  });

  it("maps RPC validation errors to 400", async () => {
    const client = createClient({ rpcResult: null, rpcError: { code: "22023", message: "A receipt on this deposit is already on another deposit." } });
    // Skip the idempotency pre-check by returning no existing row.
    client.from = vi.fn((table) => {
      if (table === "financial_events") return listBuilder([incomeRow]);
      if (table === "rental_bank_deposit_items") return listBuilder([]);
      return singleBuilder(null);
    });
    authAs(client);
    const response = await post(goodBody);
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toContain("already on another deposit");
  });
});
