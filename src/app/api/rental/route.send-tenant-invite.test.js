import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/infrastructure/notifications/ResendRentalEmailProvider", () => ({
  createResendRentalEmailProvider: () => ({ send: mocks.send }),
}));
vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({
  getActiveWorkspaceRole: vi.fn(async () => null),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

// Per-test maybeSingle payloads keyed by table name.
let maybeSingleResults = {};
const updateCalls = [];
function chainable(table) {
  const chain = {
    select: () => chain, eq: () => chain, is: () => chain, order: () => chain,
    maybeSingle: async () => ({ data: maybeSingleResults[table] ?? null, error: null }),
    update: (patch) => { updateCalls.push({ table, patch }); return chain; },
    // Awaiting an update chain resolves the standard supabase payload.
    then: (resolve) => resolve({ data: null, error: null }),
  };
  return chain;
}
const application = {};
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({
  createAuthenticatedRentalManagerApplication: vi.fn(async () => ({
    application, user: { id: "owner_1" }, effectiveOwnerId: "owner_1",
    supabaseClient: { from: (table) => chainable(table) },
  })),
}));

import { POST } from "./route.js";
import { fingerprintString } from "@/domains/rental-tenant/tenantInviteEmail.js";

function request(body) {
  return new Request("http://localhost/api/rental", { method: "POST", body: JSON.stringify(body) });
}

const tenant = { id: "tenant_1", display_name: "Eric Carrillo", email: "eric@example.com", status: "active", auth_user_id: null };

describe("send-tenant-invite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    maybeSingleResults = {};
    updateCalls.length = 0;
    mocks.send.mockResolvedValue({ id: "resend_1" });
  });

  it("sends the invite with the lease summary and records invited_at", async () => {
    maybeSingleResults = {
      rental_tenants: tenant,
      rental_lease_tenants: { lease_id: "lease_1" },
      rental_leases: { unit_id: "unit_1", start_date: "2026-08-29", monthly_rent_cents: 160000 },
      rental_units: { label: "1214 Wagner" },
    };
    const response = await POST(request({ operation: "send-tenant-invite", tenantId: "tenant_1", leaseId: "lease_1" }));
    expect(response.status).toBe(200);
    expect((await response.json()).success).toBe(true);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    const message = mocks.send.mock.calls[0][0];
    const today = new Date().toISOString().slice(0, 10);
    const fingerprint = fingerprintString(`${message.subject}\n${message.bodyText}`);
    expect(message.id).toBe(`tenant-invite-tenant_1-${today}-${fingerprint}`);
    expect(message.recipient).toBe("eric@example.com");
    expect(message.subject).toContain("portal");
    expect(message.bodyText).toContain("Eric Carrillo");
    expect(message.bodyText).toContain("eric@example.com");
    expect(message.bodyText).toContain("/forge/rental/portal");
    expect(message.bodyText).not.toContain("?");
    expect(message.bodyText).toContain("1214 Wagner");
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].table).toBe("rental_tenants");
    expect(updateCalls[0].patch.invited_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("sends without a lease summary when no lease is given", async () => {
    maybeSingleResults = { rental_tenants: tenant };
    const response = await POST(request({ operation: "send-tenant-invite", tenantId: "tenant_1" }));
    expect(response.status).toBe(200);
    const message = mocks.send.mock.calls[0][0];
    expect(message.bodyText).toContain("/forge/rental/portal");
    expect(message.bodyText).not.toContain("Property:");
  });

  it("refuses a tenant that already claimed portal access", async () => {
    maybeSingleResults = { rental_tenants: { ...tenant, auth_user_id: "auth-user-1" } };
    const response = await POST(request({ operation: "send-tenant-invite", tenantId: "tenant_1" }));
    expect(response.status).toBe(409);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("returns 404 for a tenant outside the owner's workspace", async () => {
    maybeSingleResults = {};
    const response = await POST(request({ operation: "send-tenant-invite", tenantId: "tenant_other" }));
    expect(response.status).toBe(404);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("rejects a lease the tenant is not on", async () => {
    maybeSingleResults = { rental_tenants: tenant, rental_lease_tenants: null };
    const response = await POST(request({ operation: "send-tenant-invite", tenantId: "tenant_1", leaseId: "lease_x" }));
    expect(response.status).toBe(409);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("does not record invited_at when the provider fails", async () => {
    maybeSingleResults = { rental_tenants: tenant };
    mocks.send.mockRejectedValue(new Error("provider down"));
    const response = await POST(request({ operation: "send-tenant-invite", tenantId: "tenant_1" }));
    expect(response.status).toBe(502);
    expect(updateCalls).toHaveLength(0);
  });

  it("uses a different idempotency key when the email is corrected the same day", async () => {
    maybeSingleResults = { rental_tenants: tenant };
    const first = await POST(request({ operation: "send-tenant-invite", tenantId: "tenant_1" }));
    expect(first.status).toBe(200);
    const firstMessage = mocks.send.mock.calls[0][0];
    expect(firstMessage.recipient).toBe("eric@example.com");

    mocks.send.mockClear();
    maybeSingleResults = { rental_tenants: { ...tenant, email: "eric.correct@example.com" } };
    const second = await POST(request({ operation: "send-tenant-invite", tenantId: "tenant_1" }));
    expect(second.status).toBe(200);
    const secondMessage = mocks.send.mock.calls[0][0];
    expect(secondMessage.recipient).toBe("eric.correct@example.com");
    expect(secondMessage.id).not.toBe(firstMessage.id);
  });

  it("reuses the idempotency key when retrying the identical invitation", async () => {
    maybeSingleResults = { rental_tenants: tenant };
    const first = await POST(request({ operation: "send-tenant-invite", tenantId: "tenant_1" }));
    expect(first.status).toBe(200);
    const firstId = mocks.send.mock.calls[0][0].id;

    mocks.send.mockClear();
    const second = await POST(request({ operation: "send-tenant-invite", tenantId: "tenant_1" }));
    expect(second.status).toBe(200);
    expect(mocks.send.mock.calls[0][0].id).toBe(firstId);
  });
});
