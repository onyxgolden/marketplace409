import { beforeEach, describe, expect, it, vi } from "vitest";
const load = vi.fn();
const rpc = vi.fn();
vi.mock("@/infrastructure/billing/StripeBillingProvider", () => ({
  createStripeBillingProvider: vi.fn(() => ({ mode: "test" })),
}));
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
  it("records explicit autopay consent without activating provider billing",async()=>{rpc.mockResolvedValue({data:{id:"autopay_1",status:"setup_required"},error:null});const response=await POST(new Request("https://example.test/api/rental/portal",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({operation:"request-autopay",leaseId:"lease_1",paymentMethodType:"us_bank_account",chargeDay:1,reminderDaysBefore:3,consentConfirmed:true})}));expect(response.status).toBe(200);expect(rpc).toHaveBeenCalledWith("request_rental_autopay_enrollment",expect.objectContaining({p_lease_id:"lease_1",p_payment_method_type:"us_bank_account",p_charge_day:1,p_provider_mode:"test"}));});
  it("lets the tenant cancel a current autopay enrollment",async()=>{rpc.mockResolvedValue({data:{id:"autopay_1",status:"cancelled"},error:null});const response=await POST(new Request("https://example.test/api/rental/portal",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({operation:"cancel-autopay",enrollmentId:"autopay_1"})}));expect(response.status).toBe(200);expect(rpc).toHaveBeenCalledWith("cancel_rental_autopay_enrollment",expect.objectContaining({p_enrollment_id:"autopay_1"}));});
  it("submits an assistance-animal request for human review",async()=>{rpc.mockResolvedValue({data:{id:"animal_1",classification:"assistance_review_requested"},error:null});const response=await POST(new Request("https://example.test/api/rental/portal",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({operation:"request-animal",leaseId:"lease_1",name:"Buddy",breedDescription:"Mixed breed",requestType:"assistance_review_requested"})}));expect(response.status).toBe(200);expect(rpc).toHaveBeenCalledWith("request_rental_animal",expect.objectContaining({p_request_type:"assistance_review_requested"}));});

  describe("sign-lease", () => {
    it("signs the approved lease preparation version, capturing IP and user-agent from the request itself, not the client body", async () => {
      rpc.mockResolvedValue({ data: { signatureId: "sig_1", fullyExecuted: false }, error: null });
      const response = await POST(new Request("https://example.test/api/rental/portal", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.5, 10.0.0.1", "user-agent": "test-agent/1.0" },
        body: JSON.stringify({ operation: "sign-lease", leaseId: "lease_1", preparationId: "prep_1", versionNumber: 1, signerName: "Jane Tenant" }),
      }));
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body).toEqual({ success: true, signature: { signatureId: "sig_1", fullyExecuted: false } });
      expect(rpc).toHaveBeenCalledWith("sign_rental_lease_preparation_version", {
        p_lease_id: "lease_1", p_preparation_id: "prep_1", p_version_number: 1,
        p_signer_name: "Jane Tenant", p_ip_address: "203.0.113.5", p_user_agent: "test-agent/1.0",
      });
    });

    it("takes only the first address from a multi-hop x-forwarded-for chain", async () => {
      rpc.mockResolvedValue({ data: { signatureId: "sig_1" }, error: null });
      await POST(new Request("https://example.test/api/rental/portal", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": " 198.51.100.7 , 10.0.0.1, 10.0.0.2" },
        body: JSON.stringify({ operation: "sign-lease", leaseId: "lease_1", preparationId: "prep_1", versionNumber: 1, signerName: "Jane Tenant" }),
      }));
      expect(rpc).toHaveBeenCalledWith("sign_rental_lease_preparation_version", expect.objectContaining({ p_ip_address: "198.51.100.7" }));
    });

    it("falls back to x-real-ip when x-forwarded-for is absent", async () => {
      rpc.mockResolvedValue({ data: { signatureId: "sig_1" }, error: null });
      await POST(new Request("https://example.test/api/rental/portal", {
        method: "POST",
        headers: { "content-type": "application/json", "x-real-ip": "192.0.2.9" },
        body: JSON.stringify({ operation: "sign-lease", leaseId: "lease_1", preparationId: "prep_1", versionNumber: 1, signerName: "Jane Tenant" }),
      }));
      expect(rpc).toHaveBeenCalledWith("sign_rental_lease_preparation_version", expect.objectContaining({ p_ip_address: "192.0.2.9" }));
    });

    it("rejects a signing request missing any required field before calling the database", async () => {
      const response = await POST(new Request("https://example.test/api/rental/portal", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "sign-lease", leaseId: "lease_1", preparationId: "prep_1", versionNumber: 1, signerName: "  " }),
      }));
      expect(response.status).toBe(400);
      expect(rpc).not.toHaveBeenCalled();
    });

    it("rejects a non-integer versionNumber before calling the database", async () => {
      const response = await POST(new Request("https://example.test/api/rental/portal", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "sign-lease", leaseId: "lease_1", preparationId: "prep_1", versionNumber: "1", signerName: "Jane Tenant" }),
      }));
      expect(response.status).toBe(400);
      expect(rpc).not.toHaveBeenCalled();
    });

    it("surfaces the RPC's rejection (e.g. signing a non-approved version) as the response error", async () => {
      // A real Supabase rpc() error is a PostgrestError, which extends Error -- matching that shape
      // here so this test exercises the same `error instanceof Error` branch production hits.
      rpc.mockResolvedValue({ data: null, error: new Error("Only the currently approved lease version can be signed.") });
      const response = await POST(new Request("https://example.test/api/rental/portal", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "sign-lease", leaseId: "lease_1", preparationId: "prep_1", versionNumber: 2, signerName: "Jane Tenant" }),
      }));
      const body = await response.json();
      expect(response.status).toBe(500);
      expect(body.error).toBe("Only the currently approved lease version can be signed.");
    });
  });
});
