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
    // Every guard below (mapping, excluded-account, pending, category, exclude-treatment,
    // transfer-treatment, in-file dedup) applies uniformly to business, personal, and mixed
    // accounts alike — a personal or mixed-account row is only as safe to import as a business
    // one once it has cleared the exact same checks. Only AFTER these shared guards do business
    // rows continue on into Rentec/Plaid cash-movement overlap detection, and personal/mixed rows
    // fall through to the "personal" bucket.
    if (!row.account_mapping_id) {
      classification = "unsupported";
      reason = "Account mapping is required.";
    } else if (row.account_scope === "excluded") {
      classification = "unsupported";
      reason = "This account is explicitly excluded from import.";
    } else if (row.status === "pending") {
      classification = "pending";
      reason = "Pending transactions cannot be approved.";
    } else if (!row.category || !categoryMappings[normalized(row.category)]) {
      classification = "unsupported";
      reason = "Category mapping is required.";
    } else if (treatment === "exclude") {
      classification = "unsupported";
      reason = "This category is explicitly excluded from import.";
    } else if (treatment === "transfer") {
      // A transfer-treated row (account-to-account movement, credit-card payment, or either side
      // of a paired transfer) must never be approvable as income or expense — for ANY account
      // scope, business or personal — and must never be evaluated for Rentec/Plaid overlap or
      // safe_missing/personal status; it is money moving, not income or an expense.
      // classification="transfer_pair" reuses the schema's existing reserved enum value rather than
      // introducing a new one; approvable stays false below regardless of any future overlap logic.
      classification = "transfer_pair";
      reason = "Account transfers and credit-card payments are never counted as income or expense.";
    } else if (existingFingerprints.has(row.fingerprint)) {
      classification = "already_imported";
      reason = "This exact Simplifi transaction is already imported.";
    } else if (row.account_scope === "personal" || row.account_scope === "mixed") {
      // Personal accounts are imported (not blocked) so they're available for personal net-worth
      // and cash-flow reporting, but never touch business/rental totals — see business_scope below.
      // Mixed accounts default to personal for the same reason: relabeling individual transactions
      // to business is a future editable classification, not a prerequisite to importing history.
      // account_scope is preserved on the row (via the ...row spread) so a mixed-account default
      // can still be told apart from a genuinely personal account later.
      classification = "personal";
      reason = row.account_scope === "mixed"
        ? "Mixed-account activity is imported as personal by default; relabel individual transactions to business later."
        : "Personal activity is tracked for personal reporting but excluded from business reports.";
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
    // business_scope is the durable, editable field financial_events actually persists: every
    // approvable row is "business" except classification="personal", which must never contribute
    // to NOI, business profit, or tax totals — enforced again below by forcing affects_noi/
    // capitalized false, not just by classification string.
    const businessScope = classification === "personal" ? "personal" : "business";
    return Object.freeze({
      ...row,
      classification,
      reason,
      normalized_category: normalizedCategory,
      category_treatment: treatment,
      transaction_kind: transactionKind,
      affects_noi: businessScope === "personal" ? false : treatment === "operating",
      capitalized: businessScope === "personal" ? false : treatment === "asset_purchase",
      business_scope: businessScope,
      approvable: classification === "safe_missing" || classification === "personal",
    });
  });

  return Object.freeze({
    rows: Object.freeze(classified),
    totals: sumByClassification(classified),
    can_approve: classified.some((row) => row.approvable),
  });
}
