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
      rental_inspection_acknowledgements: result([]) };
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
      inspectionItems: [{ id: "item_1", inspection_id: "inspection_1" }], inspectionAcknowledgements: [] });
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
  it("saves a structured inspection through the authenticated owner RPC",async()=>{const rpc=vi.fn(async()=>({data:{id:"inspection_1",status:"draft"},error:null}));const{createAuthenticatedRentalManagerApplication}=await import("@/lib/supabase/createAuthenticatedRentalManagerApplication");createAuthenticatedRentalManagerApplication.mockResolvedValueOnce({application,user:{id:"owner_1"},supabaseClient:{rpc}});const response=await POST(request({operation:"save-inspection",inspection:{leaseId:"lease_1",unitId:"unit_1",tenantId:"tenant_1",inspectionType:"move_in",inspectionDate:"2026-08-12"},items:[{area:"Kitchen",component:"Overall",conditionRating:"good"}]}));expect(response.status).toBe(200);expect(rpc).toHaveBeenCalledWith("save_rental_inspection",expect.objectContaining({p_owner_id:"owner_1"}));});
});
