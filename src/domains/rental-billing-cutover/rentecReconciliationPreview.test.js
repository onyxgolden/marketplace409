import { describe, expect, it } from "vitest";
import { buildRentecReconciliationPreview, RECONCILIATION_CLASSIFICATIONS as C } from "./rentecReconciliationPreview.js";

function charge(overrides = {}) {
  return { id: "charge_1", leaseId: "lease_1", period: "2026-08", amountCents: 150000, paidAmountCents: 0, status: "due", dueDate: "2026-08-01", ...overrides };
}
function schedule(overrides = {}) {
  return { id: "schedule_1", leaseId: "lease_1", collectionMode: "forge", forgeCutoverDate: "2026-08-01", effectiveStartDate: "2026-08-01", ...overrides };
}
function transaction(overrides = {}) {
  return { id: "rentec_txn_1", leaseId: "lease_1", amountCents: 150000, transactionDate: "2026-08-02", period: "2026-08", ...overrides };
}

describe("buildRentecReconciliationPreview", () => {
  it("classifies a matching lease/period/amount as a confident match", () => {
    const preview = buildRentecReconciliationPreview({ rentecTransactions: [transaction()], forgeCharges: [charge()], schedules: [schedule()] });
    expect(preview.items).toEqual([{ classification: C.CONFIDENT_MATCH, rentecTransactionId: "rentec_txn_1", chargeId: "charge_1", leaseId: "lease_1", period: "2026-08", amountCents: 150000 }]);
    expect(preview.classificationCounts[C.CONFIDENT_MATCH]).toBe(1);
  });

  it("classifies a matching lease/period with a different amount as a possible match requiring review", () => {
    const preview = buildRentecReconciliationPreview({ rentecTransactions: [transaction({ amountCents: 140000 })], forgeCharges: [charge()], schedules: [schedule()] });
    expect(preview.items[0]).toMatchObject({ classification: C.POSSIBLE_MATCH, rentecAmountCents: 140000, forgeAmountCents: 150000 });
  });

  it("classifies a FORGE charge with no Rentec evidence, when the schedule is FORGE and the charge is on/after cutover", () => {
    const preview = buildRentecReconciliationPreview({ rentecTransactions: [], forgeCharges: [charge()], schedules: [schedule()] });
    expect(preview.items).toEqual([{ classification: C.CHARGE_WITHOUT_EVIDENCE, chargeId: "charge_1", leaseId: "lease_1", period: "2026-08", amountCents: 150000, reason: expect.any(String) }]);
  });

  it("classifies a Rentec payment with no matching FORGE charge", () => {
    const preview = buildRentecReconciliationPreview({ rentecTransactions: [transaction()], forgeCharges: [], schedules: [schedule()] });
    expect(preview.items).toEqual([{ classification: C.PAYMENT_WITHOUT_CHARGE, rentecTransactionId: "rentec_txn_1", leaseId: "lease_1", period: "2026-08", reason: expect.any(String) }]);
  });

  it("classifies a FORGE charge dated before the lease's cutover as pre-cutover, regardless of Rentec evidence", () => {
    const preview = buildRentecReconciliationPreview({
      rentecTransactions: [],
      forgeCharges: [charge({ dueDate: "2026-07-01", period: "2026-07" })],
      schedules: [schedule()],
    });
    expect(preview.items).toEqual([{ classification: C.PRE_CUTOVER_CHARGE, chargeId: "charge_1", leaseId: "lease_1", period: "2026-07", reason: expect.any(String) }]);
  });

  it("classifies a FORGE charge for a lease with no forge schedule at all as pre-cutover — this is exactly the externally-managed reconciliation-required containment case", () => {
    const preview = buildRentecReconciliationPreview({
      rentecTransactions: [],
      forgeCharges: [charge()],
      schedules: [schedule({ collectionMode: "external", forgeCutoverDate: null })],
    });
    expect(preview.items[0].classification).toBe(C.PRE_CUTOVER_CHARGE);
  });

  it("classifies a partially-paid FORGE charge with no external evidence as a true unpaid opening balance", () => {
    const preview = buildRentecReconciliationPreview({
      rentecTransactions: [],
      forgeCharges: [charge({ paidAmountCents: 50000 })],
      schedules: [schedule()],
    });
    expect(preview.items).toEqual([{ classification: C.TRUE_OPENING_BALANCE, chargeId: "charge_1", leaseId: "lease_1", period: "2026-08", remainingCents: 100000, reason: expect.any(String) }]);
  });

  it("classifies two Rentec transactions for the same lease/period as duplicate or ambiguous", () => {
    const preview = buildRentecReconciliationPreview({
      rentecTransactions: [transaction({ id: "t1" }), transaction({ id: "t2" })],
      forgeCharges: [charge()],
      schedules: [schedule()],
    });
    expect(preview.items).toHaveLength(2);
    expect(preview.items.every((item) => item.classification === C.DUPLICATE_OR_AMBIGUOUS)).toBe(true);
  });

  it("classifies two FORGE charges for the same lease/period as duplicate or ambiguous", () => {
    const preview = buildRentecReconciliationPreview({
      rentecTransactions: [transaction()],
      forgeCharges: [charge({ id: "c1" }), charge({ id: "c2" })],
      schedules: [schedule()],
    });
    expect(preview.items).toEqual([{ classification: C.DUPLICATE_OR_AMBIGUOUS, rentecTransactionId: "rentec_txn_1", leaseId: "lease_1", period: "2026-08", reason: expect.any(String) }]);
  });

  it("never matches by name/tenant alone — only lease+period+amount evidence drives classification", () => {
    // Same tenant-ish label implied by lease_1 in both, but different leases entirely — must not merge.
    const preview = buildRentecReconciliationPreview({
      rentecTransactions: [transaction({ leaseId: "lease_2" })],
      forgeCharges: [charge({ leaseId: "lease_1" })],
      schedules: [schedule({ leaseId: "lease_1" }), schedule({ id: "schedule_2", leaseId: "lease_2" })],
    });
    expect(preview.items).toHaveLength(2);
    expect(preview.items.find((i) => i.classification === C.PAYMENT_WITHOUT_CHARGE)).toBeTruthy();
    expect(preview.items.find((i) => i.classification === C.CHARGE_WITHOUT_EVIDENCE)).toBeTruthy();
  });

  it("rerunning with an already-reconciled transaction/charge pair excludes both from the preview — idempotent, never reclassified or re-flagged", () => {
    const preview = buildRentecReconciliationPreview({
      rentecTransactions: [transaction()],
      forgeCharges: [charge()],
      schedules: [schedule()],
      alreadyReconciled: [{ rentecTransactionId: "rentec_txn_1", chargeId: "charge_1" }],
    });
    expect(preview.items).toEqual([]);
  });

  it("ignores an already-voided FORGE charge entirely", () => {
    const preview = buildRentecReconciliationPreview({
      rentecTransactions: [],
      forgeCharges: [charge({ status: "void" })],
      schedules: [schedule()],
    });
    expect(preview.items).toEqual([]);
  });

  it("resolves the lease's schedule as the one with the most recent effective_start_date when multiple exist", () => {
    const preview = buildRentecReconciliationPreview({
      rentecTransactions: [],
      forgeCharges: [charge({ dueDate: "2026-08-01" })],
      schedules: [
        schedule({ id: "old", effectiveStartDate: "2026-01-01", collectionMode: "external", forgeCutoverDate: null }),
        schedule({ id: "new", effectiveStartDate: "2026-07-01", collectionMode: "forge", forgeCutoverDate: "2026-08-01" }),
      ],
    });
    expect(preview.items[0].classification).toBe(C.CHARGE_WITHOUT_EVIDENCE);
  });
});
