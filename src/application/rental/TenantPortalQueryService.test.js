import { describe, expect, it, vi } from "vitest";
import { TenantPortalQueryService } from "./TenantPortalQueryService.js";
describe("TenantPortalQueryService", () => {
  it("returns null when the authenticated user has no tenant identity", async () => {
    const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() };
    Object.values(query).forEach((method) => method.mockReturnValue(query));
    query.maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(new TenantPortalQueryService({ from: vi.fn(() => query) }).load("auth_1")).resolves.toBeNull();
    expect(query.eq).toHaveBeenCalledWith("auth_user_id", "auth_1");
  });
  it("requires an authenticated identity", async () => {
    await expect(new TenantPortalQueryService({ from: vi.fn() }).load("")).rejects.toThrow("auth user id is required");
  });

  function chain(result) {
    const node = { select: vi.fn(() => node), eq: vi.fn(() => node), in: vi.fn(() => node),
      order: vi.fn(() => node), maybeSingle: vi.fn(async () => result), then: (resolve) => resolve(result) };
    return node;
  }
  // Some table names are queried more than once per load() with different shapes (e.g.
  // rental_lease_tenants: once for "my own memberships" up front, again per-lease for "the full
  // roster"). A plain chain() answers every call identically; wrap it in a vi.fn() with
  // mockReturnValueOnce/mockReturnValue when a test needs the two calls to differ.
  function fromRouter(tables) {
    return vi.fn((table) => (typeof tables[table] === "function" ? tables[table]() : tables[table]));
  }

  it("surfaces the owner-level billingEnabled flag on the portal, even when the tenant has no lease memberships", async () => {
    const tables = {
      rental_tenants: chain({ data: { id: "tenant_1", owner_id: "owner_1", auth_user_id: "auth_1", display_name: "T",
        email: "t@example.com", phone: null, status: "active", invited_at: null, activated_at: null,
        created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }, error: null }),
      rental_billing_settings: chain({ data: { billing_enabled: true }, error: null }),
      rental_lease_tenants: chain({ data: [], error: null }),
      rental_conversations: chain({ data: null, error: null }),
    };
    const service = new TenantPortalQueryService({ from: vi.fn((table) => tables[table]) });
    const portal = await service.load("auth_1");
    expect(portal.billingEnabled).toBe(true);
    expect(portal.rentals).toEqual([]);
  });

  it("defaults billingEnabled to false when no rental_billing_settings row exists yet for the owner", async () => {
    const tables = {
      rental_tenants: chain({ data: { id: "tenant_1", owner_id: "owner_1", auth_user_id: "auth_1", display_name: "T",
        email: "t@example.com", phone: null, status: "active", invited_at: null, activated_at: null,
        created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }, error: null }),
      rental_billing_settings: chain({ data: null, error: null }),
      rental_lease_tenants: chain({ data: [], error: null }),
      rental_conversations: chain({ data: null, error: null }),
    };
    const service = new TenantPortalQueryService({ from: vi.fn((table) => tables[table]) });
    const portal = await service.load("auth_1");
    expect(portal.billingEnabled).toBe(false);
  });

  describe("leaseSigning", () => {
    const TENANT = { id: "tenant_1", owner_id: "owner_1", auth_user_id: "auth_1", display_name: "T",
      email: "t@example.com", phone: null, status: "active", invited_at: null, activated_at: null,
      created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };
    const LEASE = { owner_id: "owner_1", id: "lease_1", property_id: "property_1", unit_id: "unit_1",
      status: "draft", start_date: "2026-10-01", end_date: null, monthly_rent_cents: 150000,
      currency_code: "USD", rent_due_day: 1, document_evidence_id: null, activated_at: null, ended_at: null,
      created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", notes: null };

    // Every table load() touches for a lease with a memberships row, given placeholder/empty data --
    // overridden per test with the specific rows that test cares about.
    function fullTables(overrides = {}) {
      return {
        rental_tenants: chain({ data: TENANT, error: null }),
        rental_billing_settings: chain({ data: { billing_enabled: true }, error: null }),
        rental_lease_tenants: chain({ data: [{ owner_id: "owner_1", lease_id: "lease_1", tenant_id: "tenant_1" }], error: null }),
        rental_leases: chain({ data: [LEASE], error: null }),
        rental_units: chain({ data: null, error: null }),
        rent_schedules: chain({ data: [], error: null }),
        rent_charges: chain({ data: [], error: null }),
        rental_payments: chain({ data: [], error: null }),
        renters_insurance_requirements: chain({ data: null, error: null }),
        renters_insurance_policies: chain({ data: [], error: null }),
        rental_maintenance_requests: chain({ data: [], error: null }),
        rental_security_deposits: chain({ data: [], error: null }),
        rental_inspections: chain({ data: [], error: null }),
        rental_autopay_enrollments: chain({ data: [], error: null }),
        rental_animals: chain({ data: [], error: null }),
        rental_lease_preparations: chain({ data: null, error: null }),
        rental_conversations: chain({ data: null, error: null }),
        ...overrides,
      };
    }

    it("is null when no lease preparation version has been approved yet", async () => {
      const tables = fullTables();
      const service = new TenantPortalQueryService({ from: fromRouter(tables), rpc: vi.fn(async () => ({ data: [], error: null })) });
      const portal = await service.load("auth_1");
      expect(portal.rentals[0].leaseSigning).toBeNull();
    });

    it("surfaces the approved version's terms, this tenant's own signature, and the full lease roster's signing progress", async () => {
      const tables = fullTables({
        rental_lease_preparations: chain({ data: { owner_id: "owner_1", id: "prep_1", lease_id: "lease_1",
          title: "Residential lease", status: "approved", current_version: 1, approved_version: 1,
          approved_at: "2026-09-01T00:00:00Z" }, error: null }),
        rental_lease_preparation_versions: chain({ data: { terms: { monthlyRent: "1500" }, change_summary: "Initial terms" }, error: null }),
        rental_lease_signatures: chain({ data: [
          { tenant_id: "tenant_1", signer_name: "T Realname", signed_at: "2026-09-02T00:00:00Z" },
        ], error: null }),
      });
      // rental_lease_tenants is queried twice with different shapes: first "my own memberships"
      // (needs lease_id, used by the lease mapper), then the full lease roster (two tenants on
      // this lease -- only one, this tenant, has signed).
      tables.rental_lease_tenants = vi.fn()
        .mockReturnValueOnce(chain({ data: [{ owner_id: "owner_1", lease_id: "lease_1", tenant_id: "tenant_1" }], error: null }))
        .mockReturnValueOnce(chain({ data: [
          { tenant_id: "tenant_1", rental_tenants: { display_name: "T" } },
          { tenant_id: "tenant_2", rental_tenants: { display_name: "Co-tenant" } },
        ], error: null }));
      const service = new TenantPortalQueryService({ from: fromRouter(tables), rpc: vi.fn(async () => ({ data: [], error: null })) });
      const portal = await service.load("auth_1");
      const signing = portal.rentals[0].leaseSigning;
      expect(signing.preparationId).toBe("prep_1");
      expect(signing.versionNumber).toBe(1);
      expect(signing.terms).toEqual({ monthlyRent: "1500" });
      expect(signing.changeSummary).toBe("Initial terms");
      expect(signing.signedByMe).toBe(true);
      expect(signing.mySignedAt).toBe("2026-09-02T00:00:00Z");
      expect(signing.totalTenants).toBe(2);
      expect(signing.signatures).toHaveLength(1);
      expect(signing.signatures[0]).toMatchObject({ tenantId: "tenant_1", signerName: "T Realname", displayName: "T" });
    });

    it("signedByMe is false and mySignedAt is null when this tenant has not yet signed the approved version", async () => {
      const tables = fullTables({
        rental_lease_preparations: chain({ data: { owner_id: "owner_1", id: "prep_1", lease_id: "lease_1",
          title: "Residential lease", status: "approved", current_version: 1, approved_version: 1,
          approved_at: "2026-09-01T00:00:00Z" }, error: null }),
        rental_lease_preparation_versions: chain({ data: { terms: {}, change_summary: "Initial terms" }, error: null }),
        rental_lease_signatures: chain({ data: [], error: null }),
      });
      const service = new TenantPortalQueryService({ from: fromRouter(tables), rpc: vi.fn(async () => ({ data: [], error: null })) });
      const portal = await service.load("auth_1");
      expect(portal.rentals[0].leaseSigning.signedByMe).toBe(false);
      expect(portal.rentals[0].leaseSigning.mySignedAt).toBeNull();
    });
  });

  describe("conversation", () => {
    const TENANT = { id: "tenant_1", owner_id: "owner_1", auth_user_id: "auth_1", display_name: "T",
      email: "t@example.com", phone: null, status: "active", invited_at: null, activated_at: null,
      created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };

    it("is empty with no unread flag when the tenant has never messaged and the owner never has either", async () => {
      const tables = {
        rental_tenants: chain({ data: TENANT, error: null }),
        rental_billing_settings: chain({ data: { billing_enabled: true }, error: null }),
        rental_lease_tenants: chain({ data: [], error: null }),
        rental_conversations: chain({ data: null, error: null }),
      };
      const service = new TenantPortalQueryService({ from: fromRouter(tables) });
      const portal = await service.load("auth_1");
      expect(portal.conversation).toEqual({ messages: [], hasUnread: false });
    });

    it("surfaces the full message history in order once a conversation exists", async () => {
      const tables = {
        rental_tenants: chain({ data: TENANT, error: null }),
        rental_billing_settings: chain({ data: { billing_enabled: true }, error: null }),
        rental_lease_tenants: chain({ data: [], error: null }),
        rental_conversations: chain({ data: { id: "conversation_1", last_message_at: "2026-09-05T12:00:00Z",
          last_message_sender_type: "owner", tenant_last_read_at: "2026-09-05T11:00:00Z" }, error: null }),
        rental_conversation_messages: chain({ data: [
          { id: "m1", sender_type: "tenant", body: "The heater is not working.", category: "issue", created_at: "2026-09-05T11:00:00Z" },
          { id: "m2", sender_type: "owner", body: "Sending someone tomorrow.", category: null, created_at: "2026-09-05T12:00:00Z" },
        ], error: null }),
      };
      const service = new TenantPortalQueryService({ from: fromRouter(tables) });
      const portal = await service.load("auth_1");
      expect(portal.conversation.messages).toEqual([
        { id: "m1", senderType: "tenant", body: "The heater is not working.", category: "issue", createdAt: "2026-09-05T11:00:00Z" },
        { id: "m2", senderType: "owner", body: "Sending someone tomorrow.", category: null, createdAt: "2026-09-05T12:00:00Z" },
      ]);
    });

    it("is unread when the owner sent the most recent message and the tenant hasn't read it yet", async () => {
      const tables = {
        rental_tenants: chain({ data: TENANT, error: null }),
        rental_billing_settings: chain({ data: { billing_enabled: true }, error: null }),
        rental_lease_tenants: chain({ data: [], error: null }),
        rental_conversations: chain({ data: { id: "conversation_1", last_message_at: "2026-09-05T12:00:00Z",
          last_message_sender_type: "owner", tenant_last_read_at: null }, error: null }),
        rental_conversation_messages: chain({ data: [], error: null }),
      };
      const service = new TenantPortalQueryService({ from: fromRouter(tables) });
      const portal = await service.load("auth_1");
      expect(portal.conversation.hasUnread).toBe(true);
    });

    it("is not unread when the tenant sent the most recent message themselves", async () => {
      const tables = {
        rental_tenants: chain({ data: TENANT, error: null }),
        rental_billing_settings: chain({ data: { billing_enabled: true }, error: null }),
        rental_lease_tenants: chain({ data: [], error: null }),
        rental_conversations: chain({ data: { id: "conversation_1", last_message_at: "2026-09-05T12:00:00Z",
          last_message_sender_type: "tenant", tenant_last_read_at: "2026-09-05T12:00:00Z" }, error: null }),
        rental_conversation_messages: chain({ data: [], error: null }),
      };
      const service = new TenantPortalQueryService({ from: fromRouter(tables) });
      const portal = await service.load("auth_1");
      expect(portal.conversation.hasUnread).toBe(false);
    });

    it("is not unread once the tenant has read past the owner's last message", async () => {
      const tables = {
        rental_tenants: chain({ data: TENANT, error: null }),
        rental_billing_settings: chain({ data: { billing_enabled: true }, error: null }),
        rental_lease_tenants: chain({ data: [], error: null }),
        rental_conversations: chain({ data: { id: "conversation_1", last_message_at: "2026-09-05T12:00:00Z",
          last_message_sender_type: "owner", tenant_last_read_at: "2026-09-05T13:00:00Z" }, error: null }),
        rental_conversation_messages: chain({ data: [], error: null }),
      };
      const service = new TenantPortalQueryService({ from: fromRouter(tables) });
      const portal = await service.load("auth_1");
      expect(portal.conversation.hasUnread).toBe(false);
    });
  });
});
