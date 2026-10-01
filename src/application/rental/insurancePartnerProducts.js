// Rentec parity R24 — insurance partner products: DESIGN ONLY, HARD GATE.
//
// SPEND DECISION (Jason's build-spend motto, hard boundary): partner insurance
// products (renters-insurance partners, deposit-insurance products, pet
// liability programs) cost money or require partnerships. Nothing in this
// module signs up for, configures, contacts, purchases, or binds any partner
// insurance product. The partner layer is modeled as a swappable stub with a
// stable contract so a real provider can be wired later WITHOUT touching the
// tracking, compliance, deposit-choice, or UI code:
//
//   - getInsurancePartnerStatus() always reports { connected: false }.
//   - requestInsurancePartnerQuote() ALWAYS refuses with the gate message and
//     makes NO network call (the test suite asserts fetch is never invoked).
//
// WHAT JASON WOULD NEED TO APPROVE before partner products go live:
//   1. Partner choice — which renters-insurance / deposit-insurance / pet
//      liability provider the business would bind through.
//   2. Costs and who pays — partner products bill per policy, per unit per
//      month, or via referral compensation; needs Jason's word under the
//      build-spend doctrine. Rentec's versions are partner add-ons with real
//      spend — FORGE will not silently copy that cost onto the business.
//   3. Provider credentials and API keys, stored in the Secure Vault — never in
//      chat or code.
//   4. Coverage terms and the tenant-facing disclosures (who the carrier is,
//      what is and isn't covered) reviewed before any tenant is pointed at a
//      partner product.
//
// Until then the UI shows "Partner products: not connected" and the tracking
// surfaces (policies on file, deposit choices, pet records) work standalone.

export const INSURANCE_PARTNER_GATE_MESSAGE =
  "Partner insurance products are not connected. Choose a partner, approve the costs, and confirm who pays before partner products go live — for now, track policies, deposit choices, and pet records in FORGE.";

export const INSURANCE_PARTNER_PRODUCTS = Object.freeze([
  "renters_insurance",
  "deposit_insurance",
  "pet_liability",
]);

export const INSURANCE_PARTNER_APPROVAL_CHECKLIST = Object.freeze([
  "Partner choice — which renters-insurance / deposit-insurance / pet-liability provider the business would bind through",
  "Costs and who pays — partners bill per policy, per unit per month, or via referral; needs Jason's word under the build-spend doctrine",
  "Provider credentials and API keys, stored in the Secure Vault — never in chat or code",
  "Coverage terms and tenant-facing disclosures reviewed before any tenant is pointed at a partner product",
]);

// Stable contract for the future real provider. A connected implementation
// would return { connected: true, provider: "<name>", products: [...],
// connectedAt } and this module would route quote() to it. Today the stub is
// the only implementation.
export function getInsurancePartnerStatus() {
  return Object.freeze({
    connected: false,
    provider: null,
    products: INSURANCE_PARTNER_PRODUCTS,
    lastCheckedAt: new Date().toISOString(),
    message: "Partner products: not connected — track policies, deposit choices, and pet records in FORGE.",
    approvalChecklist: INSURANCE_PARTNER_APPROVAL_CHECKLIST,
  });
}

// Never performs a network call. The refusal shape mirrors what a
// connected-but-failed quote would return, minus the provider call.
export function requestInsurancePartnerQuote({ product, leaseId } = {}) {
  return Object.freeze({
    ok: false,
    quoted: false,
    error: INSURANCE_PARTNER_GATE_MESSAGE,
    product: product ?? null,
    leaseId: leaseId ?? null,
  });
}
