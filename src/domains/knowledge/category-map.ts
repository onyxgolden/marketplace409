import type { KnowledgeRecord } from "./knowledge.types";

export const CATEGORY_MAP: Record<string, KnowledgeRecord> = {
  "Rental Income": {
    rawCategory: "Rental Income",
    normalizedCategory: "rental_income",
    transactionKind: "income",
    taxDeductible: false,
    affectsNOI: true,
    capitalized: false,
  },

  "CAM Income": {
    rawCategory: "CAM Income",
    normalizedCategory: "cam_income",
    transactionKind: "income",
    taxDeductible: false,
    affectsNOI: true,
    capitalized: false,
  },

  "Tenant Deposit": {
    rawCategory: "Tenant Deposit",
    normalizedCategory: "tenant_deposit",
    transactionKind: "transfer",
    taxDeductible: false,
    affectsNOI: false,
    capitalized: false,
  },

  Repairs: {
    rawCategory: "Repairs",
    normalizedCategory: "property_repairs",
    transactionKind: "expense",
    taxDeductible: true,
    affectsNOI: true,
    capitalized: false,
  },

  "Cleaning and Maint": {
    rawCategory: "Cleaning and Maint",
    normalizedCategory: "maintenance",
    transactionKind: "expense",
    taxDeductible: true,
    affectsNOI: true,
    capitalized: false,
  },

  "Cleaning Supplies": {
    rawCategory: "Cleaning Supplies",
    normalizedCategory: "cleaning_supplies",
    transactionKind: "expense",
    taxDeductible: true,
    affectsNOI: true,
    capitalized: false,
  },

  Supplies: {
    rawCategory: "Supplies",
    normalizedCategory: "supplies",
    transactionKind: "expense",
    taxDeductible: true,
    affectsNOI: true,
    capitalized: false,
  },

  Tools: {
    rawCategory: "Tools",
    normalizedCategory: "tools",
    transactionKind: "expense",
    taxDeductible: true,
    affectsNOI: true,
    capitalized: false,
  },

  Utilities: {
    rawCategory: "Utilities",
    normalizedCategory: "utilities",
    transactionKind: "expense",
    taxDeductible: true,
    affectsNOI: true,
    capitalized: false,
  },

  Insurance: {
    rawCategory: "Insurance",
    normalizedCategory: "insurance",
    transactionKind: "expense",
    taxDeductible: true,
    affectsNOI: true,
    capitalized: false,
  },

  "Mortgage Interest": {
    rawCategory: "Mortgage Interest",
    normalizedCategory: "mortgage_interest",
    transactionKind: "expense",
    taxDeductible: true,
    affectsNOI: true,
    capitalized: false,
  },

  "Property Tax": {
    rawCategory: "Property Tax",
    normalizedCategory: "property_tax",
    transactionKind: "expense",
    taxDeductible: true,
    affectsNOI: true,
    capitalized: false,
  },

  "Professional fees": {
    rawCategory: "Professional fees",
    normalizedCategory: "professional_fees",
    transactionKind: "expense",
    taxDeductible: true,
    affectsNOI: true,
    capitalized: false,
  },

  "Legal and Professional Fees": {
    rawCategory: "Legal and Professional Fees",
    normalizedCategory: "legal_fees",
    transactionKind: "expense",
    taxDeductible: true,
    affectsNOI: true,
    capitalized: false,
  },

  "Office Supplies": {
    rawCategory: "Office Supplies",
    normalizedCategory: "office_supplies",
    transactionKind: "expense",
    taxDeductible: true,
    affectsNOI: false,
    capitalized: false,
  },

  "Office Equipment": {
    rawCategory: "Office Equipment",
    normalizedCategory: "office_equipment",
    transactionKind: "expense",
    taxDeductible: true,
    affectsNOI: false,
    capitalized: true,
  },

  Equipment: {
    rawCategory: "Equipment",
    normalizedCategory: "equipment_purchase",
    transactionKind: "asset_purchase",
    taxDeductible: false,
    affectsNOI: false,
    capitalized: true,
  },

  "Equipment Rental": {
    rawCategory: "Equipment Rental",
    normalizedCategory: "equipment_rental",
    transactionKind: "expense",
    taxDeductible: true,
    affectsNOI: true,
    capitalized: false,
  },

  "Equipment Repair": {
    rawCategory: "Equipment Repair",
    normalizedCategory: "equipment_repair",
    transactionKind: "expense",
    taxDeductible: true,
    affectsNOI: true,
    capitalized: false,
  },

  "Auto Maintance": {
    rawCategory: "Auto Maintance",
    normalizedCategory: "vehicle_maintenance",
    transactionKind: "expense",
    taxDeductible: true,
    affectsNOI: false,
    capitalized: false,
  },

  "Auto and Travel": {
    rawCategory: "Auto and Travel",
    normalizedCategory: "travel",
    transactionKind: "expense",
    taxDeductible: true,
    affectsNOI: false,
    capitalized: false,
  },

  Taxes: {
    rawCategory: "Taxes",
    normalizedCategory: "taxes",
    transactionKind: "expense",
    taxDeductible: false,
    affectsNOI: false,
    capitalized: false,
  },

  "Other Interest": {
    rawCategory: "Other Interest",
    normalizedCategory: "interest_income",
    transactionKind: "income",
    taxDeductible: false,
    affectsNOI: false,
    capitalized: false,
  },

  Commissions: {
    rawCategory: "Commissions",
    normalizedCategory: "other",
    transactionKind: "expense",
    taxDeductible: true,
    affectsNOI: false,
    capitalized: false,
  },
};
