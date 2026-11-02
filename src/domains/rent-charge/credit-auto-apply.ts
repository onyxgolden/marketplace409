// Overpayment-credit auto-apply planning — pure domain math for the generation
// path. Mirrors the apply-credit conventions exactly:
// - FIFO order: oldest credit first, id as a stable tiebreak (same as
//   sortCreditsForAutoApply in the rental-payment domain and the
//   generate_monthly_rent_charge loop).
// - LEAST math: each application is min(credit remaining, charge remaining),
//   so a charge is never overpaid and leftover credit stays open.
// - Only overpayment-sourced credits are ever passed in: the caller (the
//   generation cron's RPC) filters source = 'overpayment'. Manual credits stay
//   hand-applied — an owner may intend to hold them.
// - Zero-amount applications are never emitted (the RPC refuses amounts <= 0).
export type OverpaymentCreditInput = Readonly<{
  id: string;
  remainingCents: number;
  createdAt: string;
}>;

export type PlannedCreditApplication = Readonly<{
  creditId: string;
  amountCents: number;
}>;

export function planOverpaymentCreditApplications({ chargeAmountCents, credits }: Readonly<{
  chargeAmountCents: number;
  credits: readonly OverpaymentCreditInput[];
}>): Readonly<{ applications: readonly PlannedCreditApplication[]; totalAppliedCents: number }> {
  if (!Number.isSafeInteger(chargeAmountCents) || chargeAmountCents <= 0)
    throw new Error("Charge amount must be a positive whole-cent amount.");
  const ordered = [...credits].sort((a, b) => {
    const byDate = String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
    if (byDate !== 0) return byDate;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });
  let chargeRemaining = chargeAmountCents;
  const applications: PlannedCreditApplication[] = [];
  for (const credit of ordered) {
    if (chargeRemaining <= 0) break;
    if (!Number.isSafeInteger(credit.remainingCents) || credit.remainingCents <= 0) continue;
    const amountCents = Math.min(credit.remainingCents, chargeRemaining);
    if (amountCents <= 0) continue;
    applications.push(Object.freeze({ creditId: credit.id, amountCents }));
    chargeRemaining -= amountCents;
  }
  return Object.freeze({ applications: Object.freeze(applications), totalAppliedCents: chargeAmountCents - chargeRemaining });
}
