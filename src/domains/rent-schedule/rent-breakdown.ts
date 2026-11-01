// Monthly-rent breakdown display. The schedule's amountCents is the TOTAL
// monthly obligation; petFeeCents is the portion attributable to pets. Rent is
// derived (total - fee) so the two can never drift apart — there is no
// separate rent column to keep in sync. Schedules without a fee (0, null, or
// missing — including rows read before the pet-fee migration lands) render
// exactly as before: just the total.
export type RentBreakdownInput = Readonly<{
  totalCents: number;
  petFeeCents?: number | null;
}>;

export function rentBreakdown({ totalCents, petFeeCents }: RentBreakdownInput): Readonly<{
  rentCents: number;
  petFeeCents: number;
  totalCents: number;
  hasPetFee: boolean;
}> {
  const fee = petFeeCents == null ? 0 : Number(petFeeCents);
  const total = Number(totalCents);
  const safeFee = Number.isSafeInteger(fee) && fee > 0 && fee <= total ? fee : 0;
  return Object.freeze({
    rentCents: total - safeFee,
    petFeeCents: safeFee,
    totalCents: total,
    hasPetFee: safeFee > 0,
  });
}

// "Rent $1,800 + Pet fee $50 = $1,850/mo" when a fee exists, otherwise null so
// callers keep their existing single-value rendering untouched.
export function rentBreakdownText(input: RentBreakdownInput, format: (cents: number) => string): string | null {
  const breakdown = rentBreakdown(input);
  if (!breakdown.hasPetFee) return null;
  return `Rent ${format(breakdown.rentCents)} + Pet fee ${format(breakdown.petFeeCents)} = ${format(breakdown.totalCents)}/mo`;
}
