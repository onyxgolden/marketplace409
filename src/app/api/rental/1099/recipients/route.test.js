import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({ getActiveWorkspaceRole: vi.fn() }));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { GET, POST } from "./route";

process.env.FORGE_1099_TIN_KEY = "test-key-do-not-use-in-production";

const recipientRow = {
  id: "rental_1099_recipient_1", kind: "vendor", linked_vendor_id: "rental_vendor_1",
  display_name: "Acme Plumbing", entity_type: "llc",
  address_line1: null, address_line2: null, city: null, state: null, zip: null, country: "US",
  tin_ciphertext: "v1.fake.ciphertext.payload", tin_last4: "6789", tin_type: "ein",
  is_active: true, notes: null, created_at: null, updated_at: null,
};

// Minimal thenable query builder mirroring the vendor-bills route tests.
function mockClient({ rows = [], onInsert = null } = {}) {
  const builder = {
    _table: null,
    _inserted: null,
    from(table) { builder._table = table; return builder; },
    select() { return builder; },
    eq() { return builder; },
    order() { return builder; },
    insert(row) { builder._inserted = row; if (onInsert) onInsert(row); return builder; },
    single() { return Promise.resolve({ data: builder._inserted ? { ...recipientRow, ...builder._inserted } : null, error: null }); },
    then(resolve) { resolve({ data: rows, error: null }); },
  };
  return builder;
}

function authAs(client, role = "owner") {
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    user: { id: "user_1" }, effectiveOwnerId: "owner_1", supabaseClient: client,
  });
  getActiveWorkspaceRole.mockResolvedValue(role);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/rental/1099/recipients", () => {
  it("returns masked TINs and never the ciphertext — read-only members may read", async () => {
    authAs(mockClient({ rows: [recipientRow] }), "read_only");
    const response = await GET(new Request("https://t/"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.recipients).toHaveLength(1);
    expect(body.recipients[0].tinMasked).toBe("XXX-XX-6789");
    expect(body.recipients[0].tinLast4).toBe("6789");
    expect(body.recipients[0].tinOnFile).toBe(true);
    expect("tin_ciphertext" in body.recipients[0]).toBe(false);
    expect(JSON.stringify(body)).not.toContain("v1.fake.ciphertext.payload");
  });
});

describe("POST /api/rental/1099/recipients", () => {
  it("403s for read-only members", async () => {
    authAs(mockClient(), "read_only");
    const response = await POST(new Request("https://t/", {
      method: "POST",
      body: JSON.stringify({ kind: "vendor", displayName: "Acme" }),
    }));
    expect(response.status).toBe(403);
  });

  it("400s on invalid input without touching the database", async () => {
    let inserted = false;
    authAs(mockClient({ onInsert: () => { inserted = true; } }), "owner");
    const response = await POST(new Request("https://t/", {
      method: "POST",
      body: JSON.stringify({ kind: "vendor", displayName: "", tin: "12" }),
    }));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(inserted).toBe(false);
    expect(body.errors.length).toBeGreaterThan(0);
  });

  it("encrypts the TIN at rest — the insert carries ciphertext, never plaintext", async () => {
    let insertedRow = null;
    authAs(mockClient({ onInsert: (row) => { insertedRow = row; } }), "owner");
    const response = await POST(new Request("https://t/", {
      method: "POST",
      body: JSON.stringify({ kind: "vendor", displayName: "Acme Plumbing", entityType: "llc", tin: "123-45-6789", tinType: "ein" }),
    }));
    expect(response.status).toBe(201);
    expect(insertedRow).not.toBeNull();
    expect(insertedRow.tin_ciphertext).toMatch(/^v1\./);
    expect(insertedRow.tin_ciphertext).not.toContain("123456789");
    expect(insertedRow.tin_last4).toBe("6789");
    const body = await response.json();
    expect(body.recipient.tinMasked).toBe("XXX-XX-6789");
    expect("tin_ciphertext" in body.recipient).toBe(false);
  });

  it("fails loudly when the server TIN key is not configured", async () => {
    delete process.env.FORGE_1099_TIN_KEY;
    authAs(mockClient(), "owner");
    try {
      const response = await POST(new Request("https://t/", {
        method: "POST",
        body: JSON.stringify({ kind: "vendor", displayName: "Acme", tin: "123456789" }),
      }));
      const body = await response.json();
      expect(response.status).toBe(500);
      expect(body.error).toContain("FORGE_1099_TIN_KEY");
    } finally {
      process.env.FORGE_1099_TIN_KEY = "test-key-do-not-use-in-production";
    }
  });
});
