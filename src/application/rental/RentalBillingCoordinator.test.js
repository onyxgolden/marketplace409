import { describe, expect, it, vi } from "vitest";
import { RentalBillingCoordinator } from "./RentalBillingCoordinator.js";
function setup(account = { providerAccountId: "acct_1", status: "enabled", chargesEnabled: true, payoutsEnabled: true }) {
  const provider = { provider: "stripe", createCustomer: vi.fn(async () => ({ provider: "stripe", connectedAccountId: "acct_1", customerId: "cus_1" })),
    createPaymentSession: vi.fn(async () => ({ provider: "stripe", connectedAccountId: "acct_1", paymentIntentId: "pi_1", paymentId: "payment_1", clientSecret: "pi_1_secret" })) };
  const landlordAccountRepository = { findByOwnerId: vi.fn(async () => account) };
  const customerReferenceRepository = { findByTenant: vi.fn(async () => null), save: vi.fn(async (value) => value) };
  return { provider, landlordAccountRepository, customerReferenceRepository,
    coordinator: new RentalBillingCoordinator({ provider, landlordAccountRepository, customerReferenceRepository }) };
}
const input = { ownerId: "owner_1", tenant: { id: "tenant_1", email: "tenant@example.com", displayName: "Tenant" },
  charge: { id: "charge_1", leaseId: "lease_1" }, payment: { id: "payment_1", amountCents: 125000,
    currencyCode: "USD", idempotencyKey: "payment:charge_1:attempt_1" }, successUrl: "https://forge.test/success",
  cancelUrl: "https://forge.test/cancel" };
describe("RentalBillingCoordinator", () => {
  it("creates connected-account customer and checkout with stable idempotency", async () => {
    const { coordinator, provider, customerReferenceRepository } = setup();
    const result = await coordinator.createTenantCheckout(input);
    expect(provider.createCustomer).toHaveBeenCalledWith(expect.objectContaining({ connectedAccountId: "acct_1" }),
      expect.objectContaining({ tenantId: "tenant_1" }), "billing-customer:owner_1:tenant_1:stripe");
    expect(customerReferenceRepository.save).toHaveBeenCalled();
    expect(provider.createPaymentSession).toHaveBeenCalledWith(expect.objectContaining({ connectedAccountId: "acct_1" }),
      expect.objectContaining({ chargeId: "charge_1", idempotencyKey: "payment:charge_1:attempt_1" }));
    expect(result.clientSecret).toContain("secret");
  });
  it("refuses collection before charges and payouts are enabled", async () => {
    const { coordinator } = setup({ providerAccountId: "acct_1", status: "restricted", chargesEnabled: false, payoutsEnabled: false });
    await expect(coordinator.createTenantCheckout(input)).rejects.toThrow("not ready to collect rent");
  });
});
