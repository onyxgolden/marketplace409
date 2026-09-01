import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const authenticate = vi.fn(); const rpc = vi.fn(); let units = [];
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: (...args) => authenticate(...args) }));
import { POST } from "./route";
const csvText = "property_name,unit_name,space_type,booking_status,public_name,maximum_guests,minimum_nights,maximum_nights,turnover_buffer_hours,nightly_rate,cleaning_fee,security_deposit,lodging_tax_percent,amenities\nPine Park,Site 1,rv_site,draft,Pine Site 1,6,1,30,24,55.00,10.00,100.00,8.25,50 amp|water\n";
function request(body) { return new NextRequest("https://forge.test/api/rental/reservations/inventory/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
describe("reservation inventory bulk import route", () => {
  beforeEach(() => {
    vi.clearAllMocks(); units = []; process.env.RESERVATION_PREVIEW_TOKEN_SECRET = "route-test-secret-that-is-longer-than-thirty-two-characters";
    rpc.mockResolvedValue({ data: { importId: "import-1", createdUnits: 1, createdInventory: 1, createdRatePlans: 1 }, error: null });
    authenticate.mockResolvedValue({ user: { id: "actor-1" }, effectiveOwnerId: "owner-1", supabaseClient: { rpc, from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(async () => ({ data: units, error: null })) })) })) } });
  });
  it("previews a local CSV without writing and returns reconciliation", async () => {
    const response = await POST(request({ operation: "preview", csvText })); const body = await response.json();
    expect(response.status).toBe(200); expect(body.reconciliation).toMatchObject({ totalRows: 1, validRows: 1, errorRows: 0 }); expect(body.previewToken).toBeTruthy(); expect(rpc).not.toHaveBeenCalled();
  });
  it("requires acknowledgement and typed IMPORT", async () => { const response = await POST(request({ operation: "confirm", confirmationText: "import", acknowledged: true })); expect(response.status).toBe(400); expect(rpc).not.toHaveBeenCalled(); });
  it("confirms the exact signed plan through the atomic RPC", async () => {
    const previewResponse = await POST(request({ operation: "preview", csvText })); const preview = await previewResponse.json();
    const response = await POST(request({ operation: "confirm", previewToken: preview.previewToken, acknowledged: true, confirmationText: "IMPORT" }));
    expect(response.status).toBe(200); expect(rpc).toHaveBeenCalledWith("import_reservation_inventory_bulk", expect.objectContaining({ p_owner_id: "owner-1", p_plan_digest: expect.any(String), p_rows: [expect.objectContaining({ propertyId: "Pine Park", unitLabel: "Site 1", inventoryType: "rv_site", nightlyRateCents: 5500 })] }));
  });
  it("rejects a property/unit created after preview", async () => {
    const previewResponse = await POST(request({ operation: "preview", csvText })); const preview = await previewResponse.json();
    rpc.mockResolvedValueOnce({ data: null, error: { message: "A property/unit in this import already exists." } });
    const response = await POST(request({ operation: "confirm", previewToken: preview.previewToken, acknowledged: true, confirmationText: "IMPORT" }));
    expect(response.status).toBe(409); expect(rpc).toHaveBeenCalledOnce();
  });
});
