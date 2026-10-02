import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
vi.mock("@/lib/rental/teamAuthorization", () => ({ requireRentalPermission: vi.fn() }));
vi.mock("@/application/rental/chartOfAccounts", () => ({
  getChartAccounts: vi.fn(),
  isChartTableMissing: () => false,
}));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { NextResponse } from "next/server";
import { requireRentalPermission } from "@/lib/rental/teamAuthorization";

// R17: writes gate through requireRentalPermission (server-side permission check).
function gateFor(role) {
  if (role === "read_only") {
    requireRentalPermission.mockResolvedValue({
      response: NextResponse.json({ error: "Your team role does not allow this." }, { status: 403 }),
      authorization: { role: "read_only", permissions: [] },
    });
  } else {
    requireRentalPermission.mockResolvedValue({ response: null, authorization: { permissions: [] } });
  }
}

import { getChartAccounts } from "@/application/rental/chartOfAccounts";
import { GET, PATCH } from "./route";

const bill = {
  id: "rental_vendor_bill_1", vendor_id: "rental_vendor_1", property_id: "prop_1",
  bill_date: "2026-09-15", due_date: "2026-10-15",
  amount_cents: 25000, paid_amount_cents: 0, expense_account_code: "property_repairs",
  memo: "Water heater", attachment_reference: null, status: "open",
  void_reason: null, voided_at: null, created_at: null, updated_at: null,
};

const chartAccounts = [
  { code: "property_repairs", label: "Repairs", account_type: "expense", is_active: true },
  { code: "utilities", label: "Utilities", account_type: "expense", is_active: true },
];

function authAs(client, role = "owner") {
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    user: { id: "user_1" }, effectiveOwnerId: "owner_1", supabaseClient: client,
  });
  gateFor(role);
}

// Read: from(bills).select.eq.eq.maybeSingle; vendor name lookup on vendors;
// R18 audit trail on rental_void_audits.
// Write (void/edit): from(bills).update(patch).eq.eq.eq[.eq].select.single —
// the extra write-time guards mean zero rows when the bill changed concurrently.
// Un-void write: atomic RPC unvoid_vendor_bill (replaces the two-step update +
// audit insert); the replacement-supersession read is a list query.
function clientFor({ billRow = bill, writeResult = "updated", candidates = [], rpcResult = null } = {}) {
  let lastPatch = null;
  const listChain = () => {
    const b = { select: () => b, eq: () => b, neq: () => b, order: () => b };
    b.then = (resolve) => resolve({ data: candidates, error: null });
    return b;
  };
  const client = {
    from: vi.fn((table) => {
      if (table === "rental_vendor_bills") {
        return {
          select: () => ({ eq: () => ({ eq: () => ({
            maybeSingle: () => Promise.resolve({ data: billRow, error: null }),
            single: () => Promise.resolve({ data: { ...billRow, status: "open" }, error: null }),
          }) }) }),
          update: (patch) => {
            lastPatch = patch;
            const chain = { eq: () => chain, select: () => ({ single: () => Promise.resolve(writeResult === "updated" ? { data: { ...billRow, ...patch }, error: null } : { data: null, error: { code: "PGRST116" } }) }) };
            return chain;
          },
        };
      }
      if (table === "rental_void_audits") {
        const chain = { eq: () => chain, order: () => Promise.resolve({ data: [], error: null }) };
        return { select: () => chain };
      }
      return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { name: "Acme Plumbing" }, error: null }) }) }) }) };
    }),
    // R17/R18: atomic un-void RPC. Default resolves with the reopened bill row.
    rpc: vi.fn(() => Promise.resolve(rpcResult || { data: { id: bill.id, status: "open" }, error: null })),
  };
  // Tag the bills-table mock so un-void tests can distinguish the list query.
  const origFrom = client.from;
  client.from = vi.fn((table) => {
    const built = origFrom(table);
    if (table === "rental_vendor_bills") {
      const origSelect = built.select;
      built.select = (...args) => {
        const sel = origSelect(...args);
        // The supersession check selects a narrow column list (no paid_amount_cents)
        // and awaits as a list.
        if (typeof args[0] === "string" && args[0].includes("created_at") && !args[0].includes("paid_amount_cents")) {
          return listChain();
        }
        return sel;
      };
    }
    return built;
  });
  return { client, lastPatch: () => lastPatch };
}

const get = () => GET(new Request("https://t/"), { params: { id: "rental_vendor_bill_1" } });
const patch = (body) => PATCH(new Request("https://t/", { method: "PATCH", body: JSON.stringify(body) }), { params: { id: "rental_vendor_bill_1" } });

beforeEach(() => {
  vi.clearAllMocks();
  getChartAccounts.mockResolvedValue(chartAccounts);
});

describe("GET /api/rental/vendor-bills/[id]", () => {
  it("returns the bill with its vendor name", async () => {
    const { client } = clientFor();
    authAs(client);
    const response = await get();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.bill).toMatchObject({ vendorName: "Acme Plumbing", balanceCents: 25000 });
  });

  it("404s for another workspace's bill", async () => {
    const { client } = clientFor({ billRow: null });
    authAs(client);
    expect((await get()).status).toBe(404);
  });
});

describe("PATCH /api/rental/vendor-bills/[id] — edit", () => {
  it("blocks read-only members", async () => {
    const { client } = clientFor();
    authAs(client, "read_only");
    expect((await patch({ memo: "x" })).status).toBe(403);
  });

  it("edits an open bill", async () => {
    const { client, lastPatch } = clientFor();
    authAs(client);
    const response = await patch({ memo: "Revised", amountCents: 26000, expenseAccountCode: "utilities" });
    expect(response.status).toBe(200);
    expect(lastPatch()).toMatchObject({ memo: "Revised", amount_cents: 26000, expense_account_code: "utilities" });
  });

  it("refuses to edit a paid bill with 409", async () => {
    const { client } = clientFor({ billRow: { ...bill, status: "paid", paid_amount_cents: 25000 } });
    authAs(client);
    expect((await patch({ memo: "x" })).status).toBe(409);
  });

  it("409s when the bill changed concurrently (write-time guard)", async () => {
    const { client } = clientFor({ writeResult: "zero-rows" });
    authAs(client);
    const response = await patch({ memo: "x" });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/changed while you were editing/);
  });
});

