// Pure predicate for the reconcile-transfers preview: true when an ambiguous
// (unpaired transfer-description) row already carries a decided classification, so
// the panel should stop surfacing it. 'other' is the CategoryNormalizer fallback --
// the system's "undecided" marker. Anything else (internal_transfer,
// owner_distribution, a real expense category, ...) means a human or a previous
// apply already made the call. NULL is treated as undecided (stay visible).
//
// This is what finally clears one-sided external transfers: the Fidelity money
// market (emergency fund) can't be connected, so its Business Savings legs can
// never pair. Once they're marked transfer/internal_transfer, they must disappear
// from the ambiguous list instead of lingering forever.
export function isAmbiguousRowResolved(normalizedCategory) {
  return normalizedCategory !== "other" && normalizedCategory != null;
}
