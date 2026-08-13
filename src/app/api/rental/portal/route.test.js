import { beforeEach, describe, expect, it, vi } from "vitest";
const load = vi.fn();
const rpc = vi.fn();
vi.mock("@/lib/supabase/createAuthenticatedTenantPortalApplication", () => ({
  createAuthenticatedTenantPortalApplication: vi.fn(async () => ({ user: { id: "auth_tenant_1" },
    supabaseClient: { rpc }, application: { load } })),
}));
import { GET, POST } from "./route.js";
describe("tenant portal route", () => {
  beforeEach(() => vi.clearAllMocks());
  it("claims a matching confirmed invitation before reloading portal access", async () => {
    load.mockResolvedValueOnce(null).mockResolvedValueOnce({ tenant: { id: "tenant_1" }, rentals: [] });
    rpc.mockResolvedValue({ data: { tenantId: "tenant_1", status: "active" }, error: null });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("claim_rental_tenant_portal");
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("does not claim again when portal access is already linked", async () => {
    load.mockResolvedValue({ tenant: { id: "tenant_1" }, rentals: [] });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("submits an owner-scoped maintenance request through the tenant rpc", async () => {
    rpc.mockResolvedValue({ data: { id: "request_1", status: "submitted" }, error: null });
    const response = await POST(new Request("https://example.test/api/rental/portal", { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "submit-maintenance-request",
        leaseId: "lease_1", title: "Leaking sink", description: "Water is collecting under the cabinet.",
        priority: "soon", permissionToEnter: true, contactPhone: "555-0100" }) }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("submit_rental_maintenance_request", {
      p_lease_id: "lease_1", p_title: "Leaking sink", p_description: "Water is collecting under the cabinet.",
      p_priority: "soon", p_permission_to_enter: true, p_contact_phone: "555-0100",
    });
  });
  it("rejects an incomplete maintenance request before calling the database", async () => {
    const response = await POST(new Request("https://example.test/api/rental/portal", { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "submit-maintenance-request", leaseId: "lease_1" }) }));
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("acknowledges only a specified finalized inspection through the tenant rpc",async()=>{rpc.mockResolvedValue({data:{inspection_id:"inspection_1",acknowledged:true},error:null});const response=await POST(new Request("https://example.test/api/rental/portal",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({operation:"acknowledge-inspection",inspectionId:"inspection_1"})}));expect(response.status).toBe(200);expect(rpc).toHaveBeenCalledWith("acknowledge_rental_inspection",{p_inspection_id:"inspection_1"});});
  it("records explicit autopay consent without activating provider billing",async()=>{rpc.mockResolvedValue({data:{id:"autopay_1",status:"setup_required"},error:null});const response=await POST(new Request("https://example.test/api/rental/portal",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({operation:"request-autopay",leaseId:"lease_1",paymentMethodType:"us_bank_account",chargeDay:1,reminderDaysBefore:3,consentConfirmed:true})}));expect(response.status).toBe(200);expect(rpc).toHaveBeenCalledWith("request_rental_autopay_enrollment",expect.objectContaining({p_lease_id:"lease_1",p_payment_method_type:"us_bank_account",p_charge_day:1}));});
  it("lets the tenant cancel a current autopay enrollment",async()=>{rpc.mockResolvedValue({data:{id:"autopay_1",status:"cancelled"},error:null});const response=await POST(new Request("https://example.test/api/rental/portal",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({operation:"cancel-autopay",enrollmentId:"autopay_1"})}));expect(response.status).toBe(200);expect(rpc).toHaveBeenCalledWith("cancel_rental_autopay_enrollment",expect.objectContaining({p_enrollment_id:"autopay_1"}));});
  it("submits an assistance-animal request for human review",async()=>{rpc.mockResolvedValue({data:{id:"animal_1",classification:"assistance_review_requested"},error:null});const response=await POST(new Request("https://example.test/api/rental/portal",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({operation:"request-animal",leaseId:"lease_1",name:"Buddy",breedDescription:"Mixed breed",requestType:"assistance_review_requested"})}));expect(response.status).toBe(200);expect(rpc).toHaveBeenCalledWith("request_rental_animal",expect.objectContaining({p_request_type:"assistance_review_requested"}));});
});
