import { createHash, createHmac } from "node:crypto";

const FINGERPRINT_VERSION = "v1";

function normalized(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function stableTags(tags) {
  return [...(tags ?? [])].map(normalized).filter(Boolean).sort().join("|");
}

function primaryEvidence(row, accountMappingId) {
  return [
    FINGERPRINT_VERSION,
    accountMappingId,
    row.date,
    row.amount_cents,
    normalized(row.payee),
    normalized(row.category),
    stableTags(row.tags),
    normalized(row.check_number),
  ].join("\u001f");
}

export function fingerprintSimplifiRows(rows, { accountMappings, secret }) {
  if (!secret || typeof secret !== "string") {
    throw new Error("Simplifi fingerprint secret is required.");
  }
  const occurrenceCounts = new Map();
  return Object.freeze(
    rows.map((row) => {
      const mapping = accountMappings[normalized(row.account_name)];
      if (!mapping?.id) {
        return Object.freeze({ ...row, account_mapping_id: null, fingerprint: null, evidence_hash: null });
      }
      const evidence = primaryEvidence(row, mapping.id);
      const occurrence = (occurrenceCounts.get(evidence) ?? 0) + 1;
      occurrenceCounts.set(evidence, occurrence);
      const splitIdentity = normalized(row.split_identity) || `duplicate-ordinal:${occurrence}`;
      const fingerprint = createHmac("sha256", secret)
        .update(`${evidence}\u001f${splitIdentity}`)
        .digest("hex");
      const evidenceHash = createHash("sha256")
        .update(`${evidence}\u001f${normalized(row.notes)}\u001f${row.status}`)
        .digest("hex");
      return Object.freeze({
        ...row,
        account_mapping_id: mapping.id,
        account_type: mapping.account_type ?? "other",
        account_scope: mapping.scope ?? "business",
        fingerprint_version: FINGERPRINT_VERSION,
        fingerprint: `${FINGERPRINT_VERSION}:${fingerprint}`,
        evidence_hash: evidenceHash,
        duplicate_ordinal: occurrence,
      });
    }),
  );
}
