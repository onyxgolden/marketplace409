// Pure keyword classifier, no Supabase/AI call. Same low-stakes role as
// isSavingsOrInvestmentCategory: surfaces a subset of a category's existing suggestion list under
// "where could this go" for an unassigned budget balance -- it does not compute a debt avalanche/
// snowball order or know any account's balance or interest rate, since financial_events carries
// neither. A real snowball/avalanche ranking is a future feature that needs real debt-balance data.
// "loan" and "debt" are deliberately broad -- they catch any category this consumer's real data
// happens to use that this list doesn't name explicitly (e.g. "personal_loan", "medical_debt",
// "tax_debt") without needing a new keyword per debt type. The named entries below exist only for
// common debt categories that wouldn't otherwise contain "loan" or "debt" as a substring.
const DEBT_PAYOFF_KEYWORDS = ["mortgage", "loan", "debt", "car_payment", "credit_card", "student_loan", "heloc", "line_of_credit"];

export function isDebtPayoffCategory({ normalizedCategory, displayLabel }) {
  const haystack = `${normalizedCategory || ""} ${displayLabel || ""}`.toLowerCase();
  return DEBT_PAYOFF_KEYWORDS.some((keyword) => haystack.includes(keyword));
}
