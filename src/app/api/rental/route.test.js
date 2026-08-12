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
      rental_tenants: result([{ id: "tenant_1" }]), rent_schedules: result([{ id: "schedule_1", status: "draft" }]) };
    const { createAuthenticatedRentalManagerApplication } = await import("@/lib/supabase/createAuthenticatedRentalManagerApplication");
    createAuthenticatedRentalManagerApplication.mockResolvedValueOnce({ application, user: { id: "owner_1" },
      supabaseClient: { from: vi.fn((table) => tables[table]) } });
    const response = await GET(); const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ units: [{ id: "unit_1" }], tenants: [{ id: "tenant_1" }],
      schedules: [{ id: "schedule_1", status: "draft" }] });
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
  it("refuses a charge when its schedule is not active and effective", async () => {
    application.generateMonthlyCharge.mockResolvedValue(null);
    const response = await POST(request({ operation: "generate-charge", scheduleId: "schedule_1", period: "2026-08" }));
    expect(response.status).toBe(409);
  });
});
