import Stripe from "stripe";
import { validateBillingCheckoutInput } from "@/domains/billing-provider";
import { resolveStripeMode } from "./stripeMode";

function required(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`Stripe billing requires ${name}.`);
  return value.trim();
}

export class StripeBillingProvider {
  // `mode` ("test" | "live") is the single source of truth callers use to scope every
  // landlord_payment_accounts / billing_customer_references / rental_payments / rental_settlements
  // / autopay row they write or query — never inferred from a Stripe object id's own prefix.
  constructor({ secretKey, stripeClient, mode = null } = {}) {
    this.provider = "stripe";
    this.mode = mode;
    this.stripe = stripeClient || new Stripe(required(secretKey, "a secret key"));
  }

  // V2 Core Account. Fields verified directly against the installed stripe-node 22.5.0 type
  // definitions and https://docs.stripe.com/connect/accounts-v2/connected-account-configuration —
  // not copied from a generic sample. `dashboard: "express"` matches the Dashboard's confirmed
  // Express selection (the SDK's Dashboard type is 'express' | 'full' | 'none' — "full" would be
  // wrong here). `fees_collector`/`losses_collector` are both "stripe": for direct charges,
  // Stripe's own integration guidance recommends Stripe hold negative-balance liability, and
  // FORGE charges a $0 application fee today, so `fees_collector: "application"` would mean
  // FORGE gets billed for Stripe's processing fees with no way to recover them from the
  // landlord — "stripe" keeps both fees and losses off FORGE, matching the confirmed Dashboard
  // fact that Stripe manages risk/loss by default. `requirements_collector` is intentionally
  // omitted — Stripe computes it from the two responsibilities above and rejects it if set.
  async createConnectedAccount(ownerId, idempotencyKey, { contactEmail } = {}) {
    const params = {
      dashboard: "express",
      identity: { country: "US" }, // FORGE only operates in the US (Southeast Texas marketplace)
      defaults: { responsibilities: { fees_collector: "stripe", losses_collector: "stripe" } },
      configuration: {
        merchant: {
          capabilities: {
            card_payments: { requested: true },
            ach_debit_payments: { requested: true },
          },
        },
      },
      metadata: { forge_owner_id: required(ownerId, "an owner id") },
    };
    // display_name is intentionally left unset — Stripe's hosted onboarding collects the
    // landlord's real business name directly; FORGE never has independently-verified business
    // identity data of its own to supply here.
    if (contactEmail) params.contact_email = contactEmail;
    const account = await this.stripe.v2.core.accounts.create(params, { idempotencyKey: required(idempotencyKey, "an idempotency key") });
    return Object.freeze({ connectedAccountId: account.id });
  }

  async createOnboardingLink(context, returnUrl, refreshUrl) {
    const link = await this.stripe.v2.core.accountLinks.create({
      account: required(context.connectedAccountId, "a connected account id"),
      use_case: {
        type: "account_onboarding",
        account_onboarding: {
          configurations: ["merchant"],
          return_url: required(returnUrl, "an onboarding return URL"),
          refresh_url: required(refreshUrl, "an onboarding refresh URL"),
        },
      },
    });
    return Object.freeze({ url: link.url });
  }

  // `include` is required to get capability/requirement detail on a V2 retrieve — an
  // unqualified retrieve returns a near-empty account. Capability `status` values are
  // 'active' | 'pending' | 'restricted' | 'unsupported' (verified from the installed SDK types),
  // not V1's `charges_enabled`/`payouts_enabled` booleans, so those are derived here rather than
  // read directly. `stripe_balance.payouts` is Stripe-managed (not a capability FORGE requests)
  // and is the truthful payouts signal for a Merchant-configured account doing direct charges.
  async retrieveAccountStatus(context) {
    const account = await this.stripe.v2.core.accounts.retrieve(
      required(context.connectedAccountId, "a connected account id"),
      { include: ["configuration.merchant", "requirements"] },
    );
    const capabilities = account.configuration?.merchant?.capabilities || {};
    const cardStatus = capabilities.card_payments?.status;
    const achStatus = capabilities.ach_debit_payments?.status;
    const payoutsStatus = capabilities.stripe_balance?.payouts?.status;
    const requirementsDue = Object.freeze((account.requirements?.entries || []).map((entry) => Object.freeze({
      description: entry.description,
      dueBy: entry.minimum_deadline?.status || "eventually_due",
    })));
    return Object.freeze({
      provider: this.provider,
      mode: this.mode,
      connectedAccountId: account.id,
      accountClosed: account.closed === true,
      chargesEnabled: cardStatus === "active",
      payoutsEnabled: payoutsStatus === "active",
      achDebitEnabled: achStatus === "active",
      cardPaymentsEnabled: cardStatus === "active",
      // True once Stripe has anything to report about this account (a pending/active/restricted
      // capability, or any requirement entry) — false only for a brand-new account where
      // onboarding hasn't been touched yet. There is no V2 equivalent of V1's single
      // `details_submitted` boolean.
      onboardingStarted: requirementsDue.length > 0 || ["active", "restricted"].includes(cardStatus),
      requirementsDue,
      requirementsPastDue: requirementsDue.some((entry) => entry.dueBy === "past_due"),
    });
  }

