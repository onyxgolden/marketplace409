import { createHash, createHmac } from "node:crypto";

const FINGERPRINT_VERSION = "v2";
// The v1 format is never used to mint new fingerprints again -- it exists only so already-imported
// rows can still be recognized (see legacyFingerprintFor below). v1's bug: it treated Simplifi's
// split_identity field ("yes"/"no" -- literally "is this transaction a split?", never a unique id)
// as if a non-empty value meant "this row already has a real unique identity", so the correctly-
// computed duplicate-ordinal fallback below only ever fired for the rare row with a genuinely empty
// split_identity. Since split_identity is "yes" or "no" for virtually every real row, N otherwise-
// identical transactions (same account/date/amount/payee/category/tags/check-number) collapsed onto
// ONE v1 fingerprint, and the approval RPC's on-conflict-do-nothing then imported only the first of
// them -- silently dropping the rest as spurious "already imported" duplicates.
const LEGACY_FINGERPRINT_VERSION = "v1";

const SEP = "";

function normalized(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function stableTags(tags) {
  return [...(tags ?? [])].map(normalized).filter(Boolean).sort().join("|");
}

// Canonical transaction identity: the real evidence a Simplifi row carries, deliberately excluding
// split_identity (a split flag, not an identifier -- requirement: it must remain metadata only) and
// excluding any fingerprint-format version tag, so the same canonical group can be recognized
// whether it was first fingerprinted under v1 or v2. Fields are SEP-joined (not concatenated) so
// e.g. payee="AB", category="C" can never collide with payee="A", category="BC".
function canonicalIdentity(row, accountMappingId) {
  return [
    accountMappingId,
    row.date,
    row.amount_cents,
    normalized(row.payee),
    normalized(row.category),
    stableTags(row.tags),
    normalized(row.check_number),
  ].join(SEP);
}

// Reproduces the exact v1 HMAC input for one row, bug included, so it can be looked up against
// existing (already-imported) source_record_id values. legacyOccurrence mirrors v1's own ordinal
// counter (per canonical identity, in row order) for the rare row where split_identity was truly
// empty -- the only case v1's fallback ever actually applied.
function legacyFingerprintFor(canonical, row, legacyOccurrence, secret) {
  const splitIdentity = normalized(row.split_identity) || `duplicate-ordinal:${legacyOccurrence}`;
  const legacyEvidence = [LEGACY_FINGERPRINT_VERSION, canonical, splitIdentity].join(SEP);
  const hash = createHmac("sha256", secret).update(legacyEvidence).digest("hex");
  return `${LEGACY_FINGERPRINT_VERSION}:${hash}`;
}

function freshFingerprintFor(canonical, occurrence, secret) {
  const evidence = [FINGERPRINT_VERSION, canonical, `duplicate-ordinal:${occurrence}`].join(SEP);
  return `${FINGERPRINT_VERSION}:${createHmac("sha256", secret).update(evidence).digest("hex")}`;
}

function evidenceHashFor(canonical, row) {
  const evidence = [FINGERPRINT_VERSION, canonical, normalized(row.notes), row.status].join(SEP);
  return createHash("sha256").update(evidence).digest("hex");
}

// existingFingerprints lets recovery recognize rows already represented by a legacy (or previously
// minted fresh) fingerprint: within each canonical group, every existing fingerprint is consumed by
// at most one row (requirement: "each consume exactly one occurrence from their matching canonical
// group"), and only the rows left over after that get newly minted, guaranteed-distinct fingerprints
// -- so N truly identical rows always produce N distinct fingerprints (2, 10, or 37 alike), and a
// group with one legacy import already stored leaves exactly N-1 rows newly approvable, not zero.
export function fingerprintSimplifiRows(rows, { accountMappings, secret, existingFingerprints = [] }) {
  if (!secret || typeof secret !== "string") {
    throw new Error("Simplifi fingerprint secret is required.");
  }
  const existingSet = new Set(existingFingerprints);

  const prepared = rows.map((row) => {
    const mapping = accountMappings[normalized(row.account_name)];
    if (!mapping?.id) return { row, mapping: null };
    return { row, mapping, canonical: canonicalIdentity(row, mapping.id) };
  });

  // Row order (as given) doubles as the deterministic tiebreak for both v1-occurrence reproduction
  // and fresh-occurrence assignment. Rows sharing a canonical identity are, by definition,
  // indistinguishable in every evidence field, so which specific row claims which occurrence slot is
  // interchangeable -- only the resulting SET of fingerprints and classification counts must be
  // stable, and they are, regardless of upload row order.
  const legacyOccurrenceCounts = new Map();
  const groupOrder = [];
  const groups = new Map();
  prepared.forEach((item, index) => {
    if (!item.mapping) return;
    const legacyOccurrence = (legacyOccurrenceCounts.get(item.canonical) ?? 0) + 1;
    legacyOccurrenceCounts.set(item.canonical, legacyOccurrence);
    item.legacyFingerprint = legacyFingerprintFor(item.canonical, item.row, legacyOccurrence, secret);
    if (!groups.has(item.canonical)) {
      groups.set(item.canonical, []);
      groupOrder.push(item.canonical);
    }
    groups.get(item.canonical).push(index);
  });

  const results = new Array(rows.length);
  for (const canonical of groupOrder) {
    const claimedLegacy = new Set();
    let freshOccurrence = 0;
    for (const index of groups.get(canonical)) {
      const item = prepared[index];
      let fingerprint;
      let fingerprintVersion;
      if (existingSet.has(item.legacyFingerprint) && !claimedLegacy.has(item.legacyFingerprint)) {
        claimedLegacy.add(item.legacyFingerprint);
        fingerprint = item.legacyFingerprint;
        fingerprintVersion = LEGACY_FINGERPRINT_VERSION;
      } else {
        freshOccurrence += 1;
        fingerprint = freshFingerprintFor(canonical, freshOccurrence, secret);
        fingerprintVersion = FINGERPRINT_VERSION;
      }
      results[index] = Object.freeze({
        ...item.row,
        account_mapping_id: item.mapping.id,
        account_type: item.mapping.account_type ?? "other",
        account_scope: item.mapping.scope ?? "business",
        fingerprint_version: fingerprintVersion,
        fingerprint,
        evidence_hash: evidenceHashFor(canonical, item.row),
        duplicate_ordinal: freshOccurrence,
      });
    }
  }
  prepared.forEach((item, index) => {
    if (!item.mapping) {
      results[index] = Object.freeze({ ...item.row, account_mapping_id: null, fingerprint: null, evidence_hash: null });
    }
  });

  return Object.freeze(results);
}
