// Budget screen's one number: "How much is left to spend this month?"
// Pure derivation over the already-fetched plan totals -- no I/O, no LLM.
// Takes cents (the budget domain's unit), returns display-ready strings.
//
// Positive = money still unspent (good), negative = over budget (bad),
// zero = exactly on plan. null/undefined input means "not loaded yet" --
// callers must render a dash, never a fabricated $0.
const dollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

// The budget domain works in cents; the headline reads in dollars.
const toDollars = (cents) => dollars.format((Number(cents) || 0) / 100);

export function describeLeftToSpend({ leftToSpendCents, totalPlannedCents }) {
  if (leftToSpendCents == null || totalPlannedCents == null) {
    return { value: "–", tone: "neutral", caption: null, loaded: false };
  }
  const left = Number(leftToSpendCents) || 0;
  const planned = Number(totalPlannedCents) || 0;
  const plannedText = toDollars(planned);
  if (left > 0) {
    return {
      value: toDollars(left),
      tone: "positive",
      caption: `${toDollars(left)} of ${plannedText} planned is still unspent.`,
      loaded: true,
    };
  }
  if (left < 0) {
    return {
      value: toDollars(Math.abs(left)),
      tone: "negative",
      caption: `Over budget by ${toDollars(Math.abs(left))} on ${plannedText} planned.`,
      loaded: true,
    };
  }
  return {
    value: toDollars(0),
    tone: "neutral",
    caption:
      planned > 0
        ? `Right on plan — ${plannedText} planned, ${plannedText} spent.`
        : "No budget lines yet.",
    loaded: true,
  };
}