describe("PATCH /api/rental/vendor-bills/[id] — void", () => {
  it("voids an open bill with a reason, never deleting it", async () => {
    const { client, lastPatch } = clientFor();
    authAs(client);
    const response = await patch({ void: true, voidReason: "Duplicate bill" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.bill.status).toBe("voided");
    expect(lastPatch().status).toBe("voided");
    expect(lastPatch().void_reason).toBe("Duplicate bill");
    expect(lastPatch().voided_at).toBeTruthy();
  });

  it("requires a void reason", async () => {
    const { client } = clientFor();
    authAs(client);
    expect((await patch({ void: true, voidReason: "  " })).status).toBe(400);
  });

  it("refuses to void a paid bill", async () => {
    const { client } = clientFor({ billRow: { ...bill, status: "paid", paid_amount_cents: 25000 } });
    authAs(client);
    expect((await patch({ void: true, voidReason: "oops" })).status).toBe(409);
  });

  it("refuses to void an open bill that has any applied payment (concurrent payment)", async () => {
    // The read still shows status=open (R4's status transition not yet
    // observed), but a payment landed first. The void must not go through.
    const { client, lastPatch } = clientFor({ billRow: { ...bill, status: "open", paid_amount_cents: 12000 } });
    authAs(client);
    const response = await patch({ void: true, voidReason: "oops" });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/unpaid open bills/);
    expect(lastPatch()).toBeNull();
  });

  it("refuses to void an already-voided bill", async () => {
    const { client } = clientFor({ billRow: { ...bill, status: "voided", void_reason: "dup" } });
    authAs(client);
    expect((await patch({ void: true, voidReason: "again" })).status).toBe(409);
  });
});

// R18 (rentec-parity): un-void a voided bill via the atomic unvoid_vendor_bill
// RPC — the bill reopens and the audit row lands in one transaction.
describe("PATCH /api/rental/vendor-bills/[id] — un-void", () => {
  const voidedBillRow = {
    ...bill,
    status: "voided",
    paid_amount_cents: 0,
    void_reason: "duplicate entry",
    voided_at: "2026-09-20",
    created_at: "2026-09-15T00:00:00Z",
  };

  it("un-voids a voided bill back to open through the atomic RPC", async () => {
    const { client } = clientFor({ billRow: voidedBillRow });
    authAs(client);
    const response = await patch({ unvoid: true, unvoidReason: "entered in error" });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith("unvoid_vendor_bill", {
      p_owner_id: "owner_1",
      p_bill_id: "rental_vendor_bill_1",
      p_reason: "entered in error",
    });
    // No direct bill-table write for the un-void — the RPC owns it.
    expect(client.from).not.toHaveBeenCalledWith("rental_void_audits");
    expect(body.bill).toMatchObject({ status: "open", vendorName: "Acme Plumbing" });
  });

  it("forbids read-only members from un-voiding", async () => {
    const { client } = clientFor({ billRow: voidedBillRow });
    authAs(client, "read_only");
    expect((await patch({ unvoid: true, unvoidReason: "x" })).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("requires an un-void reason", async () => {
    const { client } = clientFor({ billRow: voidedBillRow });
    authAs(client);
    expect((await patch({ unvoid: true, unvoidReason: "  " })).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("refuses to un-void a non-voided bill", async () => {
    const { client } = clientFor({ billRow: { ...voidedBillRow, status: "open" } });
    authAs(client);
    const response = await patch({ unvoid: true, unvoidReason: "x" });
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.error).toMatch(/voided bills/i);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("blocks un-void when a replacement bill was entered after the void", async () => {
    const candidate = {
      id: "rental_vendor_bill_2",
      vendor_id: voidedBillRow.vendor_id,
      property_id: voidedBillRow.property_id,
      bill_date: voidedBillRow.bill_date,
      amount_cents: voidedBillRow.amount_cents,
      status: "open",
      created_at: "2026-09-25T00:00:00Z",
    };
    const { client } = clientFor({ billRow: voidedBillRow, candidates: [candidate] });
    authAs(client);
    const response = await patch({ unvoid: true, unvoidReason: "x" });
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.error).toMatch(/replacement bill/i);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("409s when the RPC reports the bill changed between read and write", async () => {
    const { client } = clientFor({
      billRow: voidedBillRow,
      rpcResult: { data: null, error: { code: "P0001", message: "bill is not in a voided, untouched state" } },
    });
    authAs(client);
    const response = await patch({ unvoid: true, unvoidReason: "x" });
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.error).toMatch(/changed while you were editing/i);
  });

  it("403s when the RPC's own permission check denies the caller", async () => {
    const { client } = clientFor({
      billRow: voidedBillRow,
      rpcResult: { data: null, error: { code: "42501", message: "permission denied" } },
    });
    authAs(client);
    const response = await patch({ unvoid: true, unvoidReason: "x" });
    expect(response.status).toBe(403);
  });
});

describe("R17 permission gating", () => {
  it("PATCH requires the vendor_bills.manage permission", async () => {
    const { client } = clientFor();
    authAs(client);
    await patch({ memo: "x" });
    expect(requireRentalPermission).toHaveBeenCalledWith(
      expect.objectContaining({ permission: "vendor_bills.manage" })
    );
  });
});
