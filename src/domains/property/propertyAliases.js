// Canonical property-identity resolution for historical Rentec data.
//
// Two independent import pipelines wrote the same physical houses under different
// property_id slugs: the one-time legacy CSV import canonicalized the CSV PROPERTY
// column ("1900 W. DECKER" -> "1900-w-decker"), while the 2026-08-24 Rentec API
// import canonicalized the API's different property labels ("1900 WEST DECKER" ->
// "1900-west-decker"). Raw slugs therefore cannot be compared with ===, and
// financial_events.property_id is NOT reliably joinable across pipelines.
//
// This module is the single source of truth for that identity resolution: an
// EXPLICIT, reviewable alias map (variant slug -> canonical slug, keyed to the
// rental_units.property_id identity). Nothing fuzzy, nothing inferred. Report
// builders and the Rentec import classifier resolve through canonicalPropertySlug()
// so both pipelines' rows surface as one house in every read model, while the
// stored rows keep their original slugs (provenance preserved — identity is a
// read-layer concern, never a history rewrite).
//
// If aliases ever need to change without a deploy, move this map into a
// property_aliases table (owner_id, alias_slug, canonical_slug) and have
// canonicalPropertySlug consult it — every consumer already goes through this
// function, so the migration touches nothing else.
export const PROPERTY_ALIASES = Object.freeze({
  "185-laxon-st": "185-laxon",
  "1900-west-decker": "1900-w-decker",
  "1932-west-decker": "1932-w-decker",
  "4800-kent": "4800-kent-ave",
  "605-south-dewitt": "605-dewitt",
});

export function canonicalPropertySlug(slug) {
  if (!slug) return slug;
  return PROPERTY_ALIASES[slug] ?? slug;
}
