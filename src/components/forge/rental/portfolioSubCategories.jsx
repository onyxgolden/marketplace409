// Portfolio's own sub-categories, generalized as a plain list so a new property type (e.g. Trailer
// Parks) slots in later as one more entry here without touching RentalApplicationShell or the
// sidebar renderer -- same registry pattern as rvReservationsNavigation.jsx's top-level separation.
//
// None of Portfolio's five existing tools differ in function by property type today -- confirmed
// against the actual schema (rental_units, rental_leases, rental_tenants) and every create/edit
// form in RentalSetupPanel.jsx, none of which carry a property_type/single_family/multi_family
// concept anywhere. They're placed under "Single Family" as a deliberate, explicit product choice
// (not a data-model finding) because the current portfolio is single-family for now; Multi Family
// ships real and empty, ready to receive its own tooling -- and these five moving there too, or
// splitting -- once that distinction actually exists.
export const PORTFOLIO_SUB_CATEGORIES = Object.freeze([
  Object.freeze({
    key: "single-family",
    label: "Single Family",
    items: Object.freeze([
      { id: "setup", label: "Property & Unit" },
      { id: "tenants", label: "Tenants" },
      { id: "leases", label: "Leases" },
      { id: "rentec-migration", label: "Rentec Migration" },
      { id: "rentec-files", label: "Rentec Files" },
    ]),
  }),
  Object.freeze({ key: "multi-family", label: "Multi Family", items: Object.freeze([]) }),
]);
