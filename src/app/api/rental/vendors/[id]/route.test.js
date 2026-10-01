import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({ getActiveWorkspaceRole: vi.fn() }));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { GET, PATCH } from "./route";

const vendor = {
  id: "rental_vendor_1", name: "Acme Plumbing", contact_name: "Sam",
  email: null, phone: null, address: null, trade: "Plumbing",
  tax_classification: null, tax_id_last4: null, notes: null,
  is_active: true, created_at: null, updated_at: null,
};

const bill = {
  id: "b1", vendor_id: "rental_vendor_1", property_id: "prop_1",
  bill_date: "2026-09-15", due_date: "2026-10-15",
  amount_cents: 25000, paid_amount_cents: 10000, expense_account_code: "property_repairs",
  memo: null, attachment_reference: null, status: "open",
  void_reason: null, voided_at: null, created_at: null, updated_at: null,
};

function authAs(client, role = "owner") {
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    user: { id: "user_1" }, effectiveOwnerId: "owner_1", supabaseClient: client,
  });
  getActiveWorkspaceRole.mockResolvedValue(role);
}

// The [id] routes chain: from(table).select().eq().eq().maybeSingle() for the
// read, then from().update().eq().eq().select().single() for the write.
function clientFor({ vendorRow = vendor, bills = [bill], updated = null } = {}) {
  const client = {
    from: vi.fn((table) => {
      if (table === "rental_vendors") {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: vendorRow, error: null }) }) }) }),
          update: (patch) => ({
            eq: () => ({ eq: () => ({ select: () => ({ single: () => Promise.resolve({ data: updated || { ...vendorRow, ...patch }, error: null }) }) }) }),
          }),
        };
      }
      return {
        select: () => ({ eq: () => ({ eq: () => ({ order: () => Promise.resolve({ data: bills, error: null }) }) }) }),
      };
    }),
  };
  return client;
}

const get = () => GET(new Request("https://t/"), { params: { id: "rental_vendor_1" } });
const patch = (body) => PATCH(new Request("https://t/", { method: "PATCH", body: JSON.stringify(body) }), { params: { id: "rental_vendor_1" } });

beforeEach(() => vi.clearAllMocks());

describe("GET /api/rental/vendors/[id]", () => {
  it("returns the vendor, its bills, and open-balance totals", async () => {
    authAs(clientFor());
    const response = await get();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.vendor.name).toBe("Acme Plumbing");
    expect(body.bills).toHaveLength(1);
    expect(body.bills[0].balanceCents).toBe(15000);
    expect(body.totals).toMatchObject({ billCount: 1, billedCents: 25000, paidCents: 10000, openCents: 15000 });
  });

  it("404s for another workspace's vendor", async () => {
    authAs(clientFor({ vendorRow: null }));
    expect((await get()).status).toBe(404);
  });
});

describe("PATCH /api/rental/vendors/[id]", () => {
  it("blocks read-only members", async () => {
    authAs(clientFor(), "read_only");
    expect((await patch({ phone: "1" })).status).toBe(403);
  });

  it("updates provided fields", async () => {
    authAs(clientFor());
    const response = await patch({ phone: "555-0100", notes: "Great crew" });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.vendor.phone).toBe("555-0100");
  });

  it("deactivates without deleting history", async () => {
    const client = clientFor();
    let updatePatch = null;
    client.from.mockImplementation((table) => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: vendor, error: null }) }) }) }),
      update: (p) => { updatePatch = p; return { eq: () => ({ eq: () => ({ select: () => ({ single: () => Promise.resolve({ data: { ...vendor, is_active: false }, error: null }) }) }) }) }; },
    }));
    authAs(client);
    const response = await patch({ isActive: false });
    expect(response.status).toBe(200);
    expect(updatePatch.is_active).toBe(false);
    expect((await response.json()).vendor.isActive).toBe(false);
  });

  it("rejects an empty patch", async () => {
    authAs(clientFor());
    expect((await patch({})).status).toBe(400);
  });

  it("rejects a bad email", async () => {
    authAs(clientFor());
    expect((await patch({ email: "nope" })).status).toBe(400);
  });
});
