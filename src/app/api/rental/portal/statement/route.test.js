import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

function queryNode(result) {
  const node = { select: vi.fn(() => node), eq: vi.fn(() => node), maybeSingle: vi.fn(async () => result) };
  return node;
}

const tenantA = { id: "tenant_A", owner_id: "owner_1", display_name: "Tenant A", email: "a@example.com" };
const tenantB = { id: "tenant_B", owner_id: "owner_1", display_name: "Tenant B", email: "b@example.com" };

let tenantLookupNode;
let rlsClient;
let createAuthenticatedTenantPortalApplication;

vi.mock("@/lib/supabase/createAuthenticatedTenantPortalApplication", () => ({
  createAuthenticatedTenantPortalApplication: (...args) => createAuthenticatedTenantPortalApplication(...args),
}));

const loadTenantLedgerData = vi.fn();
vi.mock("@/application/rental/loadTenantLedgerData", () => ({ loadTenantLedgerData: (...args) => loadTenantLedgerData(...args) }));

import { GET } from "./route.js";

function request(query = "") {
  return new NextRequest(`https://forge.test/api/rental/portal/statement${query}`);
}

function fixtureLedger() {
  return {
    tenant: tenantA,
    charges: [
      { id: "c1", lease_id: "lease_1", due_date: "2026-09-01", amount_cents: 160000, status: "due", charge_type: "rent", period: "2026-09" },
      { id: "c2", lease_id: "lease_1", due_date: "2026-10-01", amount_cents: 160000, status: "due", charge_type: "rent", period: "2026-10" },
    ],
    payments: [
      { id: "p1", lease_id: "lease_1", tenant_id: "tenant_A", amount_cents: 160000, refunded_amount_cents: 0, status: "succeeded", payment_method: "card", notes: "owner-internal memo", received_at: "2026-10-10T00:00:00Z", created_at: "2026-10-10T00:00:00Z" },
    ],
    settlements: [],
    leases: [{ id: "lease_1", unit_id: "unit_1", status: "active" }],
    leaseMemberships: [{ tenant_id: "tenant_A", lease_id: "lease_1" }],
    units: [{ id: "unit_1", property_id: "prop_1", label: "Unit A" }],
    rentecImports: [],
    credits: [],
    creditApplications: [],
  };
}

describe("tenant portal statement route (tenant scoping)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tenantLookupNode = queryNode({ data: tenantA, error: null });
    rlsClient = { from: (table) => {
      if (table === "rental_tenants") return tenantLookupNode;
      throw new Error(`unexpected table read: ${table}`);
    } };
    createAuthenticatedTenantPortalApplication = vi.fn(async () => ({ user: { id: "auth_user_A" }, supabaseClient: rlsClient }));
    loadTenantLedgerData.mockResolvedValue(fixtureLedger());
  });

  it("returns 401 for an unauthenticated caller before touching any tenant data", async () => {
    createAuthenticatedTenantPortalApplication.mockResolvedValueOnce({
      response: NextResponse.json({ error: "Authenticated owner id is required." }, { status: 401 }),
    });
    const response = await GET(request("?period=2026-10"));
    expect(response.status).toBe(401);
    expect(loadTenantLedgerData).not.toHaveBeenCalled();
  });

  it("returns 404 when no tenant record is linked to the signed-in account", async () => {
    tenantLookupNode = queryNode({ data: null, error: null });
    const response = await GET(request("?period=2026-10"));
    const body = await response.json();
    expect(response.status).toBe(404);
    expect(body.error).toBe("No tenant portal access is linked to this account.");
    expect(loadTenantLedgerData).not.toHaveBeenCalled();
  });

  it("rejects 403 when the session tenant asks for another tenant's statement", async () => {
    // Tenant A is signed in but passes tenantId=tenant_B — the cross-tenant ask
    // must fail before any ledger read.
    const response = await GET(request("?period=2026-10&tenantId=tenant_B"));
    const body = await response.json();
    expect(response.status).toBe(403);
    expect(body.error).toBe("Statements are only available for your own account.");
    expect(loadTenantLedgerData).not.toHaveBeenCalled();
  });

  it("loads the statement for the SESSION tenant even when a spoofed tenantId is present", async () => {
    // Defense in depth: the loader is handed tenant_A's id from the session row —
    // the query-string tenantId is never trusted. (A matching param behaves the
    // same as no param.)
    const response = await GET(request("?period=2026-10&tenantId=tenant_A"));
    expect(response.status).toBe(200);
    expect(loadTenantLedgerData).toHaveBeenCalledWith(rlsClient, "owner_1", "tenant_A");
    const body = await response.json();
    expect(body.statement.tenantName).toBe("Tenant A");
    expect(tenantB).not.toBe(body.statement.tenantName);
  });

  it("queries through the tenant's RLS-scoped client, never a service-role client", async () => {
    await GET(request("?period=2026-10"));
    // The first argument handed to the loader IS the authenticated tenant client —
    // row-level policies bound to the session independently limit what it can read.
    expect(loadTenantLedgerData.mock.calls[0][0]).toBe(rlsClient);
  });

  it("rejects 400 on a malformed period", async () => {
    const response = await GET(request("?period=October"));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toBe("period must be YYYY-MM.");
    expect(loadTenantLedgerData).not.toHaveBeenCalled();
  });

  it("returns the period slice with opening balance, rebased line items, and closing balance", async () => {
    const response = await GET(request("?period=2026-10"));
    expect(response.status).toBe(200);
    const { statement } = await response.json();
    expect(statement.period).toMatchObject({ start: "2026-10-01", end: "2026-10-31", label: "October 2026" });
    expect(statement.openingBalanceCents).toBe(160000); // unpaid September rent
    expect(statement.entries.map((line) => line.id)).toEqual(["charge:c2", "payment:p1"]);
    expect(statement.entries[0]).toMatchObject({ debitCents: 160000, creditCents: 0, balanceAfterCents: 320000 });
    expect(statement.entries[1]).toMatchObject({ debitCents: 0, creditCents: 160000, balanceAfterCents: 160000 });
    expect(statement.closingBalanceCents).toBe(160000);
    expect(statement.totals).toEqual({ chargedCents: 160000, paidCents: 160000, refundedCents: 0 });
    expect(statement.unitLabel).toBe("Unit A");
    // Statement lines are projected: operational detail (payment notes, deposit
    // state, settlement evidence) never crosses the tenant boundary.
    expect(statement.entries[1]).not.toHaveProperty("notes");
    expect(statement.entries[1]).not.toHaveProperty("depositState");
    expect(statement.entries[1]).not.toHaveProperty("settlement");
  });

  it("defaults to the current month when no period is given", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    const { statement } = await response.json();
    const now = new Date();
    const label = new Date(now.getFullYear(), now.getMonth(), 1)
      .toLocaleDateString("en-US", { month: "long", year: "numeric" });
    expect(statement.period.label).toBe(label);
  });
});
