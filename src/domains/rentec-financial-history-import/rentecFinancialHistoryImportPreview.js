// Read-only classifier for the Rentec financial-history resume import. Reuses Financial FORGE's
// own category classification (src/domains/knowledge) rather than reinventing it, and reuses the
// same property-slug canonicalization the original historical CSV import used
// (src/domains/property/property-id.ts) so newly-imported rows line up with what's already there.
//
// Every Rentec transaction/split is classified into exactly one bucket:
//   - alreadyRepresented - an exact re-run match (same source_record_id under our own
//     source_system) or an evidence match against the historical CSV import (see the
//     group-reconciliation note below).
//   - safeMissing         - no existing row represents this transaction; safe to import.
//   - ambiguous           - reserved for a future ambiguity source; the current classification rules
//                            resolve every case deterministically (see below), so this is currently
//                            always 0, but the bucket stays part of the report schema.
//   - conflict            - the transaction's own category-implied direction (income/expense)
//                            disagrees with its actual signed amount - a likely refund/reversal/
//                            correction that must not be silently imported as ordinary rent or
//                            an ordinary expense.
//   - unsupported         - the category isn't in Financial FORGE's known category map, or the
//                            transaction's property can't be resolved to a known property. Failed
//                            closed: never guessed into a generic bucket.
//
// Legacy-CSV overlap is reconciled as evidence GROUPS, not independently per Rentec row. Every
// Rentec row that reaches evidence matching (i.e. it isn't already resolved by its own prior-run id,
// isn't unsupported, and isn't a conflict) is grouped by evidenceKey, in the same stable order the
// caller supplied rentecTransactions. Within a group, at most existingCount (the number of legacy
// financial_events rows sharing that exact evidence) is classified alreadyRepresented, in that
// stable order; any excess rows are safeMissing. This is the only sound way to reconcile
// financially-identical rows: testing each Rentec row against the same existing rows independently
// would let two distinct Rentec transactions that happen to share identical evidence both claim the
// same single existing row (silently dropping one real missing transaction), or flag every row in a
// group ambiguous even when the group's cardinalities actually reconcile exactly (e.g. 2 Rentec rows
// against 2 matching existing rows - both are safely represented, not ambiguous). Which specific
// excess-vs-represented row gets which label is arbitrary among financially-identical rows by
// definition, but the aggregate financial picture is exactly right either way, and stable ordering
// keeps a rerun deterministic before anything is actually imported (after import, the own-id check
// above takes over and grouping order stops mattering for that row).
import { PropertyId } from "@/domains/property/property-id";
import { CATEGORY_MAP } from "@/domains/knowledge/category-map";
import { categoryNormalizer } from "@/domains/knowledge/category-normalizer";

export const RENTEC_HISTORY_SOURCE_SYSTEM = "rentec_api";
export const RENTEC_HISTORY_IMPORT_GENERATION = "rentec_api_v1";
const NO_SPLIT_SENTINEL = "none";
const CLASSIFICATIONS = Object.freeze(["alreadyRepresented", "safeMissing", "ambiguous", "conflict", "unsupported"]);

// The historical CSV import's own source_record_id space
// ("rentec-{date}-{csvRowIndex}-{income|expense}") has no relationship to Rentec's real
// transaction_id/split_id - comparing against it must use evidence, never identity.
const LEGACY_CSV_SOURCE_SYSTEM = "rentec";
const UNASSIGNED_PROPERTY_KEY = "unassigned";

export function compositeSourceRecordId(transactionId, splitId) {
  return `${transactionId}:${splitId || NO_SPLIT_SENTINEL}`;
}

function resolvePropertySlug(rentecPropertyId, propertyLabelById) {
  const label = propertyLabelById.get(String(rentecPropertyId));
  if (!label) return null;
  return PropertyId.fromSourceName(label).toString();
}

function evidenceKey({ propertySlug, transactionDate, absAmountCents, transactionKind, normalizedCategory }) {
  return [propertySlug || UNASSIGNED_PROPERTY_KEY, transactionDate, absAmountCents, transactionKind, normalizedCategory].join("|");
}

function isActiveEvent(event) {
  return Boolean(event) && event.status !== "inactive" && event.status !== "deleted" && event.is_deleted !== true;
}

