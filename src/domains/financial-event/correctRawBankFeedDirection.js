// Fixes a confirmed bug in the raw bank-feed (source_system='transaction') import path: every
// transaction that CategoryNormalizer can't map (see category-normalizer.ts's fallback) gets
// transactionKind='expense' unconditionally, with the RAW SIGNED bank amount preserved as-is. For
// deposits that sign is negative -- verified against all 214 production 'transaction' rows: negative
// amount correlates 100% with inbound language ("Deposit", or "Payment/... from ...") and positive
// amount 100% with outbound language ("Withdrawal", or "... to ..."), zero contradictions. Sign is
// therefore a more reliable direction signal than description keywords (it also correctly handles a
// "Payment / Transfer from ..." row that contains neither the word "Deposit" nor "Withdrawal").
//
// Deliberately narrow: only ever corrects the unmapped ('other'/'expense') fallback case. A
// CategoryNormalizer hit (a real Rentec-style category) is never touched -- this is not a general
// sign-flipping rule, it only undoes the specific fallback-path bug.
export function needsDirectionCorrection({ transactionKind, normalizedCategory, amount }) {
  return transactionKind === "expense" && normalizedCategory === "other" && amount < 0;
}

export function applyDirectionCorrection({ transactionKind, normalizedCategory, amount }) {
  if (!needsDirectionCorrection({ transactionKind, normalizedCategory, amount })) {
    return { transactionKind, normalizedCategory, amount };
  }
  return { transactionKind: "income", normalizedCategory, amount: Math.abs(amount) };
}
