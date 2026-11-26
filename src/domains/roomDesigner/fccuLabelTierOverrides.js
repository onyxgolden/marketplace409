// Hand-ranked label tiers for the provenance-verified FCCU Plot Plan.
//
// The tier list is a HUMAN decision, made once by looking at the real
// drawing — never an algorithm, never iteration order. It applies ONLY to
// the FCCU design it was ranked for, keyed by the provenance fixture /
// project identity (`design_mwjvt635_lmexii`). Any other design — even one
// that happens to contain a tag spelled `E-101` — gets the conservative
// generic fallback below, never the FCCU ranks.
//
// Source of truth for the tag list: the tracked real fixture
// `public/phone-fixture/fccu-design-snapshot.json`, backed by
// `src/app/phone-fixture/fccu-provenance.json` (21 equipment, SHA-256
// provenance). If the fixture's tags ever differ from this manifest at
// build time, the build must STOP and ask for tier-list reapproval —
// never silently swap rankings.
//
// Tier meanings (see the scope brief, results/chatgpt/
// designer-label-layout-engine-scope-2026-11-26.md §2):
//   Tier 1 — key equipment: the ~15 tags a reader must see at a glance.
//   Tier 2 — supporting equipment: remaining pump row and racks.
//   Tier 3 — details: pipe dimensions, captions, annotations, rooms.
// Tier 3 is not listed here: anything that is not a Tier 1/2 equipment
// tag is Tier 3 by definition.

export const FCCU_LABEL_TIER_MANIFEST_VERSION = 1;

/** Provenance fixture / project identity this manifest is ranked for. */
export const FCCU_SOURCE_PROJECT_ID = "design_mwjvt635_lmexii";

/** Tier 1 tags in stable rank order (first = highest priority). */
export const FCCU_TIER_1_TAGS = Object.freeze([
  "R-101",
  "R-102",
  "T-101",
  "T-102",
  "E-101",
  "E-102",
  "E-103",
  "E-104",
  "K-101",
  "K-102",
  "V-101",
  "V-102",
  "P-101",
  "FL-101",
]);

/** Tier 2 tags in stable rank order (first = highest priority). */
export const FCCU_TIER_2_TAGS = Object.freeze([
  "P-102",
  "P-103",
  "P-104",
  "P-105",
  "P-106",
  "PR-101",
  "SL-101",
]);

const FCCU_TIER_1_RANK = new Map(FCCU_TIER_1_TAGS.map((tag, i) => [tag, i]));
const FCCU_TIER_2_RANK = new Map(FCCU_TIER_2_TAGS.map((tag, i) => [tag, i]));

/**
 * Tier + stable rank for a tag on the FCCU design, or null when this
 * manifest does not apply (wrong project identity, or a tag the human
 * list does not rank). Callers fall back to the generic policy for
 * null — they must never treat a null as Tier 1.
 */
export function fccuTierForTag({ sourceProjectId, tag } = {}) {
  if (sourceProjectId !== FCCU_SOURCE_PROJECT_ID) return null;
  if (typeof tag !== "string" || tag.length === 0) return null;
  if (FCCU_TIER_1_RANK.has(tag)) return { tier: 1, rank: FCCU_TIER_1_RANK.get(tag) };
  if (FCCU_TIER_2_RANK.has(tag)) return { tier: 2, rank: FCCU_TIER_2_RANK.get(tag) };
  return null;
}

/**
 * Generic fallback for equipment tags on any design that is NOT the
 * ranked FCCU design: Tier 2 unless explicitly flagged key (Tier 1).
 * A generic unknown equipment tag is never Tier 1 by spelling alone —
 * in particular, an `E-101` on another design is Tier 2, not the
 * FCCU exchanger rank.
 *
 * `flaggedKey` is an explicit per-instance owner/design flag (not tag
 * text). Rank within a tier falls back to tag order for determinism;
 * callers that need a stable human rank should pass `rank` explicitly.
 */
export function genericTierForEquipmentTag({ tag, flaggedKey = false } = {}) {
  if (typeof tag !== "string" || tag.length === 0) return { tier: 2, rank: 0 };
  return { tier: flaggedKey ? 1 : 2, rank: 0 };
}

/**
 * Resolve tier + rank for one equipment tag. The FCCU manifest wins
 * only on an exact project-identity match; everything else uses the
 * generic fallback. Returns `{ tier, rank, source }` where source is
 * `"fccu-manifest"` or `"generic"`.
 */
export function tierForEquipmentTag({ sourceProjectId, tag, flaggedKey = false } = {}) {
  const fccu = fccuTierForTag({ sourceProjectId, tag });
  if (fccu) return { ...fccu, source: "fccu-manifest" };
  return { ...genericTierForEquipmentTag({ tag, flaggedKey }), source: "generic" };
}

/** The 21 ranked FCCU equipment tags, Tier 1 then Tier 2, in rank order. */
export function fccuRankedTags() {
  return [...FCCU_TIER_1_TAGS, ...FCCU_TIER_2_TAGS];
}
