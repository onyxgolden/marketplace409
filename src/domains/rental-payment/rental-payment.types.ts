export const RENTAL_PAYMENT_STATUSES = [
  "created", "requires_payment_method", "requires_action", "processing",
  "succeeded", "failed", "cancelled", "partially_refunded", "refunded", "disputed",
] as const;
export type RentalPaymentStatus = typeof RENTAL_PAYMENT_STATUSES[number];

export type RentalPayment = Readonly<{
  id: string;
  chargeId: string;
  leaseId: string;
  tenantId: string;
  provider: string;
  providerCustomerId: string | null;
  providerPaymentId: string | null;
  amountCents: number;
  refundedAmountCents: number;
  currencyCode: string;
  status: RentalPaymentStatus;
  idempotencyKey: string;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: string;
  updatedAt: string;
  succeededAt: string | null;
}>;

function required(value: string, field: string) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`Rental payment requires ${field}.`);
  return value.trim();
}
function optional(value: string | null) { return value?.trim() || null; }
function timestamp(value: string, field: string) {
  const normalized = required(value, field);
  if (Number.isNaN(Date.parse(normalized))) throw new Error(`Rental payment ${field} must be a valid timestamp.`);
  return normalized;
}
export function createRentalPayment(payment: RentalPayment): RentalPayment {
  if (!RENTAL_PAYMENT_STATUSES.includes(payment.status)) throw new Error("Rental payment requires a supported status.");
  if (!Number.isSafeInteger(payment.amountCents) || payment.amountCents <= 0)
    throw new Error("Rental payment amount must be a positive integer number of cents.");
  if (!Number.isSafeInteger(payment.refundedAmountCents) || payment.refundedAmountCents < 0 || payment.refundedAmountCents > payment.amountCents)
    throw new Error("Rental payment refunded amount must be between zero and the payment amount.");
  if (payment.status === "succeeded" && payment.succeededAt === null)
    throw new Error("Succeeded rental payments require succeededAt.");
  if (payment.status === "refunded" && payment.refundedAmountCents !== payment.amountCents)
    throw new Error("Refunded rental payments must be fully refunded.");
  const currencyCode = required(payment.currencyCode, "a currency code").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currencyCode)) throw new Error("Rental payment currency code must contain three letters.");
  return Object.freeze({ ...payment, id: required(payment.id, "an id"), chargeId: required(payment.chargeId, "a charge id"),
    leaseId: required(payment.leaseId, "a lease id"), tenantId: required(payment.tenantId, "a tenant id"),
    provider: required(payment.provider, "a provider"), providerCustomerId: optional(payment.providerCustomerId),
    providerPaymentId: optional(payment.providerPaymentId), currencyCode, idempotencyKey: required(payment.idempotencyKey, "an idempotency key"),
    failureCode: optional(payment.failureCode), failureMessage: optional(payment.failureMessage),
    createdAt: timestamp(payment.createdAt, "createdAt"), updatedAt: timestamp(payment.updatedAt, "updatedAt"),
    succeededAt: payment.succeededAt === null ? null : timestamp(payment.succeededAt, "succeededAt") });
}
