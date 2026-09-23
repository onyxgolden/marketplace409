import { describe, expect, it } from "vitest";
import { buildImportedRentecHistory } from "./importedRentecHistory";

const RENTER = "renter_9";

const incomeEvent = (overrides = {}) => ({
  id: "evt_1",
  event_date: "2026-03-01",
  description: "Rent",
  amount: 1500.0,
  transaction_kind: "income",
  normalized_category: "rent_income",
  property_id: "4800-kent-ave",
  source_record_id: "txn1:splitA",
  metadata: {
    rentec_transaction_id: "txn1",
    rentec_split_id: "splitA",
    rentec_renter_id: RENTER,
  },
  status: "posted",
  is_deleted: false,
  ...overrides,
});

describe("buildImportedRentecHistory", () => {
  it("returns an empty model when the tenant has no migration renter id", () => {
    for (const renterId of [null, undefined, ""]) {
      const result = buildImportedRentecHistory({ renterId, events: [incomeEvent()], importedPaymentIds: new Set() });
      expect(result).toEqual({ renterId: null, rows: [], totalCents: 0 });
    }
  });

  it("attributes rows by exact renter-id match and stamps non-billing semantics", () => {
    const other = incomeEvent({ id: "evt_2", metadata: { rentec_transaction_id: "txn2", rentec_renter_id: "renter_other" } });
    const result = buildImportedRentecHistory({ renterId: RENTER, events: [incomeEvent(), other], importedPaymentIds: new Set() });
    expect(result.renterId).toBe(RENTER);
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.id).toBe("evt_1");
    expect(row.attribution).toBe("rentec_renter_id_match");
    expect(row.source).toBe("rentec");
    expect(row.affectsBalance).toBe(false);
    expect(row.amountCents).toBe(150000);
    expect(row.eventDate).toBe("2026-03-01");
    expect(row.description).toBe("Rent");
    expect(row.category).toBe("rent_income");
  });

  it("marks affectsBalance false on every returned row", () => {
    const result = buildImportedRentecHistory({
      renterId: RENTER,
      events: [incomeEvent(), incomeEvent({ id: "evt_2", event_date: "2026-02-01", metadata: { rentec_transaction_id: "txn2", rentec_renter_id: RENTER } })],
      importedPaymentIds: new Set(),
    });
    expect(result.rows.length).toBeGreaterThan(0);
    for (const row of result.rows) {
      expect(row.affectsBalance).toBe(false);
      expect(row.source).toBe("rentec");
    }
  });

  it("suppresses a row only via the bare transaction id, not the composite source_record_id", () => {
    // The event's source_record_id is "txn1:splitA" (composite) while its metadata
    // rentec_transaction_id is the bare "txn1". The dedup set holds bare ids from
    // rental_payments.provider_payment_id (provider='rentec_external').
    const bareSet = new Set(["txn1"]);
    const suppressed = buildImportedRentecHistory({ renterId: RENTER, events: [incomeEvent()], importedPaymentIds: bareSet });
    expect(suppressed.rows).toHaveLength(0);

    const compositeSet = new Set(["txn1:splitA"]);
    const kept = buildImportedRentecHistory({ renterId: RENTER, events: [incomeEvent()], importedPaymentIds: compositeSet });
    expect(kept.rows).toHaveLength(1);
    expect(kept.rows[0].id).toBe("evt_1");
  });

  it("does not suppress a row imported under a different provider", () => {
    // The route builds importedPaymentIds from provider='rentec_external' rows only.
    // A transaction id that exists only under another provider is absent from the
    // set, so the imported-history row stays visible.
    const stripeOnlySet = new Set(["pi_stripe_1"]);
    const result = buildImportedRentecHistory({
      renterId: RENTER,
      events: [incomeEvent({ metadata: { rentec_transaction_id: "txn1", rentec_renter_id: RENTER } })],
      importedPaymentIds: stripeOnlySet,
    });
    expect(result.rows).toHaveLength(1);
  });

  it("accepts an array for importedPaymentIds as well as a Set", () => {
    const result = buildImportedRentecHistory({ renterId: RENTER, events: [incomeEvent()], importedPaymentIds: ["txn1"] });
    expect(result.rows).toHaveLength(0);
  });

  it("sorts rows newest-first and totals the amounts", () => {
    const result = buildImportedRentecHistory({
      renterId: RENTER,
      events: [
        incomeEvent({ id: "evt_old", event_date: "2026-01-15", amount: 1200.0, metadata: { rentec_transaction_id: "txn_old", rentec_renter_id: RENTER } }),
        incomeEvent({ id: "evt_new", event_date: "2026-03-20", amount: 1500.5, metadata: { rentec_transaction_id: "txn_new", rentec_renter_id: RENTER } }),
      ],
      importedPaymentIds: new Set(),
    });
    expect(result.rows.map((row) => row.id)).toEqual(["evt_new", "evt_old"]);
    expect(result.rows[0].amountCents).toBe(150050);
    expect(result.totalCents).toBe(270050);
  });

  it("excludes non-income, deleted, and inactive rows", () => {
    const expense = incomeEvent({ id: "evt_exp", transaction_kind: "expense" });
    const deleted = incomeEvent({ id: "evt_del", is_deleted: true });
    const inactive = incomeEvent({ id: "evt_ina", status: "inactive" });
    const removed = incomeEvent({ id: "evt_rem", status: "deleted" });
    const result = buildImportedRentecHistory({
      renterId: RENTER,
      events: [incomeEvent(), expense, deleted, inactive, removed],
      importedPaymentIds: new Set(),
    });
    expect(result.rows.map((row) => row.id)).toEqual(["evt_1"]);
  });

  it("keeps rows whose event metadata lacks a bare transaction id (nothing to dedup against)", () => {
    const noTxnId = incomeEvent({
      id: "evt_notxn",
      metadata: { rentec_renter_id: RENTER },
      source_record_id: "rentec-2026-01-01-3-income",
    });
    const result = buildImportedRentecHistory({
      renterId: RENTER,
      events: [noTxnId],
      importedPaymentIds: new Set(["txn1"]),
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].rentecTransactionId).toBeNull();
  });

  it("matches renter ids by exact string equality (no numeric coercion surprises)", () => {
    const numericMeta = incomeEvent({ id: "evt_num", metadata: { rentec_transaction_id: "txnN", rentec_renter_id: 9 } });
    const byString = buildImportedRentecHistory({ renterId: "9", events: [numericMeta], importedPaymentIds: new Set() });
    expect(byString.rows).toHaveLength(1);
    const byMismatch = buildImportedRentecHistory({ renterId: "renter_9", events: [numericMeta], importedPaymentIds: new Set() });
    expect(byMismatch.rows).toHaveLength(0);
  });
});