  // Thin-event entry point for the V2 account webhook. `parseEventNotificationAsync` is the
  // current SDK method (not `parseThinEvent`, which does not exist in stripe-node 22.5.0) — it
  // verifies the signature from the raw body and returns a typed EventNotification. Per Stripe's
  // guidance for thin payloads, `fetchEvent()` retrieves the full V2 Event before any state is
  // applied — callers must await this method's result before acting on the notification.
  async parseAccountWebhookNotification(rawBody, signature, secret) {
    const notification = await this.stripe.parseEventNotificationAsync(
      rawBody, required(signature, "a webhook signature"), required(secret, "an account webhook secret"),
    );
    await notification.fetchEvent();
    return notification;
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

  async retrievePaymentIntent(context, id) {
    const intent = await this.stripe.paymentIntents.retrieve(required(id, "a payment intent id"), {},
      { stripeAccount: required(context.connectedAccountId, "a connected account id") });
    return Object.freeze({ id: intent.id, clientSecret: intent.client_secret, status: intent.status });
  }

  constructWebhookEvent(rawBody, signature, secret) {
    return this.stripe.webhooks.constructEvent(rawBody, required(signature, "a webhook signature"), required(secret, "a webhook secret"));
  }

  async retrievePaymentIntentSettlement(context, id) {
    const intent = await this.stripe.paymentIntents.retrieve(
      required(id, "a payment intent id"),
      { expand: ["latest_charge"] },
      { stripeAccount: required(context.connectedAccountId, "a connected account id") },
    );
    const charge = typeof intent.latest_charge === "object" ? intent.latest_charge : null;
    return Object.freeze({
      paymentIntentId: intent.id,
      chargeId: typeof intent.latest_charge === "string" ? intent.latest_charge : charge?.id || null,
      balanceTransactionId: typeof charge?.balance_transaction === "string"
        ? charge.balance_transaction
        : charge?.balance_transaction?.id || null,
    });
  }

  async retrieveCharge(context, id) {
    const charge = await this.stripe.charges.retrieve(
      required(id, "a charge id"),
      {},
      { stripeAccount: required(context.connectedAccountId, "a connected account id") },
    );
    return Object.freeze({
      id: charge.id,
      paymentIntentId: typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id || null,
      balanceTransactionId: typeof charge.balance_transaction === "string"
        ? charge.balance_transaction
        : charge.balance_transaction?.id || null,
    });
  }

  async retrieveBalanceTransaction(context,id){const value=await this.stripe.balanceTransactions.retrieve(required(id,"a balance transaction id"),{},{stripeAccount:required(context.connectedAccountId,"a connected account id")});return Object.freeze({id:value.id,grossAmountCents:value.amount,feeAmountCents:value.fee,netAmountCents:value.net,currencyCode:value.currency.toUpperCase(),status:value.status,availableAt:Number.isSafeInteger(value.available_on)?new Date(value.available_on*1000).toISOString():null});}
  async listPayoutBalanceTransactionIds(context,payoutId){const page=await this.stripe.balanceTransactions.list({payout:required(payoutId,"a payout id"),limit:100},{stripeAccount:required(context.connectedAccountId,"a connected account id")});return Object.freeze(page.data.map(item=>item.id));}
  async createOffSessionPayment(context,input,idempotencyKey){const intent=await this.stripe.paymentIntents.create({amount:input.amountCents,currency:input.currencyCode.toLowerCase(),customer:required(input.customerId,"a customer id"),payment_method:required(input.paymentMethodId,"a payment method id"),off_session:true,confirm:true,metadata:{forge_payment_id:input.paymentId,forge_charge_id:input.chargeId,forge_autopay_enrollment_id:input.enrollmentId}},{stripeAccount:required(context.connectedAccountId,"a connected account id"),idempotencyKey:required(idempotencyKey,"an idempotency key")});return Object.freeze({paymentIntentId:intent.id,status:intent.status});}
}

export function createStripeBillingProvider(env = process.env) {
  const { mode, secretKey } = resolveStripeMode(env);
  return new StripeBillingProvider({ secretKey, mode });
}
