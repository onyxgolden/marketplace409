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

export function classifySimplifiImportPreview(rows, options = {}) {
  const existingFingerprints = new Set(options.existingFingerprints ?? []);
  const rentecOverlapFingerprints = new Set(options.rentecOverlapFingerprints ?? []);
  const plaidOverlapFingerprints = new Set(options.plaidOverlapFingerprints ?? []);
  const categoryMappings = options.categoryMappings ?? {};

  const classified = rows.map((row) => {
    let classification;
    let reason;
    if (!row.account_mapping_id) {
      classification = "unsupported";
      reason = "Account mapping is required.";
    } else if (row.status === "pending") {
      classification = "pending";
      reason = "Pending transactions cannot be approved.";
    } else if (!row.category || !categoryMappings[normalized(row.category)]) {
      classification = "unsupported";
      reason = "Category mapping is required.";
    } else if (existingFingerprints.has(row.fingerprint)) {
      classification = "already_imported";
      reason = "This exact Simplifi transaction is already imported.";
    } else if (rentecOverlapFingerprints.has(row.fingerprint)) {
      classification = "overlap_rentec";
      reason = "Rentec already represents this cash movement.";
    } else if (plaidOverlapFingerprints.has(row.fingerprint)) {
      classification = "overlap_plaid";
      reason = "Plaid already represents this cash movement.";
    } else if (row.account_scope === "personal") {
      classification = "personal";
      reason = "Personal activity is excluded from business reports.";
    } else {
      classification = "safe_missing";
      reason = "Cleared, mapped, and not represented by existing evidence.";
    }
    return Object.freeze({
      ...row,
      classification,
      reason,
      normalized_category: row.category
        ? categoryMappings[normalized(row.category)]?.normalized_category ?? null
        : null,
      approvable: classification === "safe_missing",
    });
  });

  return Object.freeze({
    rows: Object.freeze(classified),
    totals: sumByClassification(classified),
    can_approve: classified.some((row) => row.approvable),
  });
}