function yearOf(dateLike) {
  return String(dateLike || "").slice(0, 4);
}

function addToYearTotals(map, year, kind, cents) {
  if (!year) return;
  if (!map.has(year)) map.set(year, { incomeCents: 0, expensesCents: 0, count: 0 });
  const bucket = map.get(year);
  bucket.count += 1;
  if (kind === "income") bucket.incomeCents += cents;
  else if (kind === "expense") bucket.expensesCents += cents;
}

function mapToObject(map) {
  return Object.freeze(Object.fromEntries([...map.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => [key, Object.freeze({ ...value })])));
}

export function buildRentecFinancialHistoryImportPreview({
  rentecTransactions = [], existingFinancialEvents = [], propertyLabelById = new Map(),
  // rentec_api must count as a safe existing source for both income and expense - it's this
  // importer's own source_system, and omitting it here would make a rerun's "existing" and
  // "expected post-import" totals understate history by exactly what a prior approved import
  // already added (the row itself is still correctly excluded from a new import via the own-id
  // check below; this only affects the totals reported alongside that).
  safeIncomeSources = new Set(["rentec", "rentec_api", "forge_rental_payment"]),
  safeExpenseSources = new Set(["rentec", "rentec_api", "manual"]),
} = {}, { fetchedAt = new Date().toISOString() } = {}) {
  const existingByOwnSourceId = new Map();
  const existingByEvidence = new Map();
  const existingSafeTotalsByYear = new Map();

  for (const event of existingFinancialEvents) {
    if (!isActiveEvent(event)) continue;
    if (event.source_system === RENTEC_HISTORY_SOURCE_SYSTEM && event.source_record_id) {
      existingByOwnSourceId.set(event.source_record_id, event);
    }
    if (event.source_system === LEGACY_CSV_SOURCE_SYSTEM) {
      const cents = Math.round(Math.abs(Number(event.amount)) * 100);
      const key = evidenceKey({
        propertySlug: event.property_id, transactionDate: event.event_date, absAmountCents: cents,
        transactionKind: event.transaction_kind, normalizedCategory: event.normalized_category,
      });
      const list = existingByEvidence.get(key) || [];
      list.push(event);
      existingByEvidence.set(key, list);
    }
    const kind = event.transaction_kind;
    const cents = Math.round(Math.abs(Number(event.amount)) * 100);
    const isSafe = (kind === "income" && safeIncomeSources.has(event.source_system))
      || (kind === "expense" && safeExpenseSources.has(event.source_system));
    if (isSafe) addToYearTotals(existingSafeTotalsByYear, yearOf(event.event_date), kind, cents);
  }

  const results = new Array(rentecTransactions.length);
  const classificationCounts = Object.fromEntries(CLASSIFICATIONS.map((key) => [key, 0]));
  const sourceTotalsByYear = new Map();
  const expectedPostImportTotalsByYear = new Map([...existingSafeTotalsByYear.entries()].map(([year, totals]) => [year, { ...totals }]));

  // Rows that survive every early check (own-id, category, property, direction/sign) are not
  // classified immediately - they're grouped by evidenceKey (in stable, original order) so overlap
  // against the legacy CSV import can be reconciled as a group in the second pass below.
  const pendingGroups = new Map();

  rentecTransactions.forEach((row, index) => {
    const absAmountCents = Math.abs(Number(row.amountCents || 0));
    const year = yearOf(row.transactionDate);
    addToYearTotals(sourceTotalsByYear, year, row.amountCents >= 0 ? "income" : "expense", absAmountCents);

    const sourceRecordId = compositeSourceRecordId(row.transactionId, row.splitId);
    const base = {
      sourceRecordId, transactionId: row.transactionId, splitId: row.splitId,
      rentecPropertyId: row.propertyId, transactionDate: row.transactionDate,
      amountCents: row.amountCents, categoryName: row.categoryName,
    };

    const settle = (item, classification) => {
      results[index] = Object.freeze(item);
      classificationCounts[classification] += 1;
    };

    if (existingByOwnSourceId.has(sourceRecordId)) {
      settle({ ...base, classification: "alreadyRepresented", reason: "Already imported in a prior run of this importer." }, "alreadyRepresented");
      return;
    }

    const baseCategory = categoryNormalizer.extractBaseCategory(row.categoryName || "");
    const known = CATEGORY_MAP[baseCategory];
    if (!known) {
      settle({ ...base, classification: "unsupported", reason: `Category "${row.categoryName}" is not in Financial FORGE's known category map.` }, "unsupported");
      return;
    }

    const propertySlug = resolvePropertySlug(row.propertyId, propertyLabelById);
    if (row.propertyId && !propertySlug) {
      settle({ ...base, classification: "unsupported", reason: `Rentec property ${row.propertyId} could not be resolved to a known property.` }, "unsupported");
      return;
    }

    const { transactionKind, normalizedCategory, taxDeductible, affectsNOI, capitalized } = known;
    if (transactionKind === "income" && row.amountCents < 0) {
      settle({ ...base, classification: "conflict", reason: `"${row.categoryName}" is an income category but the amount is negative - a likely refund or reversal. Not imported automatically.` }, "conflict");
      return;
    }
    if (transactionKind === "expense" && row.amountCents > 0) {
      settle({ ...base, classification: "conflict", reason: `"${row.categoryName}" is an expense category but the amount is positive - a likely refund or correction. Not imported automatically.` }, "conflict");
      return;
    }

    const key = evidenceKey({ propertySlug, transactionDate: row.transactionDate, absAmountCents, transactionKind, normalizedCategory });
    const group = pendingGroups.get(key) || [];
    group.push({
      index, base, row, propertySlug, transactionKind, normalizedCategory,
      taxDeductible, affectsNOI, capitalized, absAmountCents, year,
    });
    pendingGroups.set(key, group);
  });

  for (const [key, group] of pendingGroups) {
    const existingCount = (existingByEvidence.get(key) || []).length;
    const numRepresented = Math.min(existingCount, group.length);

    group.forEach((pending, position) => {
      const { index, base } = pending;

      if (position < numRepresented) {
        results[index] = Object.freeze({ ...base, classification: "alreadyRepresented", reason: "Matches an existing historical-import record on property, date, amount, direction, and category." });
        classificationCounts.alreadyRepresented += 1;
        return;
      }

      const { row, propertySlug, transactionKind, normalizedCategory, taxDeductible, affectsNOI, capitalized, absAmountCents, year } = pending;
      const financialEventRow = Object.freeze({
        property_id: propertySlug,
        event_date: row.transactionDate,
        description: row.categoryName,
        amount: Math.round(absAmountCents) / 100,
        transaction_kind: transactionKind,
        normalized_category: normalizedCategory,
        tax_deductible: taxDeductible,
        affects_noi: affectsNOI,
        capitalized: capitalized,
        source_system: RENTEC_HISTORY_SOURCE_SYSTEM,
        source_record_id: base.sourceRecordId,
        metadata: Object.freeze({
          rentec_transaction_id: row.transactionId,
          rentec_split_id: row.splitId,
          rentec_category_id: row.categoryId,
          rentec_category_name: row.categoryName,
          rentec_property_id: row.propertyId,
          rentec_renter_id: row.renterId,
          rentec_bank_id: row.bankId,
          rentec_owner_id: row.rentecOwnerId,
          rentec_vendor_id: row.vendorId,
          rentec_check_num: row.checkNum,
          rentec_pmt_type: row.pmtType,
          rentec_notes: row.notes,
          import_generation: RENTEC_HISTORY_IMPORT_GENERATION,
          fetched_at: fetchedAt,
        }),
      });
      results[index] = Object.freeze({ ...base, classification: "safeMissing", propertySlug, financialEventRow });
      classificationCounts.safeMissing += 1;
      addToYearTotals(expectedPostImportTotalsByYear, year, transactionKind, absAmountCents);
    });
  }

  return Object.freeze({
    generatedAt: new Date().toISOString(),
    fetchedAt,
    sourceTotalsByYear: mapToObject(sourceTotalsByYear),
    classificationCounts: Object.freeze(classificationCounts),
    items: Object.freeze(results),
    existingSafeTotalsByYear: mapToObject(existingSafeTotalsByYear),
    expectedPostImportTotalsByYear: mapToObject(expectedPostImportTotalsByYear),
  });
}
