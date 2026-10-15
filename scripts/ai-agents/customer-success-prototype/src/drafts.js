/**
 * drafts.js — two fixed-template response-draft variants per eligible
 * ticket: acknowledgment and clarification, both labeled
 * "DRAFT — NOT SENT". Templates insert ONLY verified fixture/topic
 * labels (ticket_id, the classified category — a fixed enum string this
 * agent controls, never raw ticket text) — never the ticket's own
 * subject/body/notes, never a contact detail, refund promise, SLA
 * guarantee, or any assertion that an account action has occurred.
 * Neither variant implies a completed action. Pure Node 24 ESM, zero
 * dependencies, zero I/O.
 */

const CATEGORY_LABELS = {
  ACCOUNT_CLOSURE: "account closure",
  BILLING: "billing",
  TECHNICAL: "technical support",
  FEATURE_REQUEST: "feature request",
  OTHER: "general support",
};

const DRAFT_LABEL = "DRAFT — NOT SENT";

/** Categories/secondary tags whose drafts carry a Jason-authority routing
 *  flag — the flag is advisory only; it triggers no operational act. */
const AUTHORITY_REQUIRED_CATEGORY = new Set(["ACCOUNT_CLOSURE"]);
const AUTHORITY_REQUIRED_SECONDARY = new Set(["REFUND_REQUEST"]);

export function authorityRequired(classification) {
  return AUTHORITY_REQUIRED_CATEGORY.has(classification.category) || classification.secondary_categories.some((t) => AUTHORITY_REQUIRED_SECONDARY.has(t));
}

/**
 * Build the two inert draft variants for one ticket. Returns an array of
 * exactly two {variant, label, text, routing_flags} objects. Caller
 * decides suppression (missing verified topic / quarantined input)
 * before calling this — this function only renders, it never refuses.
 */
export function buildDrafts(ticket_id, classification) {
  const label = CATEGORY_LABELS[classification.category] ?? CATEGORY_LABELS.OTHER;
  const needsAuthority = authorityRequired(classification);
  const routing_flags = needsAuthority
    ? [{ code: "JASON_AUTHORITY_REQUIRED", ticket_id, reason: `category '${classification.category}' requires explicit account-owner authority before any action; this draft takes no action` }]
    : [];

  return [
    {
      variant: "acknowledgment",
      label: DRAFT_LABEL,
      text: `${DRAFT_LABEL}: Thank you for contacting support about your ${label} request (ticket ${ticket_id}). A representative will follow up. No account action has been taken.`,
      routing_flags,
    },
    {
      variant: "clarification",
      label: DRAFT_LABEL,
      text: `${DRAFT_LABEL}: To help with your ${label} request (ticket ${ticket_id}), could you confirm additional details when you have a moment? No account action has been taken and no commitment is implied.`,
      routing_flags,
    },
  ];
}

export { CATEGORY_LABELS, DRAFT_LABEL };
