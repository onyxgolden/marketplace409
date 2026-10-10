// Principal model for the AI Lab Coordinator prototype.
//
// Five fixed principal IDs (TEAM-ROSTER.md). Attribution text found in an
// artifact is DESCRIPTIVE ONLY -- it is never authentication. Resolving a
// `Submitted by:` line to a principal answers "who does this artifact claim
// to be from", never "who actually produced it". Actual provenance comes
// only from the injected trusted stores (see trusted.mjs).

export const PRINCIPALS = Object.freeze([
  "jason",
  "koe-sr",
  "koe-jr",
  "claude",
  "chatgpt",
]);

export const UNRESOLVED_MUSE = 'UNRESOLVED("muse")';

const DISPLAY_TO_PRINCIPAL = new Map([
  ["jason", "jason"],
  ["jason morgan", "jason"],
  ["koe-sr", "koe-sr"],
  ["koe sr", "koe-sr"],
  ["koe-jr", "koe-jr"],
  ["koe jr", "koe-jr"],
  ["claude", "claude"],
  ["chatgpt", "chatgpt"],
]);

export function isKnownPrincipal(id) {
  return PRINCIPALS.includes(id);
}

// Resolve an artifact's attribution to a claimed principal.
//
// Resolution order:
//   1. An explicit `principalId` field on the artifact (must be one of the
//      five fixed IDs, otherwise the claimant is unknown/untrusted).
//   2. An explicitly injected alias mapping (fixture-supplied; aliases are
//      never inferred from usage patterns).
//   3. A recognized display name ("Jason", "ChatGPT", "Claude", "koe-sr"...).
//   4. Bare "Muse" is ambiguous between koe-sr and koe-jr and resolves to
//      UNRESOLVED("muse") unless fixture-supplied session evidence (a
//      main-chat channel hint -> koe-sr, a local-implementer hint -> koe-jr)
//      disambiguates it.
//   5. Anything else is an unrecognized, untrusted principal.
//
// Returns one of:
//   { status: "principal",  principal_id, basis }
//   { status: "unresolved", principal_id: null, unresolved: UNRESOLVED_MUSE, basis }
//   { status: "unknown",    principal_id: null, claimed, basis }
export function resolveAttribution({ submittedBy, principalId, hint, aliasMap } = {}) {
  if (principalId != null && principalId !== "") {
    if (isKnownPrincipal(principalId)) {
      return { status: "principal", principal_id: principalId, basis: "explicit principal_id field" };
    }
    return {
      status: "unknown",
      principal_id: null,
      claimed: String(principalId),
      basis: "explicit principal_id is not one of the five fixed principals",
    };
  }

  const raw = submittedBy == null ? "" : String(submittedBy);
  const norm = raw.trim().toLowerCase();

  if (norm === "") {
    return { status: "unknown", principal_id: null, claimed: null, basis: "no attribution present" };
  }

  if (aliasMap && Object.prototype.hasOwnProperty.call(aliasMap, norm)) {
    const mapped = aliasMap[norm];
    if (isKnownPrincipal(mapped)) {
      return { status: "principal", principal_id: mapped, basis: "explicitly injected alias mapping" };
    }
    return {
      status: "unknown",
      principal_id: null,
      claimed: raw,
      basis: "injected alias mapping points at a non-principal",
    };
  }

  if (DISPLAY_TO_PRINCIPAL.has(norm)) {
    return {
      status: "principal",
      principal_id: DISPLAY_TO_PRINCIPAL.get(norm),
      basis: "recognized display name",
    };
  }

  if (norm === "muse") {
    if (hint && hint.channel === "main-chat") {
      return { status: "principal", principal_id: "koe-sr", basis: "disambiguated by main-chat session hint" };
    }
    if (hint && (hint.channel === "local-implementer" || hint.machine === "ibuy-power")) {
      return { status: "principal", principal_id: "koe-jr", basis: "disambiguated by local-implementer session hint" };
    }
    return {
      status: "unresolved",
      principal_id: null,
      unresolved: UNRESOLVED_MUSE,
      basis: "bare 'Muse' attribution does not distinguish koe-sr from koe-jr",
    };
  }

  return { status: "unknown", principal_id: null, claimed: raw, basis: "unrecognized principal" };
}

// Cosmetic display label only. Never used for dedup, ownership, or any
// permission decision; only ever set from an explicitly injected mapping.
export function displayAliasFor(principalId, aliasMap) {
  if (aliasMap) {
    for (const [alias, mapped] of Object.entries(aliasMap)) {
      if (mapped === principalId) return alias;
    }
  }
  return principalId;
}
