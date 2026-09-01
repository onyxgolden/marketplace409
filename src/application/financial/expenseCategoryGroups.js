// Groups the many granular expense/income categories (both the Schedule-E-style rental categories
// in domains/knowledge/category-map.ts and raw Quicken Simplifi "Parent:Child" categories, e.g.
// "Auto & Transport:Gas & Fuel") into a small set of parent buckets for a collapsible summary.
// Matching is keyword-based on the lowercased category text so it degrades gracefully for any
// category string this app doesn't already know about, rather than requiring an exhaustive list.
const GROUPS = Object.freeze([
  Object.freeze({
    key: "income", label: "Income",
    keywords: ["income", "paycheck", "salary", "dividend", "bonus", "interest_income", "interest earned"],
  }),
  Object.freeze({
    key: "auto_travel", label: "Auto & Travel",
    keywords: ["auto", "vehicle", "transport", "travel", "airfare", "hotel", "gas & fuel", "parking", "registration"],
  }),
  Object.freeze({
    key: "housing", label: "Housing & Home",
    keywords: ["home", "mortgage", "rent_and_lease", "property_repair", "maintenance", "cleaning", "hoa", "furnishing"],
  }),
  Object.freeze({
    key: "utilities", label: "Utilities",
    keywords: ["utilit"],
  }),
  Object.freeze({
    key: "lifestyle", label: "Everyday & Lifestyle",
    keywords: ["dining", "restaurant", "grocer", "shopping", "entertainment", "personal_care", "personal care",
      "fitness", "gym", "health", "doctor", "dentist", "eyecare", "pharmacy", "pet", "gift", "education",
      "tuition", "charity", "donation"],
  }),
  Object.freeze({
    key: "insurance_tax_fees", label: "Insurance, Taxes & Fees",
    keywords: ["insurance", "tax", "fee", "financial", "legal", "professional", "commission",
      "advertis", "software", "supplies", "office", "equipment", "tool"],
  }),
  Object.freeze({
    key: "transfers_other", label: "Transfers & Other",
    keywords: ["transfer", "credit card payment", "balance adjustment", "cash & atm", "cash_atm",
      "tenant_deposit", "savings", "uncategorized", "other"],
  }),
]);

const GROUP_ORDER = Object.freeze(GROUPS.map((group) => group.key));
const FALLBACK_GROUP = GROUPS.at(-1);

export function groupExpenseCategory(rawCategory) {
  const text = String(rawCategory || "").toLowerCase();
  for (const group of GROUPS) {
    if (group.keywords.some((keyword) => text.includes(keyword))) return group;
  }
  return FALLBACK_GROUP;
}

export function groupOrderIndex(groupKey) {
  const index = GROUP_ORDER.indexOf(groupKey);
  return index === -1 ? GROUP_ORDER.length : index;
}

export { GROUPS as EXPENSE_CATEGORY_GROUPS };
