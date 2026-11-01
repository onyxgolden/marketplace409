import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({
  getActiveWorkspaceRole: vi.fn(async () => null),
}));
vi.mock("@/lib/supabase/isOwnerOrActiveCoOwner", () => ({
  isOwnerOrActiveCoOwner: vi.fn(async () => true),
}));

const mockedAuth = vi.hoisted(() => ({ current: null }));
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({
  createAuthenticatedRentalManagerApplication: vi.fn(async () => mockedAuth.current),
}));
vi.mock("@/infrastructure/billing/StripeBillingProvider", () => ({
  createStripeBillingProvider: vi.fn(() => null),
}));

import { POST } from "./route.js";

// Scripted supabase client for the deposit tables: lookups resolve
// script[table].lookup, updates resolve script[table].updated, and awaited
// list selects resolve script[table].list.
function depositClient(script) {
  const updates = [];
  function query(table) {
    const q = {
      _updated: null,
      select() { return q; },
      eq() { return q; },
      update(values) { updates.push({ table, values }); q._updated = values; return q; },
      async maybeSingle() { return { data: script[table]?.lookup ?? null, error: null }; },
      async single() { return { data: script[table]?.updated ?? null, error: null }; },
      then(resolve) { resolve({ data: script[table]?.list ?? [], error: null }); },
    };
    return q;
  }
  return { updates, client: { from: (table) => query(table), rpc: async () => ({ data: null, error: null }) } };
}

function post(body) {
  return POST(new Request("http://localhost/api/rental", { method: "POST", body: JSON.stringify(body) }));
}

function authFor(script) {
  const { updates, client } = depositClient(script);
  mockedAuth.current = { application: {}, user: { id: "owner_1" }, effectiveOwnerId: "owner_1", supabaseClient: client };
  return updates;
}

describe("update-security-deposit (controls sweep G6)", () => {
  it("edits amount and jurisdiction on a live requirement", async () => {
    const updates = authFor({
      rental_security_deposits: { lookup: { id: "dep_1", status: "required" }, updated: { id: "dep_1", status: "required", required_amount_cents: 190000, jurisdiction_code: "TX" } },
    });
    const response = await post({ operation: "update-security-deposit", deposit: { depositId: "dep_1", requiredAmountCents: 190000, jurisdictionCode: "TX" } });
    expect(response.status).toBe(200);
    expect((await response.json()).deposit.required_amount_cents).toBe(190000);
    expect(updates[0].values.required_amount_cents).toBe(190000);
  });

  it("refuses void, closed, and missing requirements", async () => {
    for (const status of ["void", "closed"]) {
      authFor({ rental_security_deposits: { lookup: { id: "dep_1", status } } });
      const response = await post({ operation: "update-security-deposit", deposit: { depositId: "dep_1", requiredAmountCents: 100 } });
      expect(response.status).toBe(409);
    }
    authFor({ rental_security_deposits: { lookup: null } });
    expect((await post({ operation: "update-security-deposit", deposit: { depositId: "dep_1", requiredAmountCents: 100 } })).status).toBe(404);
  });
});

describe("void-security-deposit (controls sweep G6)", () => {
  it("voids a requirement with a zero held balance", async () => {
    authFor({
      rental_security_deposits: { lookup: { id: "dep_1", status: "required" }, updated: { id: "dep_1", status: "void" } },
      rental_security_deposit_transactions: { list: [] },
    });
    const response = await post({ operation: "void-security-deposit", depositId: "dep_1" });
    expect(response.status).toBe(200);
    expect((await response.json()).deposit.status).toBe("void");
  });

  it("refuses while money is held and when already void", async () => {
    authFor({
      rental_security_deposits: { lookup: { id: "dep_1", status: "held" }, updated: null },
      rental_security_deposit_transactions: { list: [{ transaction_type: "received", amount_cents: 180000, voided_at: null }] },
    });
    const held = await post({ operation: "void-security-deposit", depositId: "dep_1" });
    expect(held.status).toBe(409);
    expect((await held.json()).error).toMatch(/held balance is \$0/);
    authFor({ rental_security_deposits: { lookup: { id: "dep_1", status: "void" } } });
    expect((await post({ operation: "void-security-deposit", depositId: "dep_1" })).status).toBe(409);
  });
});

describe("void-security-deposit-transaction (controls sweep G6)", () => {
  it("voids a received transaction and recomputes the requirement to required", async () => {
    const updates = authFor({
      rental_security_deposit_transactions: {
        lookup: { id: "tx_1", deposit_id: "dep_1", transaction_type: "received", amount_cents: 180000, voided_at: null },
        list: [{ transaction_type: "received", amount_cents: 180000, voided_at: null }],
        updated: { id: "tx_1", voided_at: "2026-10-31T00:00:00.000Z", void_reason: "Mistyped amount" },
      },
      rental_security_deposits: { lookup: { id: "dep_1", status: "held", required_amount_cents: 180000 }, updated: { id: "dep_1", status: "required" } },
    });
    const response = await post({ operation: "void-security-deposit-transaction", transactionId: "tx_1", reason: "Mistyped amount" });
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.balanceCents).toBe(0);
    expect(json.deposit.status).toBe("required");
    expect(updates.find((call) => call.table === "rental_security_deposit_transactions").values.void_reason).toBe("Mistyped amount");
  });

  it("refuses a void that would leave a negative balance, an already-void row, and a void requirement's rows", async () => {
    authFor({
      rental_security_deposit_transactions: {
        lookup: { id: "tx_1", deposit_id: "dep_1", transaction_type: "received", amount_cents: 180000, voided_at: null },
        list: [
          { transaction_type: "received", amount_cents: 180000, voided_at: null },
          { transaction_type: "deduction", amount_cents: 180000, voided_at: null },
        ],
      },
      rental_security_deposits: { lookup: { id: "dep_1", status: "closed", required_amount_cents: 180000 } },
    });
    const negative = await post({ operation: "void-security-deposit-transaction", transactionId: "tx_1", reason: "x" });
    expect(negative.status).toBe(409);
    expect((await negative.json()).error).toMatch(/negative held balance/);

    authFor({
      rental_security_deposit_transactions: { lookup: { id: "tx_1", voided_at: "2026-10-31T00:00:00.000Z" } },
      rental_security_deposits: { lookup: { id: "dep_1", status: "held" } },
    });
    expect((await post({ operation: "void-security-deposit-transaction", transactionId: "tx_1", reason: "x" })).status).toBe(409);

    authFor({
      rental_security_deposit_transactions: { lookup: { id: "tx_1", deposit_id: "dep_1", transaction_type: "received", amount_cents: 100, voided_at: null } },
      rental_security_deposits: { lookup: { id: "dep_1", status: "void" } },
    });
    expect((await post({ operation: "void-security-deposit-transaction", transactionId: "tx_1", reason: "x" })).status).toBe(409);
  });
});
