// Pure keyword classifier, no Supabase/AI call. Used only to surface a subset of a category's
// existing suggestion list under "where could this go" for an unassigned budget balance -- never
// to filter or gate anything financially consequential, so a loose match here is low-stakes.
const SAVINGS_OR_INVESTMENT_KEYWORDS = [
  "retirement",
  "ira",
  "401k",
  "403b",
  "roth",
  "pension",
  "annuity",
  "portfolio",
  "brokerage",
  "invest",
  "saving",
  "advisor",
  "financial",
  "wros",
  "tod",
  "hsa",
  "trust",
  "guideline",
  "emergency",
  "money_market",
  "money market",
  "certificate_of_deposit",
];

export function isSavingsOrInvestmentCategory({ normalizedCategory, displayLabel }) {
  const haystack = `${normalizedCategory || ""} ${displayLabel || ""}`.toLowerCase();
  return SAVINGS_OR_INVESTMENT_KEYWORDS.some((keyword) => haystack.includes(keyword));
}
