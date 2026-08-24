import { createHash } from "node:crypto";
import { classifySimplifiImportPreview } from "./classifySimplifiImportPreview";
import { fingerprintSimplifiRows } from "./fingerprintSimplifiRows";
import { parseSimplifiCsv } from "./parseSimplifiCsv";

const ACCOUNT_TYPES = new Set([
  "checking",
  "savings",
  "credit card",
  "loan",
  "cash",
  "investment",
  "other",
]);
const ACCOUNT_SCOPES = new Set(["business", "personal", "mixed", "excluded"]);

function normalized(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function buildAccountMappings(requestedMappings, ownerAccounts) {
  const ownerAccountsById = new Map(
    (ownerAccounts ?? []).map((account) => [String(account.id), account]),
  );
  const mappings = {};
  for (const requested of requestedMappings ?? []) {
    const label = normalized(requested?.simplifi_account_name);
    const accountId = String(requested?.forge_account_id ?? "").trim();
    if (!label) throw new Error("Every Simplifi account mapping requires a Simplifi account name.");
    if (mappings[label]) throw new Error(`Simplifi account ${label} is mapped more than once.`);

    const scope = normalized(requested.scope || "business");
    if (!ACCOUNT_SCOPES.has(scope)) throw new Error(`Unsupported Simplifi account scope: ${scope}.`);
    if (scope === "excluded" && !accountId) {
      mappings[label] = Object.freeze({
        id: `excluded:${label}`,
        account_type: "other",
        scope,
      });
      continue;
    }
    if (!accountId) throw new Error("Every included Simplifi account requires a FORGE financial account.");

    const ownerAccount = ownerAccountsById.get(accountId);
    if (!ownerAccount) throw new Error("A selected FORGE financial account does not belong to this owner.");
    const accountType = normalized(requested.account_type || ownerAccount.type || "other");
    if (!ACCOUNT_TYPES.has(accountType)) throw new Error(`Unsupported Simplifi account type: ${accountType}.`);
    mappings[label] = Object.freeze({ id: accountId, account_type: accountType, scope });
  }
  return Object.freeze(mappings);
}

function summarizeAccounts(rows) {
  const byLabel = new Map();
  for (const row of rows) {
    const current = byLabel.get(row.account_name) ?? {
      account_name: row.account_name,
      row_count: 0,
      amount_cents: 0,
      mapped: Boolean(row.account_mapping_id),
    };
    current.row_count += 1;
    current.amount_cents += row.amount_cents;
    current.mapped ||= Boolean(row.account_mapping_id);
    byLabel.set(row.account_name, current);
  }
  return Object.freeze([...byLabel.values()].map(Object.freeze));
}

export function buildSimplifiImportPreview(input) {
  const parsed = parseSimplifiCsv(input.csv, input.limits);
  const accountMappings = buildAccountMappings(input.requestedMappings, input.ownerAccounts);
  const fingerprinted = fingerprintSimplifiRows(parsed.rows, {
    accountMappings,
    secret: input.fingerprintSecret,
  });
  const classified = classifySimplifiImportPreview(fingerprinted, {
    categoryMappings: input.categoryMappings,
    existingFingerprints: input.existingFingerprints,
    rentecOverlapFingerprints: input.rentecOverlapFingerprints,
    plaidOverlapFingerprints: input.plaidOverlapFingerprints,
    overlapEvidence: input.overlapEvidence,
  });

  const previewHash = createHash("sha256").update(JSON.stringify({
    batch_hash: parsed.batch_hash,
    rows: classified.rows.map((row) => ({
      fingerprint: row.fingerprint,
      evidence_hash: row.evidence_hash,
      classification: row.classification,
      normalized_category: row.normalized_category,
      transaction_kind: row.transaction_kind,
      affects_noi: row.affects_noi,
      capitalized: row.capitalized,
    })),
  })).digest("hex");

  return Object.freeze({
    status: "preview_only",
    notice: "Preview only — no financial events were written.",
    batch_hash: parsed.batch_hash,
    preview_hash: previewHash,
    row_count: parsed.row_count,
    unknown_headers: parsed.unknown_headers,
    accounts: summarizeAccounts(classified.rows),
    totals: classified.totals,
    can_approve: classified.can_approve,
    rows: classified.rows,
  });
}
