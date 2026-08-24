function normalized(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function sumByClassification(rows) {
  const result = {};
  for (const row of rows) {
    const current = result[row.classification] ?? { count: 0, amount_cents: 0 };
    result[row.classification] = {
      count: current.count + 1,
      amount_cents: current.amount_cents + row.amount_cents,
    };
  }
  return Object.freeze(result);
}

function dateDistanceDays(left, right) {
  const leftTime = Date.parse(`${left}T00:00:00Z`);
  const rightTime = Date.parse(`${right}T00:00:00Z`);
  return Math.abs(leftTime - rightTime) / 86_400_000;
}

function compatibleOverlap(row, normalizedCategory, evidence) {
  if (!evidence?.id || !evidence.event_date || !evidence.source_system) return false;
  if (Number(evidence.signed_amount_cents) !== Number(row.amount_cents)) return false;
  if (normalized(evidence.normalized_category) !== normalized(normalizedCategory)) return false;
  return dateDistanceDays(row.date, evidence.event_date) <= 7;
}

export function classifySimplifiImportPreview(rows, options = {}) {
  const existingFingerprints = new Set(options.existingFingerprints ?? []);
  const rentecOverlapFingerprints = new Set(options.rentecOverlapFingerprints ?? []);
  const plaidOverlapFingerprints = new Set(options.plaidOverlapFingerprints ?? []);
  const categoryMappings = options.categoryMappings ?? {};

  const overlapEvidence = options.overlapEvidence ?? [];
  const consumedEvidence = new Set();

  const classified = rows.map((row) => {
    let classification;
    let reason;
    const categoryMapping = row.category ? categoryMappings[normalized(row.category)] : null;
    const normalizedCategory = categoryMapping?.normalized_category ?? null;
    const treatment = categoryMapping?.treatment ?? "operating";
    const transactionKind = treatment === "asset_purchase"
      ? "asset_purchase"
      : treatment === "transfer" ? "transfer" : row.amount_cents >= 0 ? "income" : "expense";
    if (!row.account_mapping_id) {
      classification = "unsupported";
      reason = "Account mapping is required.";
    } else if (row.account_scope === "personal" || row.account_scope === "excluded") {
      classification = "personal";
      reason = row.account_scope === "excluded"
        ? "This account is explicitly excluded from import."
        : "Personal activity is excluded from business reports.";
    } else if (row.account_scope === "mixed") {
      classification = "ambiguous";
      reason = "Mixed-account activity requires transaction-level business or personal review.";
    } else if (row.status === "pending") {
      classification = "pending";
      reason = "Pending transactions cannot be approved.";
    } else if (!row.category || !categoryMappings[normalized(row.category)]) {
      classification = "unsupported";
      reason = "Category mapping is required.";
    } else if (treatment === "exclude") {
      classification = "unsupported";
      reason = "This category is explicitly excluded from import.";
    } else if (existingFingerprints.has(row.fingerprint)) {
      classification = "already_imported";
      reason = "This exact Simplifi transaction is already imported.";
    } else if (rentecOverlapFingerprints.has(row.fingerprint)) {
      classification = "overlap_rentec";
      reason = "Rentec already represents this cash movement.";
    } else if (plaidOverlapFingerprints.has(row.fingerprint)) {
      classification = "overlap_plaid";
      reason = "Plaid already represents this cash movement.";
    } else {
      const candidates = overlapEvidence.filter(
        (evidence) => !consumedEvidence.has(evidence.id) && compatibleOverlap(row, normalizedCategory, evidence),
      );
      if (candidates.length > 1) {
        classification = "ambiguous";
        reason = "Multiple existing cash movements could represent this transaction.";
      } else if (candidates.length === 1) {
        const [match] = candidates;
        consumedEvidence.add(match.id);
        if (normalized(match.source_system).startsWith("plaid")) {
          classification = "overlap_plaid";
          reason = "Plaid already represents this cash movement.";
        } else {
          classification = "overlap_rentec";
          reason = "Rentec already represents this cash movement.";
        }
      } else {
        classification = "safe_missing";
        reason = "Cleared, mapped, and not represented by existing evidence.";
      }
    }
    return Object.freeze({
      ...row,
      classification,
      reason,
      normalized_category: normalizedCategory,
      category_treatment: treatment,
      transaction_kind: transactionKind,
      affects_noi: treatment === "operating",
      capitalized: treatment === "asset_purchase",
      approvable: classification === "safe_missing",
    });
  });

  return Object.freeze({
    rows: Object.freeze(classified),
    totals: sumByClassification(classified),
    can_approve: classified.some((row) => row.approvable),
  });
}
