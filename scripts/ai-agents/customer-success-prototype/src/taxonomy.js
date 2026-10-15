/**
 * taxonomy.js — ticket category/priority classification, Taxonomy v1.
 *
 * Category precedence: ACCOUNT_CLOSURE > BILLING > TECHNICAL >
 * FEATURE_REQUEST > OTHER. Other recognized tags are retained as
 * secondary categories (never promoted to primary, never dropped).
 * Unrecognized tags yield UNKNOWN_TAG — never guessed into a category.
 * Sentiment is always the ticket's own structured field, never inferred
 * from free text; missing/absent is UNKNOWN (already enforced by schema
 * default). Pure Node 24 ESM, zero dependencies, zero I/O.
 */

import { PRIMARY_TAGS, SECONDARY_TAGS, KNOWN_TAGS } from "./schemas.js";

export const PRECEDENCE = ["ACCOUNT_CLOSURE", "BILLING", "TECHNICAL", "FEATURE_REQUEST"];

/**
 * Classify one ticket's issue_tags + impact + sentiment_signal.
 * Returns {category, secondary_categories, unknown_tags, priority}.
 */
export function classifyTicket(ticket) {
  const tagSet = new Set(ticket.issue_tags);
  const presentPrimary = PRECEDENCE.filter((t) => tagSet.has(t));
  const category = presentPrimary.length > 0 ? presentPrimary[0] : "OTHER";

  // "Other recognized tags" = every known tag except the one chosen as
  // the category — including a primary tag that lost precedence (e.g. a
  // ticket tagged both BILLING and TECHNICAL resolves to BILLING, and
  // keeps TECHNICAL as a secondary category, not silently dropped).
  const secondary_categories = ticket.issue_tags.filter((t) => KNOWN_TAGS.includes(t) && t !== category).sort();
  const unknown_tags = ticket.issue_tags.filter((t) => !KNOWN_TAGS.includes(t)).sort();

  let priority;
  if (category === "TECHNICAL" && ticket.impact === "OUTAGE") {
    priority = "HIGH";
  } else if (category === "ACCOUNT_CLOSURE") {
    priority = "MEDIUM";
  } else if (category === "BILLING" && ticket.sentiment_signal === "NEGATIVE") {
    priority = "MEDIUM";
  } else if (category === "FEATURE_REQUEST") {
    priority = "LOW";
  } else {
    priority = "NORMAL";
  }

  return {
    category,
    secondary_categories: [...new Set(secondary_categories)],
    unknown_tags: [...new Set(unknown_tags)],
    priority,
  };
}

export { PRIMARY_TAGS, SECONDARY_TAGS };
