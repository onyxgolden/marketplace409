export const INSTITUTION_REFERENCE_TYPES = [
  "bank",
  "credit_card_issuer",
  "payment_processor",
  "accounting_platform",
  "property_management_platform",
  "csv_source",
  "manual_source",
  "future_integration",
] as const;

export type InstitutionReferenceType =
  (typeof INSTITUTION_REFERENCE_TYPES)[number];

export type InstitutionReference = Readonly<{
  id: string;
  connectionId: string;
  name: string;
  type: InstitutionReferenceType;
  provider: string;
  externalInstitutionId?: string;
  websiteUrl?: string;
  logoUrl?: string;
  createdAt: string;
  updatedAt: string;
}>;
