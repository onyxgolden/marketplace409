import { beforeEach, describe, expect, it, vi } from "vitest";
const rpc = vi.fn();
vi.mock("@/infrastructure/billing/StripeBillingProvider", () => ({
  createStripeBillingProvider: vi.fn(() => ({ mode: "test" })),
}));
vi.mock("@/lib/supabase/createAuthenticatedTenantPortalApplication", () => ({
  createAuthenticatedTenantPortalApplication: vi.fn(async () => ({ user: { id: "auth_tenant_1" },
    supabaseClient: { rpc }, application: {} })),
}));
vi.mock("@/lib/supabase/createRentalWebhookClient", () => ({
  createRentalWebhookClient: vi.fn(),
}));
import { POST } from "./route.js";
import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";

// Fake service-role database: the fee gate looks up the lease's owner, then
// the workspace fee rate.
function fakeDatabase(ownerBps) {
  return {
    from(table) {
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        limit() { return chain; },
        async maybeSingle() {
          if (table === "rental_lease_tenants") return { data: { owner_id: "owner_1" }, error: null };
          if (table === "rental_billing_settings") return { data: { card_convenience_fee_bps: ownerBps }, error: null };
          return { data: null, error: null };
        },
      };
      return chain;
    },
  };
}

function post(body) {
  return POST(new Request("https://example.test/api/rental/portal", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
}

const base = { operation: "request-autopay", leaseId: "lease_1", chargeDay: 1,
  reminderDaysBefore: 3, consentConfirmed: true };

describe("request-autopay convenience-fee consent (R12)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockResolvedValue({ data: { id: "autopay_1", status: "setup_required" }, error: null });
  });
  it("rejects card autopay without explicit fee consent when the fee is enabled (422)", async () => {
    createRentalWebhookClient.mockReturnValue(fakeDatabase(295));
    const response = await post({ ...base, paymentMethodType: "card", feeConsentBps: 295 });
    expect(response.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("stores the consented fee rate when card consent matches the workspace rate", async () => {
    createRentalWebhookClient.mockReturnValue(fakeDatabase(295));
    const response = await post({ ...base, paymentMethodType: "card", feeConsentConfirmed: true, feeConsentBps: 295 });
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("request_rental_autopay_enrollment",
      expect.objectContaining({ p_fee_consent_bps: 295 }));
  });
  it("rejects a stale consented rate when the owner changed the fee mid-review (409)", async () => {
    createRentalWebhookClient.mockReturnValue(fakeDatabase(300));
    const response = await post({ ...base, paymentMethodType: "card", feeConsentConfirmed: true, feeConsentBps: 295 });
    expect(response.status).toBe(409);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("passes null fee consent for card when the fee is disabled", async () => {
    createRentalWebhookClient.mockReturnValue(fakeDatabase(0));
    const response = await post({ ...base, paymentMethodType: "card", feeConsentConfirmed: false });
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("request_rental_autopay_enrollment",
      expect.objectContaining({ p_fee_consent_bps: null }));
  });
  it("never attaches a fee to bank-account autopay even when the fee is enabled", async () => {
    createRentalWebhookClient.mockReturnValue(fakeDatabase(295));
    const response = await post({ ...base, paymentMethodType: "us_bank_account" });
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("request_rental_autopay_enrollment",
      expect.objectContaining({ p_payment_method_type: "us_bank_account", p_fee_consent_bps: null }));
  });
});
