// "Why does this matter?" content for the first-tenant-readiness guided workflow, kept as plain data
// separate from the rendering component -- same pattern as todaysPrioritiesExplanations.js.
export const FIRST_TENANT_READINESS_EXPLANATIONS = Object.freeze({
  "unit-readiness": "A unit still marked \"preparing\" won't show correctly elsewhere in FORGE, and an inactive unit can't be leased at all until it's reactivated.",
  "tenant-assignment": "Every step after this one -- the lease, rent, deposit, insurance, and inspection -- depends on a specific tenant being on record for this unit.",
  "lease-readiness": "A draft lease isn't binding yet. Rent can't be scheduled and the tenancy isn't real until the lease is active.",
  "recurring-rent-setup": "Without an active rent schedule, no charges will ever be generated for this lease, even after the tenant moves in.",
  "security-deposit": "An uncollected or partially collected deposit leaves you without the protection it's meant to provide if something goes wrong later.",
  "renters-insurance": "Verified renter's insurance protects both you and the tenant if there's damage or a liability claim during the tenancy.",
  "move-in-inspection": "A finalized move-in inspection is the record you'll need if there's ever a dispute about the unit's condition at move-out.",
  "ready-for-move-in": "This is the final check across everything above -- it only appears once every required step for this unit has genuinely been completed.",
});
