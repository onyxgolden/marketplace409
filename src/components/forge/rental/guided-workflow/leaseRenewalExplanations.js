// "Why does this matter?" content for the lease-renewal guided workflow, kept as plain data separate
// from the rendering component -- same pattern as firstTenantReadinessExplanations.js.
export const LEASE_RENEWAL_EXPLANATIONS = Object.freeze({
  "renewal-draft": "A lease approaching its end date has no recorded renewal intent until a draft exists -- without one, the lease simply expires with no plan in place.",
  "renewal-approval": "A draft renewal isn't binding and changes nothing yet. Only approving and applying it updates the lease's end date, rent, and rent schedule.",
  "renewal-review": "This is the final check -- it only appears once this lease's renewal has genuinely been approved and applied.",
});
