export type ForgeTransactionKind =
  | "income"
  | "expense"
  | "asset_purchase"
  | "asset_sale"
  | "liability_payment"
  | "transfer";

export type ForgeCategory =
  | "rental_income"
  | "cam_income"
  | "tenant_deposit"
  | "property_repairs"
  | "maintenance"
  | "cleaning_supplies"
  | "supplies"
  | "tools"
  | "utilities"
  | "insurance"
  | "mortgage_interest"
  | "property_tax"
  | "professional_fees"
  | "legal_fees"
  | "office_supplies"
  | "office_equipment"
  | "equipment_purchase"
  | "equipment_rental"
  | "equipment_repair"
  | "real_estate_purchase"
  | "vehicle_maintenance"
  | "travel"
  | "taxes"
  | "interest_income"
  | "other";

export type KnowledgeRecord = {
  rawCategory: string;
  normalizedCategory: ForgeCategory;
  transactionKind: ForgeTransactionKind;

  taxDeductible: boolean;
  affectsNOI: boolean;
  capitalized: boolean;
};
