import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({ getActiveWorkspaceRole: vi.fn() }));
vi.mock("@/application/rental/chartOfAccounts", () => ({
  getChartAccounts: vi.fn(),
  isChartTableMissing: () => false,
}));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
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
  getActiveWorkspaceRole.mockResolvedValue(role);
}

// Read: from(bills).select.eq.eq.maybeSingle; vendor name lookup on vendors.
// Write: from(bills).update(patch).eq.eq.eq[.eq].select.single — the extra
// write-time guards mean zero rows when the bill changed concurrently.
function clientFor({ billRow = bill, writeResult = "updated" } = {}) {
  let lastPatch = null;
  const client = {
    from: vi.fn((table) => {
      if (table === "rental_vendor_bills") {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: billRow, error: null }) }) }) }),
          update: (patch) => {
            lastPatch = patch;
            const chain = { eq: () => chain, select: () => ({ single: () => Promise.resolve(writeResult === "updated" ? { data: { ...billRow, ...patch }, error: null } : { data: null, error: { code: "PGRST116" } }) }) };
            return chain;
          },
        };
      }
      return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { name: "Acme Plumbing" }, error: null }) }) }) }) };
    }),
  };
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

  it("refuses to void an already-voided bill", async () => {
    const { client } = clientFor({ billRow: { ...bill, status: "voided", void_reason: "dup" } });
    authAs(client);
    expect((await patch({ void: true, voidReason: "again" })).status).toBe(409);
  });
});
