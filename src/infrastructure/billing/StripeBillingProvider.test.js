import { describe, expect, it, vi } from "vitest";
import { StripeBillingProvider } from "./StripeBillingProvider.js";

function setup() {
  const stripeClient = {
    v2: {
      core: {
        accounts: { create: vi.fn(async () => ({ id: "acct_kent" })), retrieve: vi.fn() },
        accountLinks: { create: vi.fn(async () => ({ url: "https://connect.stripe.com/setup/e/acct_kent/onboarding" })) },
      },
    },
    parseEventNotificationAsync: vi.fn(),
    customers: { create: vi.fn(async () => ({ id: "cus_tenant" })) },
    charges: { retrieve: vi.fn(async () => ({
      id: "ch_rent", payment_intent: "pi_rent", balance_transaction: "txn_rent",
    })) },
    balanceTransactions: { retrieve: vi.fn(async () => ({
      id: "txn_rent", amount: 2000, fee: 0, net: 2000,
      currency: "usd", status: "pending", available_on: 1787798400,
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
  it("creates a V2 Core account on the Express dashboard with Stripe holding fees and loss liability", async () => {
    const { provider, stripeClient } = setup();
    const result = await provider.createConnectedAccount("owner_1", "account-key", { contactEmail: "owner@example.com" });
    expect(stripeClient.v2.core.accounts.create).toHaveBeenCalledWith({
      dashboard: "express",
      identity: { country: "US" },
      defaults: { responsibilities: { fees_collector: "stripe", losses_collector: "stripe" } },
      configuration: { merchant: { capabilities: {
        card_payments: { requested: true },
        ach_debit_payments: { requested: true },
      } } },
      metadata: { forge_owner_id: "owner_1" },
      contact_email: "owner@example.com",
    }, { idempotencyKey: "account-key" });
    expect(result).toEqual({ connectedAccountId: "acct_kent" });
  });

  it("never passes a legacy top-level account type", async () => {
    const { provider, stripeClient } = setup();
    await provider.createConnectedAccount("owner_1", "account-key");
    const [params] = stripeClient.v2.core.accounts.create.mock.calls[0];
    expect(params).not.toHaveProperty("type");
    expect(params).not.toHaveProperty("controller");
  });

  it("omits contact_email entirely when none is supplied, rather than sending an empty value", async () => {
    const { provider, stripeClient } = setup();
    await provider.createConnectedAccount("owner_1", "account-key");
    const [params] = stripeClient.v2.core.accounts.create.mock.calls[0];
    expect(params).not.toHaveProperty("contact_email");
  });

  it("stays idempotent — the same idempotency key is forwarded so retries cannot create a duplicate Stripe account", async () => {
    const { provider, stripeClient } = setup();
    await provider.createConnectedAccount("owner_1", "retry-key");
    await provider.createConnectedAccount("owner_1", "retry-key");
    expect(stripeClient.v2.core.accounts.create).toHaveBeenNthCalledWith(1, expect.anything(), { idempotencyKey: "retry-key" });
    expect(stripeClient.v2.core.accounts.create).toHaveBeenNthCalledWith(2, expect.anything(), { idempotencyKey: "retry-key" });
  });

  it("creates a V2 hosted onboarding account link with fixed FORGE return/refresh URLs", async () => {
    const { provider, stripeClient } = setup();
    const result = await provider.createOnboardingLink(
      { connectedAccountId: "acct_kent" },
      "https://forge.test/forge/rental?stripe=returned",
      "https://forge.test/forge/rental?stripe=refresh",
    );
    expect(stripeClient.v2.core.accountLinks.create).toHaveBeenCalledWith({
      account: "acct_kent",
      use_case: {
        type: "account_onboarding",
        account_onboarding: {
          configurations: ["merchant"],
          return_url: "https://forge.test/forge/rental?stripe=returned",
          refresh_url: "https://forge.test/forge/rental?stripe=refresh",
        },
      },
    });
    expect(result).toEqual({ url: "https://connect.stripe.com/setup/e/acct_kent/onboarding" });
  });

  describe("retrieveAccountStatus (V2 status mapping)", () => {
    function retrieveWith(account) {
      const { provider, stripeClient } = setup();
      stripeClient.v2.core.accounts.retrieve.mockResolvedValue(account);
      return { provider, stripeClient };
    }
    function account(overrides = {}) {
      return {
        id: "acct_kent", closed: false,
        configuration: { merchant: { capabilities: {
          card_payments: { status: "active" }, ach_debit_payments: { status: "active" },
          stripe_balance: { payouts: { status: "active" } },
        } } },
        requirements: { entries: [] },
        ...overrides,
      };
    }

    it("requests configuration.merchant and requirements via include", async () => {
      const { provider, stripeClient } = retrieveWith(account());
      await provider.retrieveAccountStatus({ connectedAccountId: "acct_kent" });
      expect(stripeClient.v2.core.accounts.retrieve).toHaveBeenCalledWith("acct_kent", { include: ["configuration.merchant", "requirements"] });
    });

    it("maps a fully active account to ready/enabled signals", async () => {
      const { provider } = retrieveWith(account());
      const result = await provider.retrieveAccountStatus({ connectedAccountId: "acct_kent" });
      expect(result).toMatchObject({ chargesEnabled: true, payoutsEnabled: true, achDebitEnabled: true, cardPaymentsEnabled: true, requirementsPastDue: false });
    });

    it("maps a brand-new account (pending capability, no requirements yet) to onboarding-not-started", async () => {
      const { provider } = retrieveWith(account({
        configuration: { merchant: { capabilities: { card_payments: { status: "pending" } } } },
        requirements: { entries: [] },
      }));
      const result = await provider.retrieveAccountStatus({ connectedAccountId: "acct_kent" });
      expect(result).toMatchObject({ chargesEnabled: false, payoutsEnabled: false, onboardingStarted: false });
    });

    it("distinguishes requirements currently due from requirements past due", async () => {
      const { provider } = retrieveWith(account({
        configuration: { merchant: { capabilities: { card_payments: { status: "pending" } } } },
        requirements: { entries: [{ description: "individual.dob.day", minimum_deadline: { status: "currently_due" } }] },
      }));
      const currentlyDue = await provider.retrieveAccountStatus({ connectedAccountId: "acct_kent" });
      expect(currentlyDue.requirementsDue).toEqual([{ description: "individual.dob.day", dueBy: "currently_due" }]);
      expect(currentlyDue.requirementsPastDue).toBe(false);

      const { provider: pastDueProvider } = retrieveWith(account({
        configuration: { merchant: { capabilities: { card_payments: { status: "pending" } } } },
        requirements: { entries: [{ description: "individual.dob.day", minimum_deadline: { status: "past_due" } }] },
      }));
      const pastDue = await pastDueProvider.retrieveAccountStatus({ connectedAccountId: "acct_kent" });
      expect(pastDue.requirementsPastDue).toBe(true);
    });

    it("reports charges unavailable independently of payouts unavailable", async () => {
      const { provider } = retrieveWith(account({
        configuration: { merchant: { capabilities: {
          card_payments: { status: "restricted" }, stripe_balance: { payouts: { status: "pending" } },
        } } },
      }));
      const result = await provider.retrieveAccountStatus({ connectedAccountId: "acct_kent" });
      expect(result).toMatchObject({ chargesEnabled: false, payoutsEnabled: false });
    });

    it("reports a closed account truthfully, even if capabilities still look active", async () => {
      const { provider } = retrieveWith(account({ closed: true }));
      const result = await provider.retrieveAccountStatus({ connectedAccountId: "acct_kent" });
      expect(result.accountClosed).toBe(true);
    });

    it("never claims an account is ready merely because it has an id — a missing configuration reports everything unavailable", async () => {
      const { provider } = retrieveWith({ id: "acct_kent", closed: false });
      const result = await provider.retrieveAccountStatus({ connectedAccountId: "acct_kent" });
      expect(result).toMatchObject({ chargesEnabled: false, payoutsEnabled: false, onboardingStarted: false });
    });

    // A live V2 retrieve of the preserved sandbox account (verified manually, sanitized result
    // only) returned capabilities and requirements.entries[] as expected, but no requirements.summary
    // at all — Stripe omits it when there's nothing to summarize. This code must never have depended
    // on requirements.summary; these tests prove and guard that contract.
    it("ignores requirements.summary content entirely — even a summary claiming past_due has no effect when entries is empty", async () => {
      const { provider } = retrieveWith(account({
        requirements: { summary: { minimum_deadline: { status: "past_due" } }, entries: [] },
      }));
      const result = await provider.retrieveAccountStatus({ connectedAccountId: "acct_kent" });
      expect(result).toMatchObject({ requirementsDue: [], requirementsPastDue: false });
    });

    it("treats a completely absent requirements.summary as a valid state, not an error and not restricted — capability status alone still governs readiness", async () => {
      const { provider } = retrieveWith(account({ requirements: { entries: [] } }));
      const result = await provider.retrieveAccountStatus({ connectedAccountId: "acct_kent" });
      expect(result).toMatchObject({ chargesEnabled: true, payoutsEnabled: true, requirementsDue: [], requirementsPastDue: false });
    });

    it("treats a requirements object that is entirely missing (not just empty entries) the same as no requirements due — capability signals stay independent", async () => {
      const { provider } = retrieveWith(account({ requirements: undefined }));
      const result = await provider.retrieveAccountStatus({ connectedAccountId: "acct_kent" });
      expect(result).toMatchObject({ chargesEnabled: true, requirementsDue: [], requirementsPastDue: false });
    });

    it("derives requirementsPastDue from the most severe entry when multiple requirement entries are present", async () => {
      const { provider } = retrieveWith(account({
        configuration: { merchant: { capabilities: { card_payments: { status: "pending" } } } },
        requirements: { entries: [
          { description: "individual.dob.day", minimum_deadline: { status: "currently_due" } },
          { description: "individual.verification.document", minimum_deadline: { status: "past_due" } },
        ] },
      }));
      const result = await provider.retrieveAccountStatus({ connectedAccountId: "acct_kent" });
      expect(result.requirementsDue).toHaveLength(2);
      expect(result.requirementsPastDue).toBe(true);
    });
  });

  describe("parseAccountWebhookNotification (V2 thin events)", () => {
    it("verifies the signature and retrieves the full V2 event before returning", async () => {
      const { provider, stripeClient } = setup();
      const fetchEvent = vi.fn(async () => ({ id: "evt_1", type: "v2.core.account[requirements].updated" }));
      const notification = { id: "evt_1", type: "v2.core.account[requirements].updated", related_object: { id: "acct_kent" }, fetchEvent };
      stripeClient.parseEventNotificationAsync.mockResolvedValue(notification);
      const result = await provider.parseAccountWebhookNotification("raw-body", "sig", "whsec_account");
      expect(stripeClient.parseEventNotificationAsync).toHaveBeenCalledWith("raw-body", "sig", "whsec_account");
      expect(fetchEvent).toHaveBeenCalledTimes(1);
      expect(result).toBe(notification);
    });

    it("propagates a signature-verification failure rather than returning a notification", async () => {
      const { provider, stripeClient } = setup();
      stripeClient.parseEventNotificationAsync.mockRejectedValue(new Error("No signatures found matching the expected signature for payload"));
      await expect(provider.parseAccountWebhookNotification("raw-body", "bad-sig", "whsec_account")).rejects.toThrow(/signature/i);
    });
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

  it("passes the connected account as request options when retrieving a balance transaction", async () => {
    const { provider, stripeClient } = setup();
    const result = await provider.retrieveBalanceTransaction(
      { connectedAccountId: "acct_kent" }, "txn_rent",
    );
    expect(stripeClient.balanceTransactions.retrieve).toHaveBeenCalledWith(
      "txn_rent", {}, { stripeAccount: "acct_kent" },
    );
    expect(result).toMatchObject({
      id: "txn_rent",
      grossAmountCents: 2000,
      feeAmountCents: 0,
      netAmountCents: 2000,
      currencyCode: "USD",
      status: "pending",
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

describe("createStripeBillingProvider (mode resolution)", () => {
  it("resolves and attaches the server-declared mode, never inferring it from a key or object id", async () => {
    const { createStripeBillingProvider } = await import("./StripeBillingProvider.js");
    const provider = createStripeBillingProvider({ STRIPE_MODE: "test", STRIPE_SECRET_KEY: "sk_test_abc123" });
    expect(provider.mode).toBe("test");
  });

  it("fails closed rather than constructing a provider when STRIPE_MODE/key configuration is invalid", async () => {
    const { createStripeBillingProvider } = await import("./StripeBillingProvider.js");
    expect(() => createStripeBillingProvider({ STRIPE_MODE: "live", STRIPE_SECRET_KEY: "sk_test_abc123" })).toThrow(/does not start with/);
    expect(() => createStripeBillingProvider({ STRIPE_SECRET_KEY: "sk_test_abc123" })).toThrow(/STRIPE_MODE/);
  });
});
