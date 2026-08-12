import Stripe from "stripe";
import { validateBillingCheckoutInput } from "@/domains/billing-provider";

function required(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`Stripe billing requires ${name}.`);
  return value.trim();
}

export class StripeBillingProvider {
  constructor({ secretKey, stripeClient } = {}) {
    this.provider = "stripe";
    this.stripe = stripeClient || new Stripe(required(secretKey, "a secret key"));
  }

  async createConnectedAccount(ownerId, idempotencyKey) {
    const account = await this.stripe.accounts.create({
      controller: {
        stripe_dashboard: { type: "express" },
        requirement_collection: "stripe",
        losses: { payments: "stripe" },
        fees: { payer: "application" },
      },
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
        us_bank_account_ach_payments: { requested: true },
      },
      metadata: { forge_owner_id: required(ownerId, "an owner id") },
    }, { idempotencyKey: required(idempotencyKey, "an idempotency key") });
    return Object.freeze({ connectedAccountId: account.id });
  }

  async createOnboardingLink(context, returnUrl, refreshUrl) {
    const link = await this.stripe.accountLinks.create({
      account: required(context.connectedAccountId, "a connected account id"),
      type: "account_onboarding",
      return_url: required(returnUrl, "an onboarding return URL"),
      refresh_url: required(refreshUrl, "an onboarding refresh URL"),
    });
    return Object.freeze({ url: link.url });
  }

  async retrieveAccountStatus(context) {
    const account = await this.stripe.accounts.retrieve(required(context.connectedAccountId, "a connected account id"));
    return Object.freeze({
      provider: this.provider,
      connectedAccountId: account.id,
      detailsSubmitted: account.details_submitted === true,
      chargesEnabled: account.charges_enabled === true,
      payoutsEnabled: account.payouts_enabled === true,
      achDebitEnabled: account.capabilities?.us_bank_account_ach_payments === "active",
      cardPaymentsEnabled: account.capabilities?.card_payments === "active",
      requirementsDue: Object.freeze([...(account.requirements?.currently_due || [])]),
    });
  }

  async createCustomer(context, input, idempotencyKey) {
    const customer = await this.stripe.customers.create({
      email: required(input.email, "a tenant email"),
      name: required(input.displayName, "a tenant display name"),
      metadata: { forge_owner_id: context.ownerId, forge_tenant_id: required(input.tenantId, "a tenant id") },
    }, { stripeAccount: required(context.connectedAccountId, "a connected account id"), idempotencyKey });
    return Object.freeze({ provider: this.provider, connectedAccountId: context.connectedAccountId, customerId: customer.id });
  }

  async createPaymentSession(context, rawInput) {
    const input = validateBillingCheckoutInput(rawInput);
    const intent = await this.stripe.paymentIntents.create({
      amount: input.amountCents,
      currency: input.currencyCode.toLowerCase(),
      customer: required(input.customerId, "a connected-account customer id"),
      payment_method_types: input.paymentMethods,
      setup_future_usage: "off_session",
      application_fee_amount: input.applicationFeeCents || undefined,
      payment_method_options: {
        us_bank_account: {
          verification_method: "instant",
          financial_connections: { permissions: ["payment_method"] },
        },
      },
      metadata: {
        forge_payment_id: input.paymentId,
        forge_charge_id: input.chargeId,
        forge_lease_id: input.leaseId,
        forge_tenant_id: input.tenantId,
        forge_owner_id: context.ownerId,
      },
    }, { stripeAccount: required(context.connectedAccountId, "a connected account id"), idempotencyKey: input.idempotencyKey });
    if (!intent.client_secret) throw new Error("Stripe did not return a PaymentIntent client secret.");
    return Object.freeze({ provider: this.provider, connectedAccountId: context.connectedAccountId,
      paymentIntentId: intent.id, paymentId: input.paymentId, clientSecret: intent.client_secret });
  }

  constructWebhookEvent(rawBody, signature, secret) {
    return this.stripe.webhooks.constructEvent(rawBody, required(signature, "a webhook signature"), required(secret, "a webhook secret"));
  }
}

export function createStripeBillingProvider(env = process.env) {
  return new StripeBillingProvider({ secretKey: required(env.STRIPE_SECRET_KEY, "STRIPE_SECRET_KEY") });
}
