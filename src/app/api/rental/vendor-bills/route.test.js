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
      authorization: null,
    });
  } else {
    requireRentalPermission.mockResolvedValue({ response: null, authorization: { permissions: [] } });
  }
}

import { getChartAccounts } from "@/application/rental/chartOfAccounts";
import { GET, POST } from "./route";

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
  { code: "rental_income", label: "Rental income", account_type: "income", is_active: true },
];

function listBuilder(rows) {
  const b = {
    select() { return b; },
    eq() { return b; },
    order() { return b; },
    in() { return b; },
    then(resolve) { resolve({ data: rows, error: null }); },
  };
  return b;
}

function authAs(client, role = "owner") {
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    user: { id: "user_1" }, effectiveOwnerId: "owner_1", supabaseClient: client,
  });
  gateFor(role);
}

const get = (query = "") => GET(new Request(`https://t/${query}`));
const post = (body) => POST(new Request("https://t/", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  getChartAccounts.mockResolvedValue(chartAccounts);
});

describe("GET /api/rental/vendor-bills", () => {
  it("lists bills with vendor names joined in", async () => {
    const client = {
      from: vi.fn((table) =>
        table === "rental_vendor_bills"
          ? listBuilder([bill])
          : listBuilder([{ id: "rental_vendor_1", name: "Acme Plumbing" }])
      ),
    };
    authAs(client);
    const response = await get();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.bills).toHaveLength(1);
    expect(body.bills[0]).toMatchObject({ vendorName: "Acme Plumbing", balanceCents: 25000, status: "open" });
  });

  it("rejects an unknown status filter", async () => {
    const client = { from: vi.fn() };
    authAs(client);
    expect((await get("?status=bogus")).status).toBe(400);
  });
});

describe("POST /api/rental/vendor-bills", () => {
  const goodBody = {
    vendorId: "rental_vendor_1",
    propertyId: "prop_1",
    billDate: "2026-09-15",
    dueDate: "2026-10-15",
    amountCents: 25000,
    expenseAccountCode: "property_repairs",
    memo: "Water heater",
  };

  function clientForCreate({ vendorFound = true, unitFound = true } = {}) {
    let inserted = null;
    const client = {
      from: vi.fn((table) => {
        if (table === "rental_vendors") {
          return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: vendorFound ? { id: "rental_vendor_1", name: "Acme Plumbing", is_active: true } : null, error: null }) }) }) }) };
        }
        if (table === "rental_units") {
          return { select: () => ({ eq: () => ({ or: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: unitFound ? { id: "u1" } : null, error: null }) }) }) }) }) };
        }
        return {
          insert: (row) => {
            inserted = row;
            return { select: () => ({ single: () => Promise.resolve({ data: { ...bill, ...row }, error: null }) }) };
          },
        };
      }),
    };
    return { client, inserted: () => inserted };
  }

  it("blocks read-only members with 403", async () => {
    const { client } = clientForCreate();
    authAs(client, "read_only");
    expect((await post(goodBody)).status).toBe(403);
  });

  it("rejects an income account code with 400", async () => {
    const { client } = clientForCreate();
    authAs(client);
    const response = await post({ ...goodBody, expenseAccountCode: "rental_income" });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/expense account/);
  });

  it("404s when the vendor belongs to another workspace", async () => {
    const { client } = clientForCreate({ vendorFound: false });
    authAs(client);
    expect((await post(goodBody)).status).toBe(404);
  });

  it("404s when the property belongs to another workspace", async () => {
    const { client } = clientForCreate({ unitFound: false });
    authAs(client);
    expect((await post(goodBody)).status).toBe(404);
  });

  it("records the bill with 201, open status, and an idempotency key", async () => {
    const { client, inserted } = clientForCreate();
    authAs(client);
    const response = await post(goodBody);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.bill.status).toBe("open");
    expect(body.bill.vendorName).toBe("Acme Plumbing");
    const row = inserted();
    expect(row.owner_id).toBe("owner_1");
    expect(row.id.startsWith("rental_vendor_bill_")).toBe(true);
    expect(row.source_key).toBe(`vendorbill:${row.id}`);
    expect(row.paid_amount_cents).toBe(0);
    expect(row.created_by).toBe("user_1");
  });
  it("R17: POST requires the vendor_bills.manage permission", async () => {
    const { client } = clientForCreate();
    authAs(client);
    await post(goodBody);
    expect(requireRentalPermission).toHaveBeenCalledWith(
      expect.objectContaining({ permission: "vendor_bills.manage" })
    );
  });
});
