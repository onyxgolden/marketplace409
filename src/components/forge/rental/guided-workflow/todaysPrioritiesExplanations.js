// "Why does this matter?" content for the Today's Priorities guided workflow, kept as plain data
// separate from the rendering component -- the same content-authoring pattern already used by
// rentalHelpContent.js and schedulingHelpContent.js, so new explanations never require touching JSX.
export const TODAYS_PRIORITIES_EXPLANATIONS = Object.freeze({
  "overdue-forge": "Rent that FORGE is responsible for collecting keeps aging the longer it goes unaddressed, and tenants may not realize a payment is overdue if nothing prompts them.",
  "urgent-maintenance": "Urgent or high-priority requests are often safety or habitability issues -- delaying a response can make the problem worse and create liability.",
  "externally-managed": "These balances are still authoritative in Rentec, not FORGE, so FORGE can't reconcile them automatically -- they need to be resolved at the source before FORGE's records can be trusted for these leases.",
  "leases-expiring-soon": "A lease within 30 days of ending needs a renewal or move-out decision now -- waiting until the last minute limits your options and the tenant's.",
  "vacancies": "An empty unit isn't generating rent. The sooner it's ready to show or list, the sooner it can be leased.",
  "readiness-gaps": "Missing insurance, an unrecorded deposit, or a skipped move-in inspection are exactly the gaps that turn into disputes later, when there's no record to point to.",
  "routine-maintenance": "Not urgent, but requests left open too long tend to become urgent -- and tenants notice when routine issues sit unaddressed.",
  "awaiting-settlement": "A succeeded payment that hasn't settled yet isn't a problem by itself, but it's worth confirming it's on track rather than assuming it always resolves on its own.",
  "support-cases": "Open support cases are usually a tenant or a process waiting on you -- the longer they sit open, the more they tend to escalate.",
});
