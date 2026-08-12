export const INSURANCE_REFERRAL_PRODUCTS = ["renters_insurance", "dog_liability"] as const;
export type InsuranceReferralProduct = typeof INSURANCE_REFERRAL_PRODUCTS[number];
export type InsuranceReferralLink = Readonly<{ id: string; providerName: string; product: InsuranceReferralProduct;
  outboundUrl: string; referralCompensationPossible: boolean; disclosureText: string; active: boolean }>;
export function createInsuranceReferralLink(value: InsuranceReferralLink): InsuranceReferralLink {
  if (!INSURANCE_REFERRAL_PRODUCTS.includes(value.product)) throw new Error("Insurance referral link requires a supported product.");
  if (!value.id?.trim() || !value.providerName?.trim() || !value.disclosureText?.trim()) throw new Error("Insurance referral link requires identity and disclosure.");
  const url = new URL(value.outboundUrl); if (url.protocol !== "https:") throw new Error("Insurance referral link requires HTTPS.");
  return Object.freeze({ ...value, outboundUrl: url.toString() });
}
