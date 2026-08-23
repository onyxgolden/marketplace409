import { describe, expect, it } from "vitest";
import {
  buildRentecFinancialHistoryImportPreview,
  compositeSourceRecordId,
  RENTEC_HISTORY_SOURCE_SYSTEM,
} from "./rentecFinancialHistoryImportPreview.js";

const property = new Map([["10", "1218 Wagner St"]]);
const WAGNER_SLUG = "1218-wagner-st";

function rentecRow(overrides = {}) {
  return {
    transactionId: "500",
    splitId: null,
    propertyId: "10",
    renterId: "7",
    amountCents: 100000,
    transactionDate: "2020-03-01",
    categoryId: "9",
    categoryName: "Rental Income",
    bankId: "3",
    rentecOwnerId: "77",
    vendorId: null,
    checkNum: null,
    pmtType: "check",
    notes: null,
    ...overrides,
  };
}

function csvEvent(overrides = {}) {
  return {
    id: "evt-1",
    property_id: WAGNER_SLUG,
    event_date: "2020-03-01",
    description: "Rental Income",
    amount: 1000,
    transaction_kind: "income",
    normalized_category: "rental_income",
    source_system: "rentec",
    source_record_id: "rentec-2020-03-01-4-income",
    status: "active",
    is_deleted: false,
    ...overrides,
  };
}

describe("compositeSourceRecordId", () => {
  it("keeps splits of the same transaction distinct", () => {
    expect(compositeSourceRecordId("500", "1")).not.toBe(compositeSourceRecordId("500", "2"));
  });
  it("falls back to a sentinel when there is no split", () => {
    expect(compositeSourceRecordId("500", null)).toBe("500:none");
  });
});

