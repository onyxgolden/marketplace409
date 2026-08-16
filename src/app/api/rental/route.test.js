import { beforeEach, describe, expect, it, vi } from "vitest";
const application = { saveUnit: vi.fn(), saveTenant: vi.fn(), saveLease: vi.fn(), saveSchedule: vi.fn(), generateMonthlyCharge: vi.fn() };
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({
  createAuthenticatedRentalManagerApplication: vi.fn(async () => ({ application, user: { id: "owner_1" } })),
}));
import { GET, POST } from "./route.js";
function request(body) { return new Request("http://localhost/api/rental", { method: "POST", body: JSON.stringify(body) }); }
describe("Rental Manager route", () => {
  beforeEach(() => vi.clearAllMocks());
  it("saves a validated owner-scoped unit", async () => {
    application.saveUnit.mockImplementation(async (value) => value);
    const response = await POST(request({ operation: "save-unit", unit: { propertyId: "4800-kent-ave", label: "Main residence",
      status: "preparing", bedrooms: 3, bathrooms: 2, squareFeet: 1450 } }));
    expect(response.status).toBe(200);
    expect(application.saveUnit).toHaveBeenCalledWith(expect.objectContaining({ propertyId: "4800-kent-ave" }), "owner_1");
  });
  it("generates an owner-scoped charge", async () => {
    application.generateMonthlyCharge.mockResolvedValue({ id: "charge_1" });
    const response = await POST(request({ operation: "generate-charge", scheduleId: "schedule_1", period: "2026-09" }));
    expect(response.status).toBe(200);
    expect(application.generateMonthlyCharge).toHaveBeenCalledWith("schedule_1", "2026-09", "owner_1");
  });
  it("rejects unsupported operations", async () => expect((await POST(request({ operation: "unknown" }))).status).toBe(400));
  it("loads the persisted setup records needed by the lease form", async () => {
    const result = (data) => ({ data, error: null, select: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data, error: null }) });
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
      rental_contractors:result([{id:"contractor_1",business_name:"Reliable Plumbing"}]),rental_maintenance_work_orders:result([{id:"work_1",request_id:"request_1"}]),rental_maintenance_work_events:result([{id:"event_1",work_order_id:"work_1"}]),rental_lease_preparations:result([{id:"prep_1",lease_id:"lease_1",current_version:1}]),rental_lease_preparation_versions:result([{preparation_id:"prep_1",version_number:1}]),rental_autopay_enrollments:result([{id:"autopay_1",status:"setup_required"}]),renters_insurance_policies:result([{id:"policy_1",status:"pending_verification"}]),rental_animals:result([{id:"animal_1",classification:"pet",approval_status:"requested"}]),rental_support_cases:result([{id:"case_1",case_type:"failed_payment",status:"open"}]) };
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
      inspectionItems: [{ id: "item_1", inspection_id: "inspection_1" }], inspectionAcknowledgements: [],leases:[{id:"lease_1",status:"active"}],leaseMemberships:[{lease_id:"lease_1",tenant_id:"tenant_1"}],leaseChanges:[{id:"change_1",status:"draft"}],lateFeeRules:[{id:"rule_1",status:"active"}],lateFeeAssessments:[],contractors:[{id:"contractor_1",business_name:"Reliable Plumbing"}],workOrders:[{id:"work_1",request_id:"request_1"}],workEvents:[{id:"event_1",work_order_id:"work_1"}],leasePreparations:[{id:"prep_1",lease_id:"lease_1",current_version:1}],leasePreparationVersions:[{preparation_id:"prep_1",version_number:1}],autopayEnrollments:[{id:"autopay_1",status:"setup_required"}],insurancePolicies:[{id:"policy_1",status:"pending_verification"}],animals:[{id:"animal_1",classification:"pet",approval_status:"requested"}],supportCases:[{id:"case_1",case_type:"failed_payment",status:"open"}] });
  });
  it("attaches signed photo URLs to units and tenants that have one, and null otherwise", async () => {
    const result = (data) => ({ data, error: null, select: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data, error: null }) });
    const tables = { rent_charges: result([]), rental_units: result([{ id: "unit_1", photo_bucket: "rental-photos", photo_object_path: "owner_1/units/unit_1/x.jpg" }]),
      rental_tenants: result([{ id: "tenant_1", photo_bucket: null, photo_object_path: null }]), rent_schedules: result([]),
      rental_maintenance_requests: result([]), rental_notification_outbox: result([]), rental_payments: result([]), rental_settlements: result([]),
      rental_security_deposits: result([]), rental_security_deposit_transactions: result([]), rental_inspections: result([]), rental_inspection_items: result([]),
      rental_inspection_acknowledgements: result([]), rental_leases: result([]), rental_lease_tenants: result([]), rental_lease_changes: result([]),
      rental_late_fee_rules: result([]), rental_late_fee_assessments: result([]), rental_contractors: result([]), rental_maintenance_work_orders: result([]),
      rental_maintenance_work_events: result([]), rental_lease_preparations: result([]), rental_lease_preparation_versions: result([]),
      rental_autopay_enrollments: result([]), renters_insurance_policies: result([]), rental_animals: result([]), rental_support_cases: result([]) };
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
  it("refuses a charge when its schedule is not active and effective", async () => {
    application.generateMonthlyCharge.mockResolvedValue(null);
    const response = await POST(request({ operation: "generate-charge", scheduleId: "schedule_1", period: "2026-08" }));
    expect(response.status).toBe(409);
  });
  it("queues an owner-scoped reminder with bounded retries",async()=>{const rpc=vi.fn(async()=>({data:{id:"notice_1",status:"queued"},error:null}));const{createAuthenticatedRentalManagerApplication}=await import("@/lib/supabase/createAuthenticatedRentalManagerApplication");createAuthenticatedRentalManagerApplication.mockResolvedValueOnce({application,user:{id:"owner_1"},supabaseClient:{rpc}});const response=await POST(request({operation:"queue-rent-reminder",chargeId:"charge_1",notificationType:"rent_reminder",scheduledFor:"2026-09-28T12:00:00Z",maxAttempts:3}));expect(response.status).toBe(200);expect(rpc).toHaveBeenCalledWith("queue_rental_balance_reminder",expect.objectContaining({p_owner_id:"owner_1",p_charge_id:"charge_1",p_max_attempts:3}));});
  it("rejects excessive reminder retries",async()=>expect((await POST(request({operation:"queue-rent-reminder",chargeId:"charge_1",notificationType:"rent_reminder",scheduledFor:"2026-09-28T12:00:00Z",maxAttempts:9}))).status).toBe(400));
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
