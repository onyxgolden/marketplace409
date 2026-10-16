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
import { makeCitation, unavailableCitation } from "./citations.js";

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
    const ctaEntry = sx.ctas.get(row.cta_id);
    if (!ctaEntry) {
      sx.diag("UNSUPPORTED_CTA", "warning", w.source_ref, row.brief_id, `cta_id ${JSON.stringify(row.cta_id)} not in the taxonomy CTA registry; no copy rendered`);
      continue;
    }
    const cta = ctaEntry.text;
    const templateIds = row.template_ids ?? [...sx.templates.keys()];
    // M640-002: build verified citations for the draft's material
    // dependencies — brief row, benefit registry row, template row, CTA
    // row. Each draft carries the bytes supporting its slots.
    const depCitations = [];
    {
      const bBytes = sx.fixtureBytes.get(w.fixture_id);
      if (bBytes && w.byte_span) {
        try {
          sx.budget.chargeSpan(1);
          depCitations.push(makeCitation(bBytes, w.byte_span[0], w.byte_span[1], w.source_ref));
        } catch {
          depCitations.push(unavailableCitation("brief row bytes not verifiable", w.source_ref));
        }
      } else {
        depCitations.push(unavailableCitation("brief row bytes not retained", w.source_ref));
      }
    }
    // Benefit citation: find the benefit row's byte span.
    {
      const bfid = sx._benefitFixtureIds?.get(row.benefit_id);
      const bMeta = bfid ? sx._benefitRowMeta?.get(row.benefit_id) : null;
      if (bMeta && bMeta.byte_span) {
        const bb = sx.fixtureBytes.get(bMeta.fixture_id);
        if (bb) {
          try {
            sx.budget.chargeSpan(1);
            depCitations.push(makeCitation(bb, bMeta.byte_span[0], bMeta.byte_span[1], bMeta.source_ref));
          } catch {
            depCitations.push(unavailableCitation("benefit row bytes not verifiable", bMeta.source_ref));
          }
        } else {
          depCitations.push(unavailableCitation("benefit row bytes not retained", bMeta.source_ref));
        }
      } else {
        depCitations.push(unavailableCitation("benefit registry row not found", w.source_ref));
      }
    }
    for (const tid of templateIds) {
      const tplEntry = sx.templates.get(tid);
      if (!tplEntry) {
        sx.diag("UNSUPPORTED_TEMPLATE", "warning", w.source_ref, row.brief_id, `template ${JSON.stringify(tid)} is not host-pinned; no copy for it`);
        continue;
      }
      const tpl = tplEntry.text;
      // Template and CTA citations for this variant.
      const variantCitations = [...depCitations];
      if (tplEntry.byte_span) {
        const tb = sx.fixtureBytes.get(tplEntry.fixture_id);
        if (tb) {
          try {
            sx.budget.chargeSpan(1);
            variantCitations.push(makeCitation(tb, tplEntry.byte_span[0], tplEntry.byte_span[1], tplEntry.source_ref));
            sx.markUsed(tplEntry.fixture_id);
          } catch {
            variantCitations.push(unavailableCitation("template row bytes not verifiable", tplEntry.source_ref));
          }
        } else {
          variantCitations.push(unavailableCitation("template row bytes not retained", tplEntry.source_ref));
        }
      }
      if (ctaEntry.byte_span) {
        const cb = sx.fixtureBytes.get(ctaEntry.fixture_id);
        if (cb) {
          try {
            sx.budget.chargeSpan(1);
            variantCitations.push(makeCitation(cb, ctaEntry.byte_span[0], ctaEntry.byte_span[1], ctaEntry.source_ref));
            sx.markUsed(ctaEntry.fixture_id);
          } catch {
            variantCitations.push(unavailableCitation("CTA row bytes not verifiable", ctaEntry.source_ref));
          }
        } else {
          variantCitations.push(unavailableCitation("CTA row bytes not retained", ctaEntry.source_ref));
        }
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
      const draft = { brief_id: row.brief_id, template_id: tid, text, codepoints, citations: variantCitations };
      // M640-007: mark the brief and benefit fixtures used ONLY when a
      // draft is actually rendered (accepted-evidence consumption), not
      // on lookup. A brief ignored via include_drafts:false leaves no
      // usage trace.
      sx.markUsed(w.fixture_id);
      if (row.benefit_id && sx._benefitFixtureIds) {
        const bfid = sx._benefitFixtureIds.get(row.benefit_id);
        if (bfid) sx.markUsed(bfid);
      }
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
