import { validateBillingCheckoutInput } from "@/domains/billing-provider";

function required(value, message) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(message);
  return value.trim();
}

export class RentalBillingCoordinator {
  constructor({ provider, landlordAccountRepository, customerReferenceRepository }) {
    if (!provider) throw new Error("RentalBillingCoordinator requires a billing provider.");
    if (!landlordAccountRepository) throw new Error("RentalBillingCoordinator requires a landlord account repository.");
    if (!customerReferenceRepository) throw new Error("RentalBillingCoordinator requires a customer reference repository.");
    this.provider = provider;
    this.landlordAccounts = landlordAccountRepository;
    this.customers = customerReferenceRepository;
  }
  async createTenantCheckout({ ownerId, tenant, charge, payment, successUrl, cancelUrl, applicationFeeCents = 0 }) {
    const requiredOwnerId = required(ownerId, "Rental billing owner id is required.");
    const account = await this.landlordAccounts.findByOwnerId(requiredOwnerId);
    if (!account?.providerAccountId || account.status !== "enabled" || !account.chargesEnabled || !account.payoutsEnabled)
      throw new Error("Landlord payment account is not ready to collect rent.");
    let customer = await this.customers.findByTenant(tenant.id, requiredOwnerId, this.provider.provider);
    const context = Object.freeze({ ownerId: requiredOwnerId, connectedAccountId: account.providerAccountId });
    if (!customer) {
      customer = await this.provider.createCustomer(context, { tenantId: tenant.id, email: tenant.email,
        displayName: tenant.displayName }, `billing-customer:${requiredOwnerId}:${tenant.id}:${this.provider.provider}`);
      await this.customers.save({ ownerId: requiredOwnerId, tenantId: tenant.id, provider: this.provider.provider,
        connectedAccountId: account.providerAccountId, customerId: customer.customerId });
    }
    const checkout = validateBillingCheckoutInput({ paymentId: payment.id, chargeId: charge.id, leaseId: charge.leaseId,
      tenantId: tenant.id, customerId: customer.customerId, amountCents: payment.amountCents,
      currencyCode: payment.currencyCode, paymentMethods: ["us_bank_account", "card"], successUrl, cancelUrl,
      applicationFeeCents, idempotencyKey: payment.idempotencyKey });
    return this.provider.createPaymentSession(context, checkout);
  }
}
