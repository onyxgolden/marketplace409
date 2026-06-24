import { CATEGORY_MAP } from "./category-map";
import type { KnowledgeRecord } from "./knowledge.types";

export class CategoryNormalizer {
  normalize(description: string): KnowledgeRecord {
    const baseCategory = this.extractBaseCategory(description);

    const record = CATEGORY_MAP[baseCategory];

    if (record) {
      // Purchase price represents acquisition of real estate.
      if (
        baseCategory === "Commissions" &&
        description.toLowerCase().includes("purchase price")
      ) {
        return {
          ...record,
          normalizedCategory: "real_estate_purchase",
          transactionKind: "asset_purchase",
          taxDeductible: false,
          affectsNOI: false,
          capitalized: true,
        };
      }

      return record;
    }

    return {
      rawCategory: baseCategory,
      normalizedCategory: "other",
      transactionKind: "expense",
      taxDeductible: false,
      affectsNOI: false,
      capitalized: false,
    };
  }

  extractBaseCategory(description: string): string {
    return description.split("(")[0].trim();
  }
}

export const categoryNormalizer = new CategoryNormalizer();
