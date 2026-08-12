import { beforeEach, describe, expect, it, vi } from "vitest";
const application = { saveUnit: vi.fn(), saveTenant: vi.fn(), saveLease: vi.fn(), saveSchedule: vi.fn(), generateMonthlyCharge: vi.fn() };
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({
  createAuthenticatedRentalManagerApplication: vi.fn(async () => ({ application, user: { id: "owner_1" } })),
}));
import { POST } from "./route.js";
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
});
