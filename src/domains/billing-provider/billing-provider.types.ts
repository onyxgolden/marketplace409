export const BILLING_PAYMENT_METHODS = ["us_bank_account", "card"] as const;
export type BillingPaymentMethod = typeof BILLING_PAYMENT_METHODS[number];

export type BillingProviderContext = Readonly<{
  ownerId: string;
  connectedAccountId: string;
}>;
export type BillingCustomerInput = Readonly<{
  tenantId: string;
  email: string;
  displayName: string;
}>;
export type BillingCustomerReference = Readonly<{
  provider: string;
  connectedAccountId: string;
  customerId: string;
}>;
export type BillingCheckoutInput = Readonly<{
  paymentId: string;
  chargeId: string;
  leaseId: string;
  tenantId: string;
  customerId: string | null;
  amountCents: number;
  currencyCode: string;
  paymentMethods: readonly BillingPaymentMethod[];
  successUrl: string;
  cancelUrl: string;
  applicationFeeCents: number;
  idempotencyKey: string;
}>;
export type BillingPaymentSessionReference = Readonly<{
  provider: string;
  connectedAccountId: string;
  paymentIntentId: string;
  paymentId: string;
  clientSecret: string;
}>;
export type BillingProviderAccountStatus = Readonly<{
  provider: string;
  connectedAccountId: string;
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  achDebitEnabled: boolean;
  cardPaymentsEnabled: boolean;
  requirementsDue: readonly string[];
}>;

export interface BillingProvider {
  readonly provider: string;
  createConnectedAccount(ownerId: string, idempotencyKey: string): Promise<{ connectedAccountId: string }>;
  createOnboardingLink(context: BillingProviderContext, returnUrl: string, refreshUrl: string): Promise<{ url: string }>;
  retrieveAccountStatus(context: BillingProviderContext): Promise<BillingProviderAccountStatus>;
  createCustomer(context: BillingProviderContext, input: BillingCustomerInput, idempotencyKey: string): Promise<BillingCustomerReference>;
  createPaymentSession(context: BillingProviderContext, input: BillingCheckoutInput): Promise<BillingPaymentSessionReference>;
  constructWebhookEvent(rawBody: string | Uint8Array, signature: string, secret: string): unknown;
}

export function validateBillingCheckoutInput(input: BillingCheckoutInput): BillingCheckoutInput {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) throw new Error("Billing checkout amount must be positive integer cents.");
  if (!Number.isSafeInteger(input.applicationFeeCents) || input.applicationFeeCents < 0 || input.applicationFeeCents >= input.amountCents)
    throw new Error("Billing checkout application fee must be non-negative and less than the payment amount.");
  if (input.paymentMethods.length === 0 || input.paymentMethods.some((method) => !BILLING_PAYMENT_METHODS.includes(method)))
    throw new Error("Billing checkout requires supported payment methods.");
  for (const [field, value] of Object.entries({ paymentId: input.paymentId, chargeId: input.chargeId, leaseId: input.leaseId,
    tenantId: input.tenantId, currencyCode: input.currencyCode, successUrl: input.successUrl, cancelUrl: input.cancelUrl,
    idempotencyKey: input.idempotencyKey })) if (typeof value !== "string" || value.trim() === "") throw new Error(`Billing checkout requires ${field}.`);
  return Object.freeze({ ...input, currencyCode: input.currencyCode.toUpperCase(), paymentMethods: Object.freeze([...input.paymentMethods]) });
}
