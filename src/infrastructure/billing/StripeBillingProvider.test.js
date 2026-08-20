import { describe, expect, it, vi } from "vitest";
import { StripeBillingProvider } from "./StripeBillingProvider.js";

function setup() {
  const stripeClient = {
    accounts: { create: vi.fn(async () => ({ id: "acct_kent" })), retrieve: vi.fn() },
    accountLinks: { create: vi.fn() },
    customers: { create: vi.fn(async () => ({ id: "cus_tenant" })) },
    charges: { retrieve: vi.fn(async () => ({
      id: "ch_rent", payment_intent: "pi_rent", balance_transaction: "txn_rent",
    })) },
    paymentIntents: { create: vi.fn(async () => ({ id: "pi_rent", client_secret: "pi_rent_secret_test",status:"succeeded" })),
      retrieve: vi.fn(async () => ({
        id: "pi_rent", client_secret: "pi_rent_secret_test", status: "requires_payment_method",
        latest_charge: { id: "ch_rent", balance_transaction: "txn_rent" },
      })) },
    webhooks: { constructEvent: vi.fn(() => ({ id: "evt_1" })) },
  };
  return { stripeClient, provider: new StripeBillingProvider({ stripeClient }) };
}

describe("StripeBillingProvider", () => {
  it("creates an Express account with application-controlled payment losses", async () => {
    const { provider, stripeClient } = setup();
    await provider.createConnectedAccount("owner_1", "account-key");
    expect(stripeClient.accounts.create).toHaveBeenCalledWith(expect.objectContaining({
      controller: {
        stripe_dashboard: { type: "express" },
        requirement_collection: "stripe",
        losses: { payments: "application" },
        fees: { payer: "application" },
      },
    }), { idempotencyKey: "account-key" });
  });

  it("creates the tenant customer inside the landlord connected account", async () => {
    const { provider, stripeClient } = setup();
    await provider.createCustomer({ ownerId: "owner_1", connectedAccountId: "acct_kent" },
      { tenantId: "tenant_1", email: "tenant@example.com", displayName: "Kent Tenant" }, "customer-key");
    expect(stripeClient.customers.create).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ forge_tenant_id: "tenant_1" }) }),
      { stripeAccount: "acct_kent", idempotencyKey: "customer-key" });
  });

  it("creates an ACH-capable direct-charge PaymentIntent for Payment Element", async () => {
    const { provider, stripeClient } = setup();
    const result = await provider.createPaymentSession({ ownerId: "owner_1", connectedAccountId: "acct_kent" }, {
      paymentId: "payment_1", chargeId: "charge_1", leaseId: "lease_1", tenantId: "tenant_1",
      customerId: "cus_tenant", amountCents: 125000, currencyCode: "USD", paymentMethods: ["us_bank_account", "card"],
      successUrl: "https://forge.test/success", cancelUrl: "https://forge.test/cancel", applicationFeeCents: 1000,
      idempotencyKey: "rent:charge_1:attempt_1",
    });
    expect(stripeClient.paymentIntents.create).toHaveBeenCalledWith(expect.objectContaining({
      amount: 125000, customer: "cus_tenant", setup_future_usage: "off_session", application_fee_amount: 1000,
      payment_method_types: ["us_bank_account", "card"],
      payment_method_options: { us_bank_account: { verification_method: "instant", financial_connections: { permissions: ["payment_method"] } } },
    }), { stripeAccount: "acct_kent", idempotencyKey: "rent:charge_1:attempt_1" });
    expect(result).toMatchObject({ connectedAccountId: "acct_kent", paymentIntentId: "pi_rent", clientSecret: "pi_rent_secret_test" });
  });

  it("verifies webhook signatures with the unparsed body", () => {
    const { provider, stripeClient } = setup();
    provider.constructWebhookEvent("raw-body", "signature", "whsec_test");
    expect(stripeClient.webhooks.constructEvent).toHaveBeenCalledWith("raw-body", "signature", "whsec_test");
  });
  it("creates an idempotent confirmed off-session payment",async()=>{const{provider,stripeClient}=setup();await provider.createOffSessionPayment({connectedAccountId:"acct_kent"},{paymentId:"pay_1",chargeId:"charge_1",enrollmentId:"auto_1",customerId:"cus_tenant",paymentMethodId:"pm_1",amountCents:125000,currencyCode:"USD"},"autopay:auto_1:charge_1");expect(stripeClient.paymentIntents.create).toHaveBeenCalledWith(expect.objectContaining({off_session:true,confirm:true,payment_method:"pm_1"}),{stripeAccount:"acct_kent",idempotencyKey:"autopay:auto_1:charge_1"});});

  it("retrieves current settlement identifiers from a successful PaymentIntent", async () => {
    const { provider, stripeClient } = setup();
    const result = await provider.retrievePaymentIntentSettlement(
      { connectedAccountId: "acct_kent" }, "pi_rent",
    );
    expect(stripeClient.paymentIntents.retrieve).toHaveBeenCalledWith(
      "pi_rent", { expand: ["latest_charge"] }, { stripeAccount: "acct_kent" },
    );
    expect(result).toEqual({
      paymentIntentId: "pi_rent", chargeId: "ch_rent", balanceTransactionId: "txn_rent",
    });
  });

  it("retrieves the current Charge to recover an asynchronously attached balance transaction", async () => {
    const { provider, stripeClient } = setup();
    const result = await provider.retrieveCharge({ connectedAccountId: "acct_kent" }, "ch_rent");
    expect(stripeClient.charges.retrieve).toHaveBeenCalledWith(
      "ch_rent", {}, { stripeAccount: "acct_kent" },
    );
    expect(result).toEqual({
      id: "ch_rent", paymentIntentId: "pi_rent", balanceTransactionId: "txn_rent",
    });
  });

  it("retrieves an existing PaymentIntent for resume without ever calling create", async () => {
    const { provider, stripeClient } = setup();
    const result = await provider.retrievePaymentIntent({ connectedAccountId: "acct_kent" }, "pi_existing");
    expect(stripeClient.paymentIntents.retrieve).toHaveBeenCalledWith("pi_existing", {}, { stripeAccount: "acct_kent" });
    expect(stripeClient.paymentIntents.create).not.toHaveBeenCalled();
    expect(result).toEqual({ id: "pi_rent", clientSecret: "pi_rent_secret_test", status: "requires_payment_method" });
  });
});
