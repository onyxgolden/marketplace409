/**
 * drafts.js — inert draft rendering from host-pinned templates.
 *
 * Three fixed host-pinned templates (taxonomy fixture) render one variant
 * each from verified invented fields: product_label, a benefit_id from
 * the approved benefit registry, and a cta_id from the taxonomy CTA
 * registry. Every draft is labeled "DRAFT — NOT PUBLISHED" by the
 * template itself. The renderer adds nothing: no performance or
 * compliance guarantees, no contact info, no publish instructions.
 *
 * Length: the requested max Unicode codepoints must fit the COMPLETE
 * template render; otherwise the variant is omitted with LENGTH_LIMIT —
 * never truncated, never silently altered. A post-render inertness scan
 * drops any variant that is not pure template + slots.
 */

import { scanRow } from "./injection.js";

export const DRAFT_LABEL = "DRAFT — NOT PUBLISHED";

/** Substrings that must never appear in a draft outside the fixed label. */
const INERTNESS_NEEDLES = [
  "http://",
  "https://",
  "www.",
  "@",
  "guarantee",
  "Guarantee",
  "GUARANTEE",
  "call now",
  "Call now",
  "click here",
  "Click here",
  "publish now",
  "Publish now",
  "PUBLISH NOW",
  "go live",
  "Go live",
];

function renderTemplate(text, slots) {
  return text
    .replaceAll("{product_label}", slots.product_label)
    .replaceAll("{benefit}", slots.benefit)
    .replaceAll("{cta}", slots.cta);
}

function isInert(text) {
  // The label itself contains "PUBLISHED"; needles avoid that exact word.
  return !INERTNESS_NEEDLES.some((n) => text.includes(n));
}

/**
 * Render drafts for content-brief rows. Returns { draftsByCampaign: Map,
 * unattached: [] }. 2 spans per brief row (identity + grounding), 2 per
 * draft (slot-fill evidence + length check).
 */
export function renderDrafts(wrappedRows, sx) {
  const draftsByCampaign = new Map();
  const unattached = [];
  const maxCp = sx.options.draft_max_codepoints ?? 280;

  for (const w of wrappedRows) {
    const row = w.row;
    sx.budget.chargeSpan(2); // brief identity + grounding
    const hits = scanRow("content_brief", row);
    if (hits.length > 0) {
      const h = hits[0];
      sx.quarantine(w.fixture_id, row.brief_id, h.family, `content_brief.${h.field} matched injection family ${h.family}; brief quarantined, no drafts`, w.source_ref);
      sx.diag("INSTRUCTION_INJECTION", "warning", w.source_ref, row.brief_id, `quarantined content brief (${h.family}); no drafts rendered`);
      continue;
    }
    const benefit = sx.benefits.get(row.benefit_id);
    if (!benefit) {
      sx.diag("UNSUPPORTED_BENEFIT", "warning", w.source_ref, row.brief_id, `benefit_id ${JSON.stringify(row.benefit_id)} not in the approved benefit registry; no copy rendered`);
      continue;
    }
    const cta = sx.ctas.get(row.cta_id);
    if (!cta) {
      sx.diag("UNSUPPORTED_CTA", "warning", w.source_ref, row.brief_id, `cta_id ${JSON.stringify(row.cta_id)} not in the taxonomy CTA registry; no copy rendered`);
      continue;
    }
    const templateIds = row.template_ids ?? [...sx.templates.keys()];
    for (const tid of templateIds) {
      const tpl = sx.templates.get(tid);
      if (!tpl) {
        sx.diag("UNSUPPORTED_TEMPLATE", "warning", w.source_ref, row.brief_id, `template ${JSON.stringify(tid)} is not host-pinned; no copy for it`);
        continue;
      }
      sx.budget.chargeSpan(2); // slot-fill evidence + length check
      const text = renderTemplate(tpl, {
        product_label: row.product_label,
        benefit: benefit,
        cta: cta,
      });
      if (!isInert(text)) {
        sx.diag("DRAFT_INERTNESS_VIOLATION", "warning", w.source_ref, row.brief_id, `rendered variant ${tid} failed the inertness scan; dropped`);
        continue;
      }
      const codepoints = [...text].length;
      if (codepoints > maxCp) {
        sx.diag("LENGTH_LIMIT", "warning", w.source_ref, row.brief_id, `variant ${tid} is ${codepoints} codepoints, over max ${maxCp}; omitted whole, never truncated`);
        continue;
      }
      if (!text.includes(DRAFT_LABEL)) {
        sx.diag("DRAFT_LABEL_MISSING", "warning", w.source_ref, row.brief_id, `variant ${tid} lacks the ${DRAFT_LABEL} label; dropped`);
        continue;
      }
      const draft = { brief_id: row.brief_id, template_id: tid, text, codepoints };
      if (row.campaign_id && sx.campaigns.has(row.campaign_id)) {
        if (!draftsByCampaign.has(row.campaign_id)) draftsByCampaign.set(row.campaign_id, []);
        draftsByCampaign.get(row.campaign_id).push(draft);
      } else {
        if (row.campaign_id) {
          sx.diag("BRIEF_UNATTACHED", "warning", w.source_ref, row.brief_id, `campaign ${JSON.stringify(row.campaign_id)} not registered; draft unattached`);
        }
        unattached.push(draft);
      }
    }
  }
  return { draftsByCampaign, unattached };
}
