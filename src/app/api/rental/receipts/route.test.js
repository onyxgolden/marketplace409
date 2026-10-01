import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({ getActiveWorkspaceRole: vi.fn() }));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { GET, POST } from "./route";

const receipt = {
  id: "rental_receipt_abc123",
  vendor_id: "rental_vendor_1",
  vendor_name_hint: null,
  property_id: "prop_1",
  receipt_date: "2026-09-15",
  amount_cents: 25000,
  tax_cents: 0,
  line_items: [],
  document_id: null,
  notes: null,
  status: "inbox",
  applied_bill_id: null,
  applied_payment_id: null,
  extraction_status: "not_connected",
  created_by: "user_1",
  created_at: null,
  updated_at: null,
};

// Generic Supabase chain mock: every clause returns the builder; terminal
// methods resolve with the configured rows.
function queryBuilder(rows) {
  const b = {
    select() { return b; },
    eq() { return b; },
    order() { return b; },
    in() { return b; },
    insert() { return b; },
    update() { return b; },
    maybeSingle() { return Promise.resolve({ data: rows && rows.length > 0 ? rows[0] : null, error: null }); },
    single() { return Promise.resolve({ data: rows && rows.length > 0 ? rows[0] : null, error: null }); },
    then(resolve) { resolve({ data: rows, error: null }); },
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/rental/receipts", () => {
  it("lists receipts with vendor names joined in", async () => {
    const client = {
      from: vi.fn((table) =>
        table === "rental_receipts"
          ? queryBuilder([receipt])
          : queryBuilder([{ id: "rental_vendor_1", name: "Acme Plumbing" }])
      ),
    };
    authAs(client);
    const response = await get();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.receipts).toHaveLength(1);
    expect(body.receipts[0]).toMatchObject({ vendorName: "Acme Plumbing", status: "inbox", amountCents: 25000 });
  });

  it("rejects an unknown status filter", async () => {
    const client = { from: vi.fn() };
    authAs(client);
    expect((await get("?status=bogus")).status).toBe(400);
  });
});

describe("POST /api/rental/receipts", () => {
  const goodBody = {
    vendorId: "rental_vendor_1",
    propertyId: "prop_1",
    receiptDate: "2026-09-15",
    amountCents: 25000,
  };

  it("403s for read-only members", async () => {
    const client = { from: vi.fn() };
    authAs(client, "read_only");
    const response = await post(goodBody);
    expect(response.status).toBe(403);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("400s on invalid input before touching the database", async () => {
    const client = { from: vi.fn() };
    authAs(client);
    const response = await post({ receiptDate: "2026-09-15", amountCents: 25000 });
    expect(response.status).toBe(400);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("400s when the vendor does not exist", async () => {
    const client = { from: vi.fn(() => queryBuilder([])) };
    authAs(client);
    const response = await post(goodBody);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/vendor/i);
  });

  it("creates the receipt in the inbox", async () => {
    const client = {
      from: vi.fn((table) =>
        table === "rental_receipts"
          ? queryBuilder([receipt])
          : queryBuilder([{ id: "rental_vendor_1" }])
      ),
    };
    authAs(client);
    const response = await post(goodBody);
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.receipt.status).toBe("inbox");
    const insertCall = client.from.mock.calls.find(([table]) => table === "rental_receipts");
    expect(insertCall).toBeDefined();
  });
});
