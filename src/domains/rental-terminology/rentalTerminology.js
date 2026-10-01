// Rentec parity R25 — terminology customization (domain).
//
// Rentec lets owners rename "tenant" etc. throughout the UI. FORGE keeps one
// per-workspace term map (see supabase/migrations/20261001043000_rental_terminology.sql)
// and resolves every surfaced label through termLabel() in this module — the
// single domain function that turns a stored map into the right word.
//
// Adoption pattern (documented for future surfaces):
//   1. In a client component: const { termLabel } = useRentalTerminology();
//      (src/components/forge/rental/rentalTerminologyContext.jsx — the
//      provider fetches the workspace map once; without a provider it falls
//      back to defaults, so panels stay testable standalone.)
//   2. Replace the literal term in headings/labels only:
//      <h2>{termLabel("tenant", { plural: true, capitalize: true })}</h2>
//      renders "Tenants" by default, "Residents" when the workspace renamed it.
//   3. Never hard-code the default anywhere else — always go through
//      termLabel so a rename applies everywhere the pattern is used.
// The shell nav (RentalApplicationShell) applies the same map via
// applyTerminologyToNavigation(); nav item ids never change, only labels.

// The five renamable concepts. Keep this list stable: the settings table
// stores terms keyed by these names.
export const TERMINOLOGY_KEYS = Object.freeze(["tenant", "property", "lease", "owner", "vendor"]);

// Sensible defaults = the terms FORGE already uses everywhere.
export const DEFAULT_TERMS = Object.freeze({
  tenant: Object.freeze({ singular: "tenant", plural: "tenants" }),
  property: Object.freeze({ singular: "property", plural: "properties" }),
  lease: Object.freeze({ singular: "lease", plural: "leases" }),
  owner: Object.freeze({ singular: "owner", plural: "owners" }),
  vendor: Object.freeze({ singular: "vendor", plural: "vendors" }),
});

// Reasonable length limit for a custom term — long enough for "property
// manager", short enough that it can't blow up nav rails and table headers.
export const MAX_TERM_LENGTH = 40;

// A term is plain words: letters, digits, spaces, hyphens, apostrophes.
// (No markup, no emoji, no control characters.)
const TERM_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 '\-]*$/;

// Merge a stored/raw map over the defaults. Anything missing, blank, or
// malformed in the stored map silently falls back to the default term —
// resolution never throws, so a corrupt row degrades to the baseline UI.
export function resolveTermMap(raw) {
  const resolved = {};
  for (const key of TERMINOLOGY_KEYS) {
    const entry = raw && typeof raw === "object" ? raw[key] : null;
    const singular = typeof entry?.singular === "string" && entry.singular.trim() ? entry.singular.trim() : DEFAULT_TERMS[key].singular;
    const plural = typeof entry?.plural === "string" && entry.plural.trim() ? entry.plural.trim() : DEFAULT_TERMS[key].plural;
    resolved[key] = { singular, plural };
  }
  return resolved;
}

// The single term-resolution function: takes the workspace's term map and
// returns the right label — singular/plural plus capitalized variants for
// headings and nav items. Unknown keys and malformed maps fall back to the
// defaults (never throw).
export function termLabel(termMap, key, { plural = false, capitalize = false } = {}) {
  const resolved = resolveTermMap(termMap);
  const entry = resolved[key] || DEFAULT_TERMS[key] || DEFAULT_TERMS.tenant;
  let label = plural ? entry.plural : entry.singular;
  if (capitalize && label) label = label.charAt(0).toUpperCase() + label.slice(1);
  return label;
}

// Validate a workspace term map before it is stored. Rules:
//   * every key present with a non-empty singular and plural (after trimming),
//   * each term matches the plain-words pattern and is within the length limit,
//   * no term may duplicate another key's term (case-insensitive) — "resident"
//     can't be both the tenant and the owner word. Invariant terms within one
//     key are fine ("staff"/"staff" for a key is not a collision across
//     concepts).
// Returns { ok: true, clean } or { ok: false, error }.
export function validateTermMap(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "A term map is required." };
  }
  const clean = {};
  for (const key of TERMINOLOGY_KEYS) {
    const entry = input[key];
    if (!entry || typeof entry !== "object") {
      return { ok: false, error: `The "${key}" term is required.` };
    }
    const singular = String(entry.singular ?? "").trim();
    const plural = String(entry.plural ?? "").trim();
    if (!singular) return { ok: false, error: `The "${key}" singular term cannot be empty.` };
    if (!plural) return { ok: false, error: `The "${key}" plural term cannot be empty.` };
    for (const [form, value] of [["singular", singular], ["plural", plural]]) {
      if (value.length > MAX_TERM_LENGTH) {
        return { ok: false, error: `The "${key}" ${form} term must be ${MAX_TERM_LENGTH} characters or fewer.` };
      }
      if (!TERM_PATTERN.test(value)) {
        return { ok: false, error: `The "${key}" ${form} term may only contain letters, numbers, spaces, hyphens, and apostrophes.` };
      }
    }
    clean[key] = { singular, plural };
  }
  const seen = new Map();
  for (const key of TERMINOLOGY_KEYS) {
    for (const form of ["singular", "plural"]) {
      const lowered = clean[key][form].toLowerCase();
      const prior = seen.get(lowered);
      // Same-key singular/plural equality (e.g. "staff"/"staff") is not a
      // cross-concept collision — only duplicates across keys are rejected.
      if (prior && prior !== key) {
        return {
          ok: false,
          error: `"${clean[key][form]}" is already used for "${prior}" — each term must be unique across all keys.`,
        };
      }
      seen.set(lowered, key);
    }
  }
  return { ok: true, clean };
}
