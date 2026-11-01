import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({ getActiveWorkspaceRole: vi.fn() }));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { DELETE } from "./route";

// Controls-sweep follow-up G20 (O-08): vendor delete with a history guard.
// History = bills, payments, receipts, or a 1099-recipient link.
const vendor = {
  id: "rental_vendor_1", name: "Acme Plumbing", contact_name: "Sam",
  email: null, phone: null, address: null, trade: "Plumbing",
  tax_classification: null, tax_id_last4: null, notes: null,
  is_active: true, created_at: null, updated_at: null,
};

function authAs(client, role = "owner") {
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    user: { id: "user_1" }, effectiveOwnerId: "owner_1", supabaseClient: client,
  });
  getActiveWorkspaceRole.mockResolvedValue(role);
}

function clientFor({ vendorRow = vendor, history = {}, deleted = [] } = {}) {
  return {
    from: (table) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        limit: async () => ({ data: (history[table] || []).map((id) => ({ id })), error: null }),
        maybeSingle: async () => ({ data: vendorRow, error: null }),
        delete: () => chain,
        then: (resolve) => resolve({ data: null, error: null }),
      };
      // The delete terminal: awaiting the chain after .delete().eq().eq()
      // resolves the delete result. Track it via a marker on the chain.
      const originalThen = chain.then;
      chain.then = (resolve) => {
        if (chain._isDelete) {
          deleted.push(table);
          resolve({ data: null, error: null });
        } else {
          originalThen(resolve);
        }
      };
      const originalDelete = chain.delete;
      chain.delete = () => { chain._isDelete = true; return chain; };
      void originalDelete;
      return chain;
    },
  };
}

function callDelete() {
  return DELETE(new Request("http://localhost/api/rental/vendors/rental_vendor_1"), { params: { id: "rental_vendor_1" } });
}

describe("vendor DELETE follow-up G20", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("O-08: deletes a history-free vendor", async () => {
    const deleted = [];
    authAs(clientFor({ deleted }));
    const response = await callDelete();
    expect(response.status).toBe(200);
    expect((await response.json()).success).toBe(true);
    expect(deleted).toContain("rental_vendors");
  });

  it("O-08: 409s when bills exist and never deletes", async () => {
    const deleted = [];
    authAs(clientFor({ deleted, history: { rental_vendor_bills: ["b1"] } }));
    const response = await callDelete();
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toContain("bills");
    expect(body.error).toContain("deactivate it instead");
    expect(deleted).toHaveLength(0);
  });

  it("O-08: 409s for payments, receipts, and 1099 links", async () => {
    for (const [table, label] of [
      ["rental_vendor_payments", "payments"],
      ["rental_receipts", "receipts"],
      ["rental_1099_recipients", "1099 recipient link"],
    ]) {
      const deleted = [];
      authAs(clientFor({ deleted, history: { [table]: ["x1"] } }));
      const response = await callDelete();
      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error).toContain(label);
      expect(deleted).toHaveLength(0);
    }
  });

  it("O-08: read-only members cannot delete", async () => {
    authAs(clientFor({}), "read_only");
    const response = await callDelete();
    expect(response.status).toBe(403);
  });

  it("O-08: unknown vendor 404s", async () => {
    authAs(clientFor({ vendorRow: null }));
    const response = await callDelete();
    expect(response.status).toBe(404);
  });
});
