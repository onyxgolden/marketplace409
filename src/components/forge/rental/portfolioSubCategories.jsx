// Portfolio's own sub-categories, generalized as a plain list so a new property type (e.g. Trailer
// Parks) slots in later as one more entry here without touching RentalApplicationShell or the
// sidebar renderer -- same registry pattern as rvReservationsNavigation.jsx's top-level separation.
//
// "General" holds every tool Portfolio has today: setup, tenants, leases, and the two Rentec
// import utilities. None of them differ in function by property type -- confirmed against the
// actual schema (rental_units, rental_leases, rental_tenants) and every create/edit form in
// RentalSetupPanel.jsx, none of which carry a property_type/single_family/multi_family concept
// anywhere. Forcing these into "Single Family" or "Multi Family" to satisfy the shape of this list
// would hide a universally-needed tool from whichever owners only look in the other sub-category
// (e.g. Tenants under only "Multi Family" would make it unreachable for a single-family-only
// landlord) -- a functional regression, not a stylistic one. So "General" exists to hold exactly
// what's genuinely shared, and "Single Family" / "Multi Family" are real, intentionally-empty
// sub-categories, ready for property-type-specific tooling once that distinction is actually built
// into the product (a data-model change, not a navigation one).
export const PORTFOLIO_SUB_CATEGORIES = Object.freeze([
  Object.freeze({
    key: "general",
    label: "General",
    items: Object.freeze([
      { id: "setup", label: "Property & Unit" },
      { id: "tenants", label: "Tenants" },
      { id: "leases", label: "Leases" },
      { id: "rentec-migration", label: "Rentec Migration" },
      { id: "rentec-files", label: "Rentec Files" },
    ]),
  }),
  Object.freeze({ key: "single-family", label: "Single Family", items: Object.freeze([]) }),
  Object.freeze({ key: "multi-family", label: "Multi Family", items: Object.freeze([]) }),
]);
