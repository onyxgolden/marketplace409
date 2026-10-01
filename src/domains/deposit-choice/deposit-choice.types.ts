// R24 deposit-choice record — the owner's per-lease choice between a
// traditional security deposit and a deposit-insurance product.
//
// RECORD-ONLY: this validates the choice record. No money moves here — the
// money movement stays in the existing deposit flows. A deposit-insurance
// product choice must name the product reference; it is a record of the
// owner's choice, never a binding (partner products are hard-gated).

export const DEPOSIT_CHOICES = ["traditional_security_deposit", "deposit_insurance_product"] as const;
export type DepositChoice = typeof DEPOSIT_CHOICES[number];

export type LeaseDepositChoice = Readonly<{
  leaseId: string;
  choice: DepositChoice;
  productReference: string | null;
}>;

export function createLeaseDepositChoice(value: LeaseDepositChoice): LeaseDepositChoice {
  if (!DEPOSIT_CHOICES.includes(value.choice)) throw new Error("Deposit choice requires a supported choice.");
  if (!value.leaseId?.trim()) throw new Error("Deposit choice requires a lease id.");
  const productReference = value.productReference?.trim() ? value.productReference.trim() : null;
  if (value.choice === "deposit_insurance_product" && !productReference)
    throw new Error("A deposit-insurance product choice must name the product reference.");
  return Object.freeze({ leaseId: value.leaseId.trim(), choice: value.choice, productReference });
}
