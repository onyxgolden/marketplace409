// Groups a Rentec financial-history preview's safeMissing items into yearly approval batches for
// the authenticated import-control UI. Kept separate from the reviewed classifier
// (rentecFinancialHistoryImportPreview.js) rather than folded into it, since RENTEC-01's review
// covered that module as shipped and this only consumes its output — a pure, additive grouping step.
//
// "Commissions" is the one category the legacy CSV importer could reclassify (via a
// description-based special case this importer never sees, since it never reads raw descriptions)
// into transaction_kind='asset_purchase' for real-estate purchases. A "Commissions" row whose
// legacy-side twin was stored as asset_purchase never evidence-matches (different kind in the
// evidence key) and surfaces as safeMissing even though the same transaction already exists under a
// different kind — approving it would create a duplicate, miscategorized financial_events row. Held
// back from every batch entirely, not just confirmed collisions, since the remainder can't be
// reliably distinguished from a genuine real-estate purchase without description text this importer
// doesn't have access to.
export function isCommissionsCategory(categoryName) {
  return String(categoryName || "").split("(")[0].trim() === "Commissions";
}

// A $0.00 transaction carries no financial impact — nothing to record — but the reviewed classifier
// doesn't filter these out (a zero amount trips neither the income- nor expense-direction conflict
// check), so they surface as safeMissing. The approval RPC correctly rejects any row with a
// non-positive amount as structurally invalid, and — because it fails closed on the *whole* batch
// if any one row is invalid — a single $0 row anywhere in a year's batch would block that entire
// year from ever being approved. Excluded here for the same reason Commissions rows are: never
// silently written, and never allowed to block everything around it either.
export function isZeroOrNegativeAmount(amount) {
  return !(Number(amount) > 0);
}

const KIND_BUCKET_KEYS = Object.freeze({ income: "incomeCents", expense: "expenseCents" });

export function buildRentecFinancialHistoryImportBatchPlan(previewItems = []) {
  const byYear = new Map();
  let heldBackCount = 0;
  let heldBackAmountCents = 0;
  let excludedZeroAmountCount = 0;

  for (const item of previewItems) {
    if (item.classification !== "safeMissing") continue;
    const cents = Math.round(item.financialEventRow.amount * 100);

    if (isCommissionsCategory(item.categoryName)) {
      heldBackCount += 1;
      heldBackAmountCents += cents;
      continue;
    }

    if (isZeroOrNegativeAmount(item.financialEventRow.amount)) {
      excludedZeroAmountCount += 1;
      continue;
    }

    const year = String(item.financialEventRow.event_date || "").slice(0, 4);
    if (!year) continue;
    const bucket = byYear.get(year) || {
      year, count: 0, incomeCents: 0, expenseCents: 0, otherCents: 0, sourceRecordIds: [],
    };
    bucket.count += 1;
    const kindKey = KIND_BUCKET_KEYS[item.financialEventRow.transaction_kind];
    if (kindKey) bucket[kindKey] += cents;
    else bucket.otherCents += cents;
    bucket.sourceRecordIds.push(item.sourceRecordId);
    byYear.set(year, bucket);
  }

  const eligibleByYear = [...byYear.values()]
    .sort((a, b) => a.year.localeCompare(b.year))
    .map((bucket) => Object.freeze({ ...bucket, sourceRecordIds: Object.freeze(bucket.sourceRecordIds) }));

  return Object.freeze({
    eligibleByYear: Object.freeze(eligibleByYear),
    heldBackCommissions: Object.freeze({ count: heldBackCount, amountCents: heldBackAmountCents }),
    excludedZeroAmountCount,
  });
}
