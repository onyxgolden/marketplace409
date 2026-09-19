// Best-effort specific expense category for a debt-payment pair, from the real loan
// account's own name. Verified against production (2026-09-18): the "Home Equity"
// account at DuGood is a closed-end home equity loan -- Jason's actual home mortgage,
// paid semi-monthly -- so "equity" maps to mortgage_payment, not heloc_payment.
// "heloc" is still honored for accounts actually named as a HELOC/line of credit.
// Everything falls back to the generic loan_payment. All three are recognized by
// isDebtPayoffCategory's keyword list.
export function loanPaymentCategory(accountName) {
  const normalized = (accountName ?? "").toLowerCase();
  if (normalized.includes("heloc")) return "heloc_payment";
  if (normalized.includes("mortgage") || normalized.includes("equity")) return "mortgage_payment";
  return "loan_payment";
}
