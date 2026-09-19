// Category families: parent/child groupings from bank-import taxonomies (e.g. Quicken Simplifi),
// where "dining_drinks" and "dining_drinks_restaurants" are the same spending in the user's head.
// A category belongs to the longest root it equals or extends with "_" -- so "dining_drinks"
// and "dining_drinks_restaurants" both resolve to the "dining_drinks" family. Anything not under a
// known root is its own family (idempotent), so this is safe to apply everywhere: categories
// without children pass through unchanged, and no saved category is ever renamed or merged.
const FAMILY_ROOTS = [
  "dining_drinks",
  "groceries",
  "auto_transport",
  "travel",
  "home",
  "utilities",
  "shopping",
  "entertainment",
  "healthcare",
  "personal_care",
  "education",
];

// Longest root first, so a future root like "home_office" would win over "home" for its children.
const ROOTS_BY_LENGTH = [...FAMILY_ROOTS].sort((a, b) => b.length - a.length);

export function categoryFamilyOf(normalizedCategory) {
  if (!normalizedCategory) return null;
  const root = ROOTS_BY_LENGTH.find(
    (candidate) => normalizedCategory === candidate || normalizedCategory.startsWith(`${candidate}_`),
  );
  return root ?? normalizedCategory;
}
