export const RENTAL_SETTLEMENT_STATUSES = ["pending", "available", "paid_out", "failed", "reversed"] as const;
export type RentalSettlementStatus = typeof RENTAL_SETTLEMENT_STATUSES[number];
export type RentalSettlement = Readonly<{ id: string; paymentId: string; provider: string; providerBalanceTransactionId: string | null;
  providerPayoutId: string | null; grossAmountCents: number; feeAmountCents: number; netAmountCents: number;
  currencyCode: string; status: RentalSettlementStatus; availableAt: string | null; paidOutAt: string | null;
  createdAt: string; updatedAt: string }>;
function required(value: string, field: string) { if (typeof value !== "string" || value.trim() === "") throw new Error(`Rental settlement requires ${field}.`); return value.trim(); }
function time(value: string | null, field: string) { if (value === null) return null; const result = required(value, field);
  if (Number.isNaN(Date.parse(result))) throw new Error(`Rental settlement ${field} must be a valid timestamp.`); return result; }
export function createRentalSettlement(value: RentalSettlement): RentalSettlement {
  if (!RENTAL_SETTLEMENT_STATUSES.includes(value.status)) throw new Error("Rental settlement requires a supported status.");
  for (const [field, amount] of [["gross amount", value.grossAmountCents], ["fee amount", value.feeAmountCents], ["net amount", value.netAmountCents]] as const)
    if (!Number.isSafeInteger(amount) || amount < 0) throw new Error(`Rental settlement ${field} must be a non-negative integer number of cents.`);
  if (value.grossAmountCents - value.feeAmountCents !== value.netAmountCents)
    throw new Error("Rental settlement net amount must equal gross amount minus fees.");
  const currencyCode = required(value.currencyCode, "a currency code").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currencyCode)) throw new Error("Rental settlement currency code must contain three letters.");
  return Object.freeze({ ...value, id: required(value.id, "an id"), paymentId: required(value.paymentId, "a payment id"),
    provider: required(value.provider, "a provider"), providerBalanceTransactionId: value.providerBalanceTransactionId?.trim() || null,
    providerPayoutId: value.providerPayoutId?.trim() || null, currencyCode, availableAt: time(value.availableAt, "availableAt"),
    paidOutAt: time(value.paidOutAt, "paidOutAt"), createdAt: time(value.createdAt, "createdAt") as string,
    updatedAt: time(value.updatedAt, "updatedAt") as string });
}
