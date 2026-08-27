import { beforeEach, describe, expect, it, vi } from "vitest";
const application = { units: { findById: vi.fn() }, findUnitsByProperty: vi.fn(), saveUnit: vi.fn(), saveTenant: vi.fn(), saveLease: vi.fn(), saveSchedule: vi.fn(), generateMonthlyCharge: vi.fn() };
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({
  createAuthenticatedRentalManagerApplication: vi.fn(async () => ({ application, user: { id: "owner_1" } })),
}));
import { GET, POST } from "./route.js";
function request(body) { return new Request("http://localhost/api/rental", { method: "POST", body: JSON.stringify(body) }); }
describe("Rental Manager route", () => {
  beforeEach(() => { vi.clearAllMocks(); application.findUnitsByProperty.mockResolvedValue([]); });
  it("saves a validated owner-scoped unit", async () => {
    application.saveUnit.mockImplementation(async (value) => value);
    const response = await POST(request({ operation: "save-unit", unit: { propertyId: "4800-kent-ave", label: "Main residence",
      status: "preparing", bedrooms: 3, bathrooms: 2, squareFeet: 1450 } }));
    expect(response.status).toBe(200);
    expect(application.saveUnit).toHaveBeenCalledWith(expect.objectContaining({ propertyId: "4800-kent-ave" }), "owner_1");
  });
  it("rejects an exact duplicate property/unit before saving", async () => {
    application.findUnitsByProperty.mockResolvedValue([{ id: "unit_1", label: "1214 Wagner", status: "occupied" }]);
    const response = await POST(request({ operation: "save-unit", unit: { propertyId: "1214-wagner", label: "1214 WAGNER", status: "preparing" } }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("already exists");
    expect(application.saveUnit).not.toHaveBeenCalled();
  });
  it("archives an inactive duplicate only when no active lease exists", async () => {
    const chain = { select: vi.fn(() => chain), eq: vi.fn(() => chain), limit: vi.fn(async () => ({ data: [], error: null })) };
    const { createAuthenticatedRentalManagerApplication } = await import("@/lib/supabase/createAuthenticatedRentalManagerApplication");
    createAuthenticatedRentalManagerApplication.mockResolvedValueOnce({ application, user: { id: "owner_1" }, supabaseClient: { from: vi.fn(() => chain) } });
    application.units.findById.mockResolvedValue({ id: "unit_1", propertyId: "1214-wagner", label: "1214 Wagner", status: "available", bedrooms: null, bathrooms: null, squareFeet: null, availableAt: null, createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-01T00:00:00Z", notes: null });
    application.saveUnit.mockImplementation(async (value) => value);
    const response = await POST(request({ operation: "archive-unit", unitId: "unit_1" }));
    expect(response.status).toBe(200);
    expect((await response.json()).unit.status).toBe("inactive");
  });
  it("permanently deletes an archived empty duplicate", async () => {
    const emptyReference = () => { const chain = { select: vi.fn(() => chain), eq: vi.fn(() => chain), limit: vi.fn(async () => ({ data: [], error: null })) }; return chain; };
    const deleteChain = { delete: vi.fn(() => deleteChain), eq: vi.fn(() => deleteChain), select: vi.fn(() => deleteChain), maybeSingle: vi.fn(async () => ({ data: { id: "unit_1", label: "1214 Wagner" }, error: null })) };
    const from = vi.fn((table) => table === "rental_units" ? deleteChain : emptyReference());
    const { createAuthenticatedRentalManagerApplication } = await import("@/lib/supabase/createAuthenticatedRentalManagerApplication");
    createAuthenticatedRentalManagerApplication.mockResolvedValueOnce({ application, user: { id: "owner_1" }, supabaseClient: { from } });
    application.units.findById.mockResolvedValue({ id: "unit_1", label: "1214 Wagner", status: "inactive" });
    const response = await POST(request({ operation: "delete-archived-unit", unitId: "unit_1" }));
    expect(response.status).toBe(200);
    expect(deleteChain.delete).toHaveBeenCalled();
    expect(deleteChain.eq).toHaveBeenCalledWith("status", "inactive");
  });
  it("protects an archived property with any linked history from permanent deletion", async () => {
    const referenced = () => { const chain = { select: vi.fn(() => chain), eq: vi.fn(() => chain), limit: vi.fn(async () => ({ data: [{ id: "lease_1" }], error: null })) }; return chain; };
    const { createAuthenticatedRentalManagerApplication } = await import("@/lib/supabase/createAuthenticatedRentalManagerApplication");
    createAuthenticatedRentalManagerApplication.mockResolvedValueOnce({ application, user: { id: "owner_1" }, supabaseClient: { from: vi.fn(() => referenced()) } });
    application.units.findById.mockResolvedValue({ id: "unit_1", label: "1214 Wagner", status: "inactive" });
    const response = await POST(request({ operation: "delete-archived-unit", unitId: "unit_1" }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("linked lease, maintenance, or inspection history");
  });
  it("generates an owner-scoped charge", async () => {
    application.generateMonthlyCharge.mockResolvedValue({ id: "charge_1" });
    const response = await POST(request({ operation: "generate-charge", scheduleId: "schedule_1", period: "2026-09" }));
    expect(response.status).toBe(200);
    expect(application.generateMonthlyCharge).toHaveBeenCalledWith("schedule_1", "2026-09", "owner_1");
  });
  it("rejects unsupported operations", async () => expect((await POST(request({ operation: "unknown" }))).status).toBe(400));
  it("surfaces a Supabase-style error's message instead of a generic fallback", async () => {
    application.saveTenant.mockRejectedValue({ message: "column \"phone\" violates check constraint", code: "23514" });
    const response = await POST(request({ operation: "save-tenant", tenant: { displayName: "Ashley George", email: "ashley@example.com" } }));
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body.error).toBe('column "phone" violates check constraint');
  });
  it("gives a friendly message for a duplicate-identity error", async () => {
    application.saveTenant.mockRejectedValue({ message: "duplicate key value violates unique constraint \"rental_tenants_owner_id_email_key\"", code: "23505" });
    const response = await POST(request({ operation: "save-tenant", tenant: { displayName: "Ashley George", email: "ashley@example.com" } }));
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body.error).toContain("already exists");
  });
  it("loads the persisted setup records needed by the lease form", async () => {
    const result = (data) => ({ data, error: null, select: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
      order: vi.fn().mockResolvedValue({ data, error: null }), range: vi.fn().mockResolvedValue({ data, error: null }) });
    const tables = { rent_charges: result([{ id: "charge_1" }]), rental_units: result([{ id: "unit_1" }]),
      rental_tenants: result([{ id: "tenant_1" }]), rent_schedules: result([{ id: "schedule_1", status: "draft" }]),
      rental_maintenance_requests: result([{ id: "request_1", status: "submitted" }]),
      rental_notification_outbox: result([{ id: "notification_1", status: "queued" }]),
      rental_payments: result([{ id: "payment_1", status: "succeeded" }]),
      rental_settlements: result([{ id: "settlement_1", payment_id: "payment_1", status: "paid_out" }]),
      rental_security_deposits: result([{ id: "deposit_1", status: "held" }]),
      rental_security_deposit_transactions: result([{ id: "deposit_tx_1", deposit_id: "deposit_1" }]),
      rental_inspections: result([{ id: "inspection_1", status: "draft" }]),
      rental_inspection_items: result([{ id: "item_1", inspection_id: "inspection_1" }]),
      rental_inspection_acknowledgements: result([]),rental_leases:result([{id:"lease_1",status:"active"}]),
      rental_lease_tenants:result([{lease_id:"lease_1",tenant_id:"tenant_1"}]),
      rental_lease_changes:result([{id:"change_1",status:"draft"}]),rental_late_fee_rules:result([{id:"rule_1",status:"active"}]),rental_late_fee_assessments:result([]),
      rental_contractors:result([{id:"contractor_1",business_name:"Reliable Plumbing"}]),rental_maintenance_work_orders:result([{id:"work_1",request_id:"request_1"}]),rental_maintenance_work_events:result([{id:"event_1",work_order_id:"work_1"}]),rental_lease_preparations:result([{id:"prep_1",lease_id:"lease_1",current_version:1}]),rental_lease_preparation_versions:result([{preparation_id:"prep_1",version_number:1}]),rental_autopay_enrollments:result([{id:"autopay_1",status:"setup_required"}]),renters_insurance_policies:result([{id:"policy_1",status:"pending_verification"}]),rental_animals:result([{id:"animal_1",classification:"pet",approval_status:"requested"}]),rental_support_cases:result([{id:"case_1",case_type:"failed_payment",status:"open"}]),rental_billing_settings:result({billing_enabled:true}),financial_events:result([{event_date:"2026-08-05",amount:"1500.00",transaction_kind:"income",source_system:"rentec",status:"active",is_deleted:false}]) };
    const { createAuthenticatedRentalManagerApplication } = await import("@/lib/supabase/createAuthenticatedRentalManagerApplication");
    createAuthenticatedRentalManagerApplication.mockResolvedValueOnce({ application, user: { id: "owner_1" },
      supabaseClient: { from: vi.fn((table) => tables[table]) } });
    const response = await GET(); const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ units: [{ id: "unit_1" }], tenants: [{ id: "tenant_1" }],
      schedules: [{ id: "schedule_1", status: "draft" }], maintenanceRequests: [{ id: "request_1", status: "submitted" }],
      notifications: [{ id: "notification_1", status: "queued" }], payments: [{ id: "payment_1", status: "succeeded" }],
      settlements: [{ id: "settlement_1", payment_id: "payment_1", status: "paid_out" }], deposits: [{ id: "deposit_1", status: "held" }],
      depositTransactions: [{ id: "deposit_tx_1", deposit_id: "deposit_1" }], inspections: [{ id: "inspection_1", status: "draft" }],
      inspectionItems: [{ id: "item_1", inspection_id: "inspection_1" }], inspectionAcknowledgements: [],leases:[{id:"lease_1",status:"active"}],leaseMemberships:[{lease_id:"lease_1",tenant_id:"tenant_1"}],leaseChanges:[{id:"change_1",status:"draft"}],lateFeeRules:[{id:"rule_1",status:"active"}],lateFeeAssessments:[],contractors:[{id:"contractor_1",business_name:"Reliable Plumbing"}],workOrders:[{id:"work_1",request_id:"request_1"}],workEvents:[{id:"event_1",work_order_id:"work_1"}],leasePreparations:[{id:"prep_1",lease_id:"lease_1",current_version:1}],leasePreparationVersions:[{preparation_id:"prep_1",version_number:1}],autopayEnrollments:[{id:"autopay_1",status:"setup_required"}],insurancePolicies:[{id:"policy_1",status:"pending_verification"}],animals:[{id:"animal_1",classification:"pet",approval_status:"requested"}],supportCases:[{id:"case_1",case_type:"failed_payment",status:"open"}], billingEnabled: true, financialEvents: [{ event_date: "2026-08-05", amount: "1500.00", transaction_kind: "income", source_system: "rentec", status: "active", is_deleted: false }] });
  });
  // Regression test for a real production bug: financial_events for a long-tenured owner can
  // exceed PostgREST's default 1000-row page size, and an unbounded .select() ordered by
  // event_date ascending silently truncates to the OLDEST 1000 rows — making the Portfolio
  // performance chart's most recent years (the ones a landlord actually cares about) vanish.
  it("returns financial events beyond PostgREST's 1000-row default page cap, paginating through every page", async () => {
    const result = (data) => ({ data, error: null, select: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
      order: vi.fn().mockResolvedValue({ data, error: null }), range: vi.fn().mockResolvedValue({ data, error: null }) });
    const firstPage = Array.from({ length: 1000 }, (_, index) => ({
      event_date: "2025-01-01", amount: "1.00", transaction_kind: "income", source_system: "rentec_api",
      status: "active", is_deleted: false, __page: 1, __index: index,
    }));
    const secondPage = [{ event_date: "2026-08-05", amount: "1500.00", transaction_kind: "income", source_system: "rentec_api", status: "active", is_deleted: false, __page: 2 }];
    const financialEventsChain = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValueOnce({ data: firstPage, error: null }).mockResolvedValueOnce({ data: secondPage, error: null }),
    };
    const tables = { rent_charges: result([]), rental_units: result([]), rental_tenants: result([]), rent_schedules: result([]),
      rental_maintenance_requests: result([]), rental_notification_outbox: result([]), rental_payments: result([]),
      rental_settlements: result([]), rental_security_deposits: result([]), rental_security_deposit_transactions: result([]),
      rental_inspections: result([]), rental_inspection_items: result([]), rental_inspection_acknowledgements: result([]),
      rental_leases: result([]), rental_lease_tenants: result([]), rental_lease_changes: result([]),
      rental_late_fee_rules: result([]), rental_late_fee_assessments: result([]), rental_contractors: result([]),
      rental_maintenance_work_orders: result([]), rental_maintenance_work_events: result([]), rental_lease_preparations: result([]),
      rental_lease_preparation_versions: result([]), rental_autopay_enrollments: result([]), renters_insurance_policies: result([]),
      rental_animals: result([]), rental_support_cases: result([]), rental_billing_settings: result(null),
      financial_events: financialEventsChain };
    const { createAuthenticatedRentalManagerApplication } = await import("@/lib/supabase/createAuthenticatedRentalManagerApplication");
    createAuthenticatedRentalManagerApplication.mockResolvedValueOnce({ application, user: { id: "owner_1" },
      supabaseClient: { from: vi.fn((table) => tables[table]) } });
    const response = await GET(); const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.financialEvents).toHaveLength(1001);
    expect(body.financialEvents.some((event) => event.__page === 2)).toBe(true);
  });
  it("dashboard collectionSummary distinguishes FORGE-collectible from externally-managed open charges", async () => {
    const result = (data) => ({ data, error: null, select: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
      order: vi.fn().mockResolvedValue({ data, error: null }), range: vi.fn().mockResolvedValue({ data, error: null }) });
    const charges = [
      { id: "charge_forge", schedule_id: "schedule_forge", amount_cents: 20000, paid_amount_cents: 0 },
      { id: "charge_external", schedule_id: "schedule_external", amount_cents: 150000, paid_amount_cents: 0 },
      { id: "charge_no_schedule", schedule_id: "schedule_missing", amount_cents: 50000, paid_amount_cents: 0 },
    ];
    const schedules = [
      { id: "schedule_forge", collection_mode: "forge", forge_cutover_date: "2020-01-01" },
      { id: "schedule_external", collection_mode: "external", forge_cutover_date: null },
    ];
    const tables = { rent_charges: result(charges), rental_units: result([]), rental_tenants: result([]), rent_schedules: result(schedules),
      rental_maintenance_requests: result([]), rental_notification_outbox: result([]), rental_payments: result([]), rental_settlements: result([]),
      rental_security_deposits: result([]), rental_security_deposit_transactions: result([]), rental_inspections: result([]), rental_inspection_items: result([]),
      rental_inspection_acknowledgements: result([]), rental_leases: result([]), rental_lease_tenants: result([]), rental_lease_changes: result([]),
      rental_late_fee_rules: result([]), rental_late_fee_assessments: result([]), rental_contractors: result([]), rental_maintenance_work_orders: result([]),
      rental_maintenance_work_events: result([]), rental_lease_preparations: result([]), rental_lease_preparation_versions: result([]),
      rental_autopay_enrollments: result([]), renters_insurance_policies: result([]), rental_animals: result([]), rental_support_cases: result([]), rental_billing_settings: result(null), financial_events: result([]) };
    const { createAuthenticatedRentalManagerApplication } = await import("@/lib/supabase/createAuthenticatedRentalManagerApplication");
    createAuthenticatedRentalManagerApplication.mockResolvedValueOnce({ application, user: { id: "owner_1" }, supabaseClient: { from: vi.fn((table) => tables[table]) } });
    const response = await GET(); const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.collectionSummary).toEqual({
      forgeCollectibleCents: 20000, forgeCollectibleCount: 1,
      externallyManagedCents: 200000, externallyManagedCount: 2, // external schedule + no-matching-schedule charge both count as not-FORGE-collectible
    });
    // No rental_billing_settings row exists yet for this owner (production default) — must read
    // as paused, never as enabled.
    expect(body.billingEnabled).toBe(false);
  });
  it("attaches signed photo URLs to units and tenants that have one, and null otherwise", async () => {
    const result = (data) => ({ data, error: null, select: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
      order: vi.fn().mockResolvedValue({ data, error: null }), range: vi.fn().mockResolvedValue({ data, error: null }) });
    const tables = { rent_charges: result([]), rental_units: result([{ id: "unit_1", photo_bucket: "rental-photos", photo_object_path: "owner_1/units/unit_1/x.jpg" }]),
      rental_tenants: result([{ id: "tenant_1", photo_bucket: null, photo_object_path: null }]), rent_schedules: result([]),
      rental_maintenance_requests: result([]), rental_notification_outbox: result([]), rental_payments: result([]), rental_settlements: result([]),
      rental_security_deposits: result([]), rental_security_deposit_transactions: result([]), rental_inspections: result([]), rental_inspection_items: result([]),
      rental_inspection_acknowledgements: result([]), rental_leases: result([]), rental_lease_tenants: result([]), rental_lease_changes: result([]),
      rental_late_fee_rules: result([]), rental_late_fee_assessments: result([]), rental_contractors: result([]), rental_maintenance_work_orders: result([]),
      rental_maintenance_work_events: result([]), rental_lease_preparations: result([]), rental_lease_preparation_versions: result([]),
      rental_autopay_enrollments: result([]), renters_insurance_policies: result([]), rental_animals: result([]), rental_support_cases: result([]), rental_billing_settings: result(null), financial_events: result([]) };
    const createSignedUrl = vi.fn(async () => ({ data: { signedUrl: "https://signed.test/unit-photo" }, error: null }));
    const { createAuthenticatedRentalManagerApplication } = await import("@/lib/supabase/createAuthenticatedRentalManagerApplication");
    createAuthenticatedRentalManagerApplication.mockResolvedValueOnce({ application, user: { id: "owner_1" },
      supabaseClient: { from: vi.fn((table) => tables[table]), storage: { from: vi.fn(() => ({ createSignedUrl })) } } });
    const response = await GET(); const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.units[0].photo_url).toBe("https://signed.test/unit-photo");
    expect(body.tenants[0].photo_url).toBeNull();
    expect(createSignedUrl).toHaveBeenCalledWith("owner_1/units/unit_1/x.jpg", 3600);
  });
  it("atomically activates the authenticated owner's lease and schedule", async () => {
    const rpc = vi.fn(async () => ({ data: { leaseId: "lease_1", scheduleId: "schedule_1", status: "active" }, error: null }));
    const { createAuthenticatedRentalManagerApplication } = await import("@/lib/supabase/createAuthenticatedRentalManagerApplication");
    createAuthenticatedRentalManagerApplication.mockResolvedValueOnce({ application, user: { id: "owner_1" },
      supabaseClient: { rpc } });
    const response = await POST(request({ operation: "activate-lease-schedule", scheduleId: "schedule_1" }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("activate_rental_lease_schedule", { p_owner_id: "owner_1", p_schedule_id: "schedule_1" });
  });
  it("updates only an unlinked owner-scoped tenant email", async () => {
    const query = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(), maybeSingle: vi.fn(async () => ({ data: { id: "tenant_1", email: "owner+tenant@example.com" }, error: null })) };
    const { createAuthenticatedRentalManagerApplication } = await import("@/lib/supabase/createAuthenticatedRentalManagerApplication");
    createAuthenticatedRentalManagerApplication.mockResolvedValueOnce({ application, user: { id: "owner_1" },
      supabaseClient: { from: vi.fn(() => query) } });
    const response = await POST(request({ operation: "update-tenant-email", tenantId: "tenant_1", email: "Owner+Tenant@Example.com" }));
    expect(response.status).toBe(200);
    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({ email: "owner+tenant@example.com" }));
    expect(query.is).toHaveBeenCalledWith("auth_user_id", null);
  });
  it("updates owner-scoped tenant profile details while storing only SSN last four", async () => {
    const query = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => ({ data: { id: "tenant_1", display_name: "Ashley George" }, error: null })) };
    const { createAuthenticatedRentalManagerApplication } = await import("@/lib/supabase/createAuthenticatedRentalManagerApplication");
    createAuthenticatedRentalManagerApplication.mockResolvedValueOnce({ application, user: { id: "owner_1" }, supabaseClient: { from: vi.fn(() => query) } });
    const response = await POST(request({ operation: "update-tenant-profile", tenantId: "tenant_1", profile: {
      phone: "555-1000", workPhone: "555-2000", monthlyIncomeCents: 450000, ssnLastFour: "1234", landlordNotes: "Owner-only note",
    } }));
    expect(response.status).toBe(200);
    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({ work_phone: "555-2000", monthly_income_cents: 450000, ssn_last_four: "1234" }));
    expect(JSON.stringify(query.update.mock.calls[0][0])).not.toContain("social_security_number");
  });
  it("rejects anything other than exactly four SSN digits", async () => {
    const response = await POST(request({ operation: "update-tenant-profile", tenantId: "tenant_1", profile: { ssnLastFour: "123-45-6789" } }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("exactly four digits");
  });
  it("changes the primary tenant through the workspace-scoped RPC", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const { createAuthenticatedRentalManagerApplication } = await import("@/lib/supabase/createAuthenticatedRentalManagerApplication");
    createAuthenticatedRentalManagerApplication.mockResolvedValueOnce({ application, user: { id: "owner_1" }, supabaseClient: { rpc } });
    const response = await POST(request({ operation: "set-primary-tenant", leaseId: "lease_1", tenantId: "tenant_2" }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("set_rental_primary_tenant", { p_owner_id: "owner_1", p_lease_id: "lease_1", p_tenant_id: "tenant_2" });
  });
  it("cancels only an owner-scoped draft lease", async () => {
    const query = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => ({ data: { id: "lease_1", status: "cancelled" }, error: null })) };
    const { createAuthenticatedRentalManagerApplication } = await import("@/lib/supabase/createAuthenticatedRentalManagerApplication");
    createAuthenticatedRentalManagerApplication.mockResolvedValueOnce({ application, user: { id: "owner_1" },
      supabaseClient: { from: vi.fn(() => query) } });
    const response = await POST(request({ operation: "cancel-lease", leaseId: "lease_1" }));
    expect(response.status).toBe(200);
    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({ status: "cancelled" }));
    expect(query.eq).toHaveBeenCalledWith("status", "draft");
  });
  it("refuses to cancel a lease that is not a draft", async () => {
    const query = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })) };
    const { createAuthenticatedRentalManagerApplication } = await import("@/lib/supabase/createAuthenticatedRentalManagerApplication");
    createAuthenticatedRentalManagerApplication.mockResolvedValueOnce({ application, user: { id: "owner_1" },
      supabaseClient: { from: vi.fn(() => query) } });
    const response = await POST(request({ operation: "cancel-lease", leaseId: "lease_1" }));
    expect(response.status).toBe(409);
  });
  it("refuses a charge when its schedule is not active and effective", async () => {
    application.generateMonthlyCharge.mockResolvedValue(null);
    const response = await POST(request({ operation: "generate-charge", scheduleId: "schedule_1", period: "2026-08" }));
    expect(response.status).toBe(409);
  });
  it("queues an owner-scoped reminder with bounded retries",async()=>{const rpc=vi.fn(async()=>({data:{id:"notice_1",status:"queued"},error:null}));const{createAuthenticatedRentalManagerApplication}=await import("@/lib/supabase/createAuthenticatedRentalManagerApplication");createAuthenticatedRentalManagerApplication.mockResolvedValueOnce({application,user:{id:"owner_1"},supabaseClient:{rpc}});const response=await POST(request({operation:"queue-rent-reminder",chargeId:"charge_1",notificationType:"rent_reminder",scheduledFor:"2026-09-28T12:00:00Z",maxAttempts:3}));expect(response.status).toBe(200);expect(rpc).toHaveBeenCalledWith("queue_rental_balance_reminder",expect.objectContaining({p_owner_id:"owner_1",p_charge_id:"charge_1",p_max_attempts:3}));});
  it("rejects excessive reminder retries",async()=>expect((await POST(request({operation:"queue-rent-reminder",chargeId:"charge_1",notificationType:"rent_reminder",scheduledFor:"2026-09-28T12:00:00Z",maxAttempts:9}))).status).toBe(400));
  it("voids an owner-scoped unpaid charge with a reason", async () => {
    const rpc = vi.fn(async () => ({ data: { id: "charge_1", status: "void", voided_at: "2026-08-20T00:00:00Z" }, error: null }));
    const { createAuthenticatedRentalManagerApplication } = await import("@/lib/supabase/createAuthenticatedRentalManagerApplication");
    createAuthenticatedRentalManagerApplication.mockResolvedValueOnce({ application, user: { id: "owner_1" }, supabaseClient: { rpc } });
    const response = await POST(request({ operation: "void-charge", chargeId: "charge_1", reason: "Generated against the wrong lease." }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("void_rental_rent_charge", { p_owner_id: "owner_1", p_charge_id: "charge_1", p_reason: "Generated against the wrong lease." });
    const body = await response.json();
    expect(body.charge).toEqual({ id: "charge_1", status: "void", voided_at: "2026-08-20T00:00:00Z" });
  });
  it("refuses to void a charge that is already paid or already void", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const { createAuthenticatedRentalManagerApplication } = await import("@/lib/supabase/createAuthenticatedRentalManagerApplication");
    createAuthenticatedRentalManagerApplication.mockResolvedValueOnce({ application, user: { id: "owner_1" }, supabaseClient: { rpc } });
    const response = await POST(request({ operation: "void-charge", chargeId: "charge_1", reason: "Mistake." }));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toBe("Only a charge with no paid balance, not already voided, and no pending or unreversed payment can be voided.");
  });
  it("requires a chargeId to void a charge", async () => {
    const response = await POST(request({ operation: "void-charge", reason: "Mistake." }));
    expect(response.status).toBe(400);
  });
  it("requires a reason to void a charge", async () => {
    const response = await POST(request({ operation: "void-charge", chargeId: "charge_1" }));
    expect(response.status).toBe(400);
  });
  it("activates FORGE billing collection for an owner-scoped schedule with an explicit cutover date", async () => {
    const rpc = vi.fn(async () => ({ data: { id: "schedule_1", collection_mode: "forge", forge_cutover_date: "2026-09-01" }, error: null }));
    const { createAuthenticatedRentalManagerApplication } = await import("@/lib/supabase/createAuthenticatedRentalManagerApplication");
    createAuthenticatedRentalManagerApplication.mockResolvedValueOnce({ application, user: { id: "owner_1" }, supabaseClient: { rpc } });
    const response = await POST(request({ operation: "activate-forge-billing", scheduleId: "schedule_1", cutoverDate: "2026-09-01", reconciliationSummary: { matched: 3 } }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("activate_forge_billing_collection", {
      p_owner_id: "owner_1", p_schedule_id: "schedule_1", p_cutover_date: "2026-09-01", p_reconciliation_summary: { matched: 3 },
    });
  });
  it("requires a scheduleId to activate FORGE billing", async () => {
    const response = await POST(request({ operation: "activate-forge-billing", cutoverDate: "2026-09-01" }));
    expect(response.status).toBe(400);
  });
  it("requires a valid cutoverDate to activate FORGE billing", async () => {
    const response = await POST(request({ operation: "activate-forge-billing", scheduleId: "schedule_1", cutoverDate: "not-a-date" }));
    expect(response.status).toBe(400);
  });
  it("defaults reconciliationSummary to an empty object when omitted", async () => {
    const rpc = vi.fn(async () => ({ data: { id: "schedule_1" }, error: null }));
    const { createAuthenticatedRentalManagerApplication } = await import("@/lib/supabase/createAuthenticatedRentalManagerApplication");
    createAuthenticatedRentalManagerApplication.mockResolvedValueOnce({ application, user: { id: "owner_1" }, supabaseClient: { rpc } });
    await POST(request({ operation: "activate-forge-billing", scheduleId: "schedule_1", cutoverDate: "2026-09-01" }));
    expect(rpc).toHaveBeenCalledWith("activate_forge_billing_collection", expect.objectContaining({ p_reconciliation_summary: {} }));
  });
  it("enables rental billing (resumes FORGE) for the authenticated owner", async () => {
    const rpc = vi.fn(async () => ({ data: { owner_id: "owner_1", billing_enabled: true }, error: null }));
    const { createAuthenticatedRentalManagerApplication } = await import("@/lib/supabase/createAuthenticatedRentalManagerApplication");
    createAuthenticatedRentalManagerApplication.mockResolvedValueOnce({ application, user: { id: "owner_1" }, supabaseClient: { rpc } });
    const response = await POST(request({ operation: "set-billing-enabled", enabled: true }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("set_rental_billing_enabled", { p_owner_id: "owner_1", p_enabled: true });
  });
  it("disables rental billing (pauses FORGE) for the authenticated owner", async () => {
    const rpc = vi.fn(async () => ({ data: { owner_id: "owner_1", billing_enabled: false }, error: null }));
    const { createAuthenticatedRentalManagerApplication } = await import("@/lib/supabase/createAuthenticatedRentalManagerApplication");
    createAuthenticatedRentalManagerApplication.mockResolvedValueOnce({ application, user: { id: "owner_1" }, supabaseClient: { rpc } });
    const response = await POST(request({ operation: "set-billing-enabled", enabled: false }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("set_rental_billing_enabled", { p_owner_id: "owner_1", p_enabled: false });
  });
  it("rejects set-billing-enabled with a non-boolean enabled value", async () => {
    const response = await POST(request({ operation: "set-billing-enabled", enabled: "yes" }));
    expect(response.status).toBe(400);
  });
  it("updates a maintenance request only through the authenticated owner scope", async () => {
    const query = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => ({ data: { id: "request_1", status: "scheduled" }, error: null })) };
    const { createAuthenticatedRentalManagerApplication } = await import("@/lib/supabase/createAuthenticatedRentalManagerApplication");
    createAuthenticatedRentalManagerApplication.mockResolvedValueOnce({ application, user: { id: "owner_1" },
      supabaseClient: { from: vi.fn(() => query) } });
    const response = await POST(request({ operation: "update-maintenance-request", requestId: "request_1",
      status: "scheduled", ownerNotes: "Vendor visit requested." }));
    expect(response.status).toBe(200);
    expect(query.eq).toHaveBeenNthCalledWith(1, "owner_id", "owner_1");
    expect(query.eq).toHaveBeenNthCalledWith(2, "id", "request_1");
    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({ status: "scheduled", owner_notes: "Vendor visit requested." }));
  });
  it("saves a structured inspection only after validating its lease relationships",async()=>{const rpc=vi.fn(async()=>({data:{id:"inspection_1",status:"draft"},error:null})),query=data=>({select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),maybeSingle:vi.fn(async()=>({data,error:null}))}),tables={rental_leases:query({id:"lease_1",unit_id:"unit_1"}),rental_lease_tenants:query({tenant_id:"tenant_1"})};const{createAuthenticatedRentalManagerApplication}=await import("@/lib/supabase/createAuthenticatedRentalManagerApplication");createAuthenticatedRentalManagerApplication.mockResolvedValueOnce({application,user:{id:"owner_1"},supabaseClient:{from:vi.fn(table=>tables[table]),rpc}});const response=await POST(request({operation:"save-inspection",inspection:{leaseId:"lease_1",unitId:"unit_1",tenantId:"tenant_1",inspectionType:"move_in",inspectionDate:"2026-08-12"},items:[{area:"Kitchen",component:"Overall",conditionRating:"good"}]}));expect(response.status).toBe(200);expect(rpc).toHaveBeenCalledWith("save_rental_inspection",expect.objectContaining({p_owner_id:"owner_1"}));});
  it("rejects a forged inspection relationship before calling the save RPC",async()=>{const rpc=vi.fn(),query=data=>({select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),maybeSingle:vi.fn(async()=>({data,error:null}))}),tables={rental_leases:query({id:"lease_1",unit_id:"unit_2"}),rental_lease_tenants:query({tenant_id:"tenant_1"})};const{createAuthenticatedRentalManagerApplication}=await import("@/lib/supabase/createAuthenticatedRentalManagerApplication");createAuthenticatedRentalManagerApplication.mockResolvedValueOnce({application,user:{id:"owner_1"},supabaseClient:{from:vi.fn(table=>tables[table]),rpc}});const response=await POST(request({operation:"save-inspection",inspection:{leaseId:"lease_1",unitId:"unit_1",tenantId:"tenant_1",inspectionType:"move_in",inspectionDate:"2026-08-12"},items:[{area:"Kitchen",component:"Overall",conditionRating:"good"}]}));expect(response.status).toBe(400);expect(rpc).not.toHaveBeenCalled();});
  it("requires explicit owner approval before a late-fee assessment",async()=>{const response=await POST(request({operation:"assess-late-fee",ruleId:"rule_1",chargeId:"charge_1",reason:"Past grace period",ownerApproved:false}));expect(response.status).toBe(400);});
  it("creates a work order and its first event atomically",async()=>{const rpc=vi.fn(async()=>({data:{id:"work_1",status:"assigned"},error:null}));const{createAuthenticatedRentalManagerApplication}=await import("@/lib/supabase/createAuthenticatedRentalManagerApplication");createAuthenticatedRentalManagerApplication.mockResolvedValueOnce({application,user:{id:"owner_1"},supabaseClient:{rpc}});const response=await POST(request({operation:"create-maintenance-work-order",workOrder:{requestId:"request_1",contractorId:"contractor_1",scopeOfWork:"Repair kitchen leak",estimatedCostCents:22500}}));expect(response.status).toBe(200);expect(rpc).toHaveBeenCalledWith("create_rental_maintenance_work_order",expect.objectContaining({p_owner_id:"owner_1",p_work_order:expect.objectContaining({requestId:"request_1",estimatedCostCents:22500})}));});
  it("saves an immutable lease-preparation version",async()=>{const rpc=vi.fn(async()=>({data:{preparationId:"prep_1",versionNumber:2},error:null}));const{createAuthenticatedRentalManagerApplication}=await import("@/lib/supabase/createAuthenticatedRentalManagerApplication");createAuthenticatedRentalManagerApplication.mockResolvedValueOnce({application,user:{id:"owner_1"},supabaseClient:{rpc}});const response=await POST(request({operation:"save-lease-preparation-version",preparation:{leaseId:"lease_1",title:"Lease preparation",changeSummary:"Updated pet terms",terms:{pets:"One approved dog"}}}));expect(response.status).toBe(200);expect(rpc).toHaveBeenCalledWith("save_rental_lease_preparation_version",expect.objectContaining({p_owner_id:"owner_1",p_lease_id:"lease_1",p_terms:{pets:"One approved dog"}}));});
  it("requires explicit confirmation to approve a lease-preparation version",async()=>{expect((await POST(request({operation:"approve-lease-preparation-version",preparationId:"prep_1",versionNumber:1,ownerApprovalConfirmed:false}))).status).toBe(400);});
});