describe("buildRentecFinancialHistoryImportPreview", () => {
  it("classifies an exact evidence match against the historical CSV import as already represented", () => {
    const preview = buildRentecFinancialHistoryImportPreview({
      rentecTransactions: [rentecRow()],
      existingFinancialEvents: [csvEvent()],
      propertyLabelById: property,
    });
    expect(preview.classificationCounts).toMatchObject({ alreadyRepresented: 1, safeMissing: 0, ambiguous: 0, conflict: 0, unsupported: 0 });
    expect(preview.items[0].classification).toBe("alreadyRepresented");
  });

  it("classifies a transaction with no matching existing record as safe missing, with full provenance metadata", () => {
    const preview = buildRentecFinancialHistoryImportPreview({
      rentecTransactions: [rentecRow({ transactionDate: "2021-04-01" })],
      existingFinancialEvents: [],
      propertyLabelById: property,
    });
    expect(preview.classificationCounts.safeMissing).toBe(1);
    const [item] = preview.items;
    expect(item.classification).toBe("safeMissing");
    expect(item.financialEventRow).toMatchObject({
      property_id: WAGNER_SLUG,
      event_date: "2021-04-01",
      amount: 1000,
      transaction_kind: "income",
      normalized_category: "rental_income",
      source_system: RENTEC_HISTORY_SOURCE_SYSTEM,
      source_record_id: "500:none",
    });
    expect(item.financialEventRow.metadata).toMatchObject({
      rentec_transaction_id: "500", rentec_split_id: null, rentec_category_id: "9", rentec_category_name: "Rental Income",
      rentec_property_id: "10", rentec_renter_id: "7", rentec_bank_id: "3", rentec_owner_id: "77",
      rentec_vendor_id: null, rentec_check_num: null, rentec_pmt_type: "check", rentec_notes: null,
    });
    expect(item.financialEventRow.metadata).not.toHaveProperty("description");
    expect(item.financialEventRow.metadata).not.toHaveProperty("memo");
  });

  it("keeps two splits of the same transaction as two distinct safe-missing rows, never collapsed", () => {
    const preview = buildRentecFinancialHistoryImportPreview({
      rentecTransactions: [
        rentecRow({ splitId: "1", amountCents: 80000, transactionDate: "2021-05-01" }),
        rentecRow({ splitId: "2", amountCents: 20000, categoryName: "CAM Income", categoryId: "2", transactionDate: "2021-05-01" }),
      ],
      existingFinancialEvents: [],
      propertyLabelById: property,
    });
    expect(preview.classificationCounts.safeMissing).toBe(2);
    const ids = preview.items.map((item) => item.sourceRecordId);
    expect(ids).toEqual(["500:1", "500:2"]);
    expect(new Set(ids).size).toBe(2);
  });

  it("re-running the importer against its own already-imported rows produces zero duplicates (idempotency)", () => {
    const row = rentecRow({ transactionDate: "2021-04-01" });
    const alreadyImported = {
      id: "evt-2", source_system: RENTEC_HISTORY_SOURCE_SYSTEM, source_record_id: compositeSourceRecordId(row.transactionId, row.splitId),
      property_id: WAGNER_SLUG, event_date: "2021-04-01", amount: 1000, transaction_kind: "income", normalized_category: "rental_income",
      status: "active", is_deleted: false,
    };
    const preview = buildRentecFinancialHistoryImportPreview({
      rentecTransactions: [row], existingFinancialEvents: [alreadyImported], propertyLabelById: property,
    });
    expect(preview.classificationCounts).toMatchObject({ alreadyRepresented: 1, safeMissing: 0 });
  });

  describe("cardinality-safe legacy overlap reconciliation (RENTEC-01-FIX #1)", () => {
    // 1 source row against 2 financially-identical existing legacy rows: the single source row is
    // definitely represented by (at least) one of them - reconciled by count, not flagged ambiguous.
    it("1-source/2-existing: a single Rentec row matching two identical existing rows is represented, not ambiguous", () => {
      const preview = buildRentecFinancialHistoryImportPreview({
        rentecTransactions: [rentecRow()],
        existingFinancialEvents: [csvEvent({ id: "evt-a" }), csvEvent({ id: "evt-b" })],
        propertyLabelById: property,
      });
      expect(preview.classificationCounts).toMatchObject({ alreadyRepresented: 1, ambiguous: 0, safeMissing: 0 });
    });

    // 2 source rows against 1 existing legacy row: exactly one of the two Rentec rows is genuinely
    // missing. Testing each row independently against the same single existing row would incorrectly
    // mark BOTH as represented, silently dropping a real missing transaction (the bug this fixes).
    it("2-source/1-existing: exactly one of two identical Rentec rows is safe missing, the other represented", () => {
      const preview = buildRentecFinancialHistoryImportPreview({
        rentecTransactions: [rentecRow({ transactionId: "500" }), rentecRow({ transactionId: "501" })],
        existingFinancialEvents: [csvEvent()],
        propertyLabelById: property,
      });
      expect(preview.classificationCounts).toMatchObject({ alreadyRepresented: 1, safeMissing: 1, ambiguous: 0 });
    });

    // 2 source rows against 2 identical existing rows: cardinalities reconcile exactly, so both are
    // represented. Testing each independently would flag both ambiguous even though nothing is
    // actually missing or uncertain in aggregate (the bug this fixes).
    it("2-source/2-existing: cardinalities reconcile exactly, so both Rentec rows are represented, not ambiguous", () => {
      const preview = buildRentecFinancialHistoryImportPreview({
        rentecTransactions: [rentecRow({ transactionId: "500" }), rentecRow({ transactionId: "501" })],
        existingFinancialEvents: [csvEvent({ id: "evt-a" }), csvEvent({ id: "evt-b" })],
        propertyLabelById: property,
      });
      expect(preview.classificationCounts).toMatchObject({ alreadyRepresented: 2, safeMissing: 0, ambiguous: 0 });
    });

    it("split rows: two splits of the same transaction that happen to share identical evidence are still both counted in the group and kept individually addressable by their own composite id", () => {
      const preview = buildRentecFinancialHistoryImportPreview({
        rentecTransactions: [
          rentecRow({ transactionId: "500", splitId: "1" }),
          rentecRow({ transactionId: "500", splitId: "2" }),
        ],
        existingFinancialEvents: [csvEvent()],
        propertyLabelById: property,
      });
      expect(preview.classificationCounts).toMatchObject({ alreadyRepresented: 1, safeMissing: 1 });
      const ids = preview.items.map((item) => item.sourceRecordId).sort();
      expect(ids).toEqual(["500:1", "500:2"]);
      expect(new Set(ids).size).toBe(2);
    });

    it("stable ordering: reconciliation always favors the earlier-indexed source row as represented, deterministically, on every run", () => {
      const transactions = [rentecRow({ transactionId: "500" }), rentecRow({ transactionId: "501" })];
      const existingFinancialEvents = [csvEvent()];
      const runOnce = () => buildRentecFinancialHistoryImportPreview({ rentecTransactions: transactions, existingFinancialEvents, propertyLabelById: property });

      const first = runOnce();
      const second = runOnce();
      expect(first.items.map((item) => item.classification)).toEqual(["alreadyRepresented", "safeMissing"]);
      expect(second.items.map((item) => item.classification)).toEqual(["alreadyRepresented", "safeMissing"]);
      // items stay in the original rentecTransactions order regardless of grouping internals.
      expect(first.items.map((item) => item.transactionId)).toEqual(["500", "501"]);
    });

    it("preserves original rentecTransactions order in the returned items array even when earlier/later rows are unrelated (different classifications interleaved)", () => {
      const preview = buildRentecFinancialHistoryImportPreview({
        rentecTransactions: [
          rentecRow({ transactionId: "500", transactionDate: "2021-01-01" }),
          rentecRow({ transactionId: "999", categoryName: "Advertising", categoryId: "8", transactionDate: "2021-01-02" }),
          rentecRow({ transactionId: "501", transactionDate: "2021-01-01" }),
        ],
        existingFinancialEvents: [csvEvent({ event_date: "2021-01-01" })],
        propertyLabelById: property,
      });
      expect(preview.items.map((item) => item.transactionId)).toEqual(["500", "999", "501"]);
      expect(preview.items.map((item) => item.classification)).toEqual(["alreadyRepresented", "unsupported", "safeMissing"]);
    });
  });

  it("flags an income category with a negative amount as a conflict (refund/reversal), never auto-imported", () => {
    const preview = buildRentecFinancialHistoryImportPreview({
      rentecTransactions: [rentecRow({ amountCents: -50000, transactionDate: "2021-06-01" })],
      existingFinancialEvents: [],
      propertyLabelById: property,
    });
    expect(preview.classificationCounts).toMatchObject({ conflict: 1, safeMissing: 0 });
  });

  it("flags an expense category with a positive amount as a conflict", () => {
    const preview = buildRentecFinancialHistoryImportPreview({
      rentecTransactions: [rentecRow({ categoryName: "Repairs", categoryId: "4", amountCents: 30000, transactionDate: "2021-06-01" })],
      existingFinancialEvents: [],
      propertyLabelById: property,
    });
    expect(preview.classificationCounts).toMatchObject({ conflict: 1, safeMissing: 0 });
  });

  it("does not flag a transfer-kind category (e.g. tenant deposit) as a conflict regardless of sign", () => {
    const preview = buildRentecFinancialHistoryImportPreview({
      rentecTransactions: [rentecRow({ categoryName: "Tenant Deposit", categoryId: "6", amountCents: -50000, transactionDate: "2021-06-01" })],
      existingFinancialEvents: [],
      propertyLabelById: property,
    });
    expect(preview.classificationCounts).toMatchObject({ safeMissing: 1, conflict: 0 });
    expect(preview.items[0].financialEventRow.transaction_kind).toBe("transfer");
  });

  it("fails closed on an unmapped category rather than defaulting it to 'other' expense", () => {
    const preview = buildRentecFinancialHistoryImportPreview({
      rentecTransactions: [rentecRow({ categoryName: "Advertising", categoryId: "8", transactionDate: "2021-06-01" })],
      existingFinancialEvents: [],
      propertyLabelById: property,
    });
    expect(preview.classificationCounts).toMatchObject({ unsupported: 1, safeMissing: 0 });
    expect(preview.items[0].reason).toContain("Advertising");
  });

  it("fails closed when the Rentec property cannot be resolved to a known property", () => {
    const preview = buildRentecFinancialHistoryImportPreview({
      rentecTransactions: [rentecRow({ propertyId: "999", transactionDate: "2021-06-01" })],
      existingFinancialEvents: [],
      propertyLabelById: property,
    });
    expect(preview.classificationCounts).toMatchObject({ unsupported: 1, safeMissing: 0 });
  });

  it("resolves an archived property the same as an active one, given its label", () => {
    const archivedProperty = new Map([["11", "42 Archived Ln"]]);
    const preview = buildRentecFinancialHistoryImportPreview({
      rentecTransactions: [rentecRow({ propertyId: "11", transactionDate: "2021-06-01" })],
      existingFinancialEvents: [],
      propertyLabelById: archivedProperty,
    });
    expect(preview.classificationCounts.safeMissing).toBe(1);
    expect(preview.items[0].financialEventRow.property_id).toBe("42-archived-ln");
  });

  it("ignores soft-deleted/inactive existing rows when matching, so a deleted duplicate does not suppress a real safe-missing import", () => {
    const preview = buildRentecFinancialHistoryImportPreview({
      rentecTransactions: [rentecRow()],
      existingFinancialEvents: [csvEvent({ is_deleted: true })],
      propertyLabelById: property,
    });
    expect(preview.classificationCounts).toMatchObject({ safeMissing: 1, alreadyRepresented: 0 });
  });

  it("computes source totals by year, matching known partial-2019/2020 overlap style data", () => {
    const preview = buildRentecFinancialHistoryImportPreview({
      rentecTransactions: [
        rentecRow({ transactionDate: "2019-11-01", amountCents: 100000 }),
        rentecRow({ transactionDate: "2020-02-01", amountCents: -20000, categoryName: "Repairs", categoryId: "4" }),
      ],
      existingFinancialEvents: [],
      propertyLabelById: property,
    });
    expect(preview.sourceTotalsByYear["2019"]).toMatchObject({ count: 1, incomeCents: 100000, expensesCents: 0 });
    expect(preview.sourceTotalsByYear["2020"]).toMatchObject({ count: 1, incomeCents: 0, expensesCents: 20000 });
  });

  describe("rerun totals include prior rentec_api imports (RENTEC-01-FIX #3)", () => {
    // A row already imported by THIS importer (source_system: rentec_api) must still count toward
    // existingSafeTotalsByYear/expectedPostImportTotalsByYear, for both income and expense - omitting
    // it would make every rerun's report understate history by exactly what the last approved import
    // already added, even though the row itself is correctly excluded from re-import via the own-id
    // check.
    it("counts a prior rentec_api income row in existingSafeTotalsByYear", () => {
      const priorImport = {
        id: "evt-prior", source_system: "rentec_api", source_record_id: "500:none",
        property_id: "1218-wagner-st", event_date: "2021-04-01", amount: 1000,
        transaction_kind: "income", normalized_category: "rental_income", status: "active", is_deleted: false,
      };
      const preview = buildRentecFinancialHistoryImportPreview({
        rentecTransactions: [], existingFinancialEvents: [priorImport], propertyLabelById: property,
      });
      expect(preview.existingSafeTotalsByYear["2021"]).toMatchObject({ incomeCents: 100000, count: 1 });
    });

    it("counts a prior rentec_api expense row in existingSafeTotalsByYear", () => {
      const priorImport = {
        id: "evt-prior", source_system: "rentec_api", source_record_id: "501:none",
        property_id: "1218-wagner-st", event_date: "2021-04-01", amount: 200,
        transaction_kind: "expense", normalized_category: "property_repairs", status: "active", is_deleted: false,
      };
      const preview = buildRentecFinancialHistoryImportPreview({
        rentecTransactions: [], existingFinancialEvents: [priorImport], propertyLabelById: property,
      });
      expect(preview.existingSafeTotalsByYear["2021"]).toMatchObject({ expensesCents: 20000, count: 1 });
    });

    it("rerun stability: expected post-import totals for a year are identical whether run before or after that year's rows were actually approved and re-fetched as rentec_api rows", () => {
      const sourceRow = rentecRow({ transactionId: "500", transactionDate: "2021-04-01", amountCents: 100000 });

      const firstRun = buildRentecFinancialHistoryImportPreview({
        rentecTransactions: [sourceRow], existingFinancialEvents: [], propertyLabelById: property,
      });
      expect(firstRun.expectedPostImportTotalsByYear["2021"]).toMatchObject({ incomeCents: 100000 });

      // Simulate approval having happened: the same transaction now exists as a rentec_api row.
      const afterApproval = {
        id: "evt-approved", source_system: "rentec_api", source_record_id: "500:none",
        property_id: "1218-wagner-st", event_date: "2021-04-01", amount: 1000,
        transaction_kind: "income", normalized_category: "rental_income", status: "active", is_deleted: false,
      };
      const secondRun = buildRentecFinancialHistoryImportPreview({
        rentecTransactions: [sourceRow], existingFinancialEvents: [afterApproval], propertyLabelById: property,
      });
      expect(secondRun.classificationCounts).toMatchObject({ alreadyRepresented: 1, safeMissing: 0 });
      // The rerun's expected total for that year must match the first run's - the row already counts
      // via existingSafeTotalsByYear now, instead of via a fresh safeMissing classification.
      expect(secondRun.expectedPostImportTotalsByYear["2021"]).toEqual(firstRun.expectedPostImportTotalsByYear["2021"]);
    });
  });

  it("performs zero writes and produces a pre-write report only (no mutation of inputs)", () => {
    const transactions = Object.freeze([rentecRow()]);
    const events = Object.freeze([csvEvent()]);
    const preview = buildRentecFinancialHistoryImportPreview({
      rentecTransactions: transactions, existingFinancialEvents: events, propertyLabelById: property,
    });
    expect(preview).toBeTypeOf("object");
    expect(Object.isFrozen(preview.items)).toBe(true);
    expect(Object.isFrozen(preview)).toBe(true);
  });

  it("never produces a rental_payments/rent_charges/settlement-shaped row — output rows are financial_events only", () => {
    const preview = buildRentecFinancialHistoryImportPreview({
      rentecTransactions: [rentecRow({ transactionDate: "2021-06-01" })],
      existingFinancialEvents: [],
      propertyLabelById: property,
    });
    const keys = Object.keys(preview.items[0].financialEventRow);
    for (const forbidden of ["rental_unit_id", "lease_id", "reconciliation_status", "approval_status", "charge_id"]) {
      expect(keys).not.toContain(forbidden);
    }
  });
});
