import { MANUAL_FINANCIAL_EVENT_CATEGORIES } from "@/application/financial/manualFinancialEventCategories";

const LABELS_BY_VALUE = new Map(MANUAL_FINANCIAL_EVENT_CATEGORIES.map((entry) => [entry.value, entry.label]));

// Reuses the curated property/business label list where a normalized_category happens to match it,
// and falls back to title-casing the raw snake_case value otherwise -- most personal-spending
// categories (e.g. "dining_drinks_restaurants" from the Quicken Simplifi import) aren't in that
// curated list at all, since it was built for property/business bookkeeping, not personal spend.
export function resolveCategoryDisplayLabel(normalizedCategory) {
  if (LABELS_BY_VALUE.has(normalizedCategory)) {
    return LABELS_BY_VALUE.get(normalizedCategory);
  }

  return normalizedCategory
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
