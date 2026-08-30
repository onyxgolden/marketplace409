// The single source of truth for what to call the platform-side party in user-visible text.
// South Main (seller_financing) is called "Seller"; a personal_loan account is called "Lender" -- neither
// word is correct for every financing type, so no UI component may hard-code either one. Unrecognized or
// missing product values fall back to "Seller" (this repo's original, still-most-common financing type)
// rather than throwing, since this helper is purely a display-label lookup, never a validation gate.
const FINANCING_PARTY_LABELS = {
  seller_financing: "Seller",
  personal_loan: "Lender",
};

export function financingPartyLabel(product) {
  return FINANCING_PARTY_LABELS[product] || "Seller";
}
