// Budget variance: how actual spending compares to the planned amount.
// Positive variance = under plan (money left); negative = over plan.
// A null planned amount means the line was never planned, so there is no
// variance to report -- null, not zero, so the UI can stay quiet.
export function lineVarianceCents({ plannedAmountCents, actualAmountCents }) {
  if (plannedAmountCents == null) return null;
  return plannedAmountCents - (actualAmountCents ?? 0);
}

export function varianceLabel(varianceCents) {
  if (varianceCents == null) return null;
  if (varianceCents === 0) return "on plan";
  return varianceCents > 0 ? "left" : "over";
}
