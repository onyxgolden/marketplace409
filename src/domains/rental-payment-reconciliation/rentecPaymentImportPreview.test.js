import { describe, expect, it } from "vitest";
import { buildRentecPaymentImportPreview, RENTEC_PAYMENT_IMPORT_CLASSIFICATIONS as C } from "./rentecPaymentImportPreview.js";

function txn(overrides = {}) {
  return { transactionId: "txn_1", renterId: "rentec_renter_1", propertyId: "rentec_property_1",
    amountCents: 150000, transactionDate: "2026-08-05", categoryName: "Rent Payment", ...overrides };
}
function tenant(overrides = {}) { return { id: "tenant_1", rentecRenterId: "rentec_renter_1", ...overrides }; }
function unit(overrides = {}) { return { id: "unit_1", rentecPropertyId: "rentec_property_1", ...overrides }; }
function lease(overrides = {}) { return { id: "lease_1", unitId: "unit_1", ...overrides }; }
function leaseTenant(overrides = {}) { return { leaseId: "lease_1", tenantId: "tenant_1", ...overrides }; }
function schedule(overrides = {}) { return { id: "schedule_1", leaseId: "lease_1", collectionMode: "external", effectiveStartDate: "2026-01-01", ...overrides }; }
function charge(overrides = {}) { return { id: "charge_1", leaseId: "lease_1", period: "2026-08", dueDate: "2026-08-01", amountCents: 150000, paidAmountCents: 0, status: "due", ...overrides }; }

function baseInput(overrides = {}) {
  return {
    rentecTransactions: [txn()], tenants: [tenant()], units: [unit()], leases: [lease()],
    leaseTenants: [leaseTenant()], schedules: [schedule()], charges: [charge()],
    alreadyImportedTransactions: [], ...overrides,
  };
}
function storedImport(overrides = {}) {
  return {
    transactionId: "txn_1", amountCents: 150000, transactionDate: "2026-08-05", categoryName: "Rent Payment",
    renterId: "rentec_renter_1", propertyId: "rentec_property_1", leaseId: "lease_1", chargeId: "charge_1", ...overrides,
  };
}

describe("buildRentecPaymentImportPreview", () => {
  it("classifies an exact-amount, exact-period match as matched", () => {
    const preview = buildRentecPaymentImportPreview(baseInput());
    expect(preview.items).toEqual([{ classification: C.MATCHED, transactionId: "txn_1", leaseId: "lease_1", chargeId: "charge_1", amountCents: 150000, isPartial: false }]);
    expect(preview.classificationCounts[C.MATCHED]).toBe(1);
  });

  it("classifies a transaction whose stored evidence still matches the fresh Rentec data as already_imported, before any other check", () => {
    const preview = buildRentecPaymentImportPreview(baseInput({ alreadyImportedTransactions: [storedImport()] }));
    expect(preview.items).toEqual([{ classification: C.ALREADY_IMPORTED, transactionId: "txn_1" }]);
  });

  it("classifies a non-rent category as ignored_non_rent, never touching lease/charge matching", () => {
    const preview = buildRentecPaymentImportPreview(baseInput({ rentecTransactions: [txn({ categoryName: "Security Deposit" })] }));
    expect(preview.items[0]).toMatchObject({ classification: C.IGNORED_NON_RENT, reason: expect.stringContaining("a security deposit") });
  });

  it("classifies a transaction with no linked FORGE tenant as unmatched — never guesses by name", () => {
    const preview = buildRentecPaymentImportPreview(baseInput({ tenants: [tenant({ rentecRenterId: "some_other_renter" })] }));
    expect(preview.items[0]).toMatchObject({ classification: C.UNMATCHED, reason: expect.stringContaining("No FORGE tenant") });
  });

  it("classifies a transaction against a FORGE-collectible (not externally-managed) lease as unmatched — out of scope for this workflow", () => {
    const preview = buildRentecPaymentImportPreview(baseInput({ schedules: [schedule({ collectionMode: "forge" })] }));
    expect(preview.items[0].classification).toBe(C.UNMATCHED);
  });

  it("classifies a lease with no open charges as unmatched", () => {
    const preview = buildRentecPaymentImportPreview(baseInput({ charges: [charge({ status: "paid", paidAmountCents: 150000 })] }));
    expect(preview.items[0].classification).toBe(C.UNMATCHED);
  });

  it("classifies multiple candidate externally-managed leases for the same tenant as ambiguous — never silently picks one", () => {
    const preview = buildRentecPaymentImportPreview(baseInput({
      rentecTransactions: [txn({ propertyId: "rentec_property_unregistered" })], // no unit resolves this property, so narrowing can't disambiguate
      leases: [lease(), lease({ id: "lease_2", unitId: "unit_2" })],
      leaseTenants: [leaseTenant(), leaseTenant({ leaseId: "lease_2" })],
      schedules: [schedule(), schedule({ id: "schedule_2", leaseId: "lease_2" })],
      units: [unit(), unit({ id: "unit_2", rentecPropertyId: "rentec_property_2" })],
    }));
    expect(preview.items[0]).toMatchObject({ classification: C.AMBIGUOUS, candidateLeaseIds: expect.arrayContaining(["lease_1", "lease_2"]) });
  });

  it("classifies two open charges with the same amount and no period match as ambiguous", () => {
    const preview = buildRentecPaymentImportPreview(baseInput({
      rentecTransactions: [txn({ transactionDate: "2026-10-05" })], // no charge has period 2026-10
      charges: [charge(), charge({ id: "charge_2", period: "2026-09", dueDate: "2026-09-01" })],
    }));
    expect(preview.items[0]).toMatchObject({ classification: C.AMBIGUOUS, candidateChargeIds: expect.arrayContaining(["charge_1", "charge_2"]) });
  });

  it("classifies two open charges sharing the transaction's period (but different amounts) as ambiguous", () => {
    const preview = buildRentecPaymentImportPreview(baseInput({
      charges: [charge({ amountCents: 100000 }), charge({ id: "charge_2", amountCents: 200000 })],
    }));
    expect(preview.items[0]).toMatchObject({ classification: C.AMBIGUOUS, candidateChargeIds: expect.arrayContaining(["charge_1", "charge_2"]) });
  });

  it("classifies an amount exceeding the matched charge's remaining balance as conflict — never overpays", () => {
    const preview = buildRentecPaymentImportPreview(baseInput({
      rentecTransactions: [txn({ amountCents: 200000 })],
      charges: [charge({ amountCents: 150000, paidAmountCents: 0 })],
    }));
    expect(preview.items[0]).toMatchObject({ classification: C.CONFLICT, chargeId: "charge_1", amountCents: 200000, remainingCents: 150000 });
  });

  it("matches a partial payment against a charge's period without requiring the full remaining balance", () => {
    const preview = buildRentecPaymentImportPreview(baseInput({
      rentecTransactions: [txn({ amountCents: 50000 })],
      charges: [charge({ amountCents: 150000, paidAmountCents: 0 })],
    }));
    expect(preview.items[0]).toEqual({ classification: C.MATCHED, transactionId: "txn_1", leaseId: "lease_1", chargeId: "charge_1", amountCents: 50000, isPartial: true });
  });

  it("matches by exact remaining-balance amount even when the transaction date falls in a different period (late payment)", () => {
    const preview = buildRentecPaymentImportPreview(baseInput({
      rentecTransactions: [txn({ transactionDate: "2026-09-03", amountCents: 150000 })],
      charges: [charge({ period: "2026-08", dueDate: "2026-08-01", amountCents: 150000, paidAmountCents: 0 })],
    }));
    expect(preview.items[0]).toMatchObject({ classification: C.MATCHED, chargeId: "charge_1" });
  });

  it("never matches by tenant name or any identity other than the linked rentecRenterId — a same-property, different-renter transaction is unmatched", () => {
    const preview = buildRentecPaymentImportPreview(baseInput({ rentecTransactions: [txn({ renterId: "unlinked_renter_999" })] }));
    expect(preview.items[0].classification).toBe(C.UNMATCHED);
  });

  it("ignores void charges entirely when resolving candidates", () => {
    const preview = buildRentecPaymentImportPreview(baseInput({
      charges: [charge({ status: "void" }), charge({ id: "charge_2", amountCents: 150000 })],
    }));
    expect(preview.items[0]).toMatchObject({ classification: C.MATCHED, chargeId: "charge_2" });
  });

  it("narrows candidate leases by the transaction's property reference when the tenant has multiple externally-managed leases", () => {
    const preview = buildRentecPaymentImportPreview(baseInput({
      leases: [lease(), lease({ id: "lease_2", unitId: "unit_2" })],
      leaseTenants: [leaseTenant(), leaseTenant({ leaseId: "lease_2" })],
      schedules: [schedule(), schedule({ id: "schedule_2", leaseId: "lease_2" })],
      units: [unit(), unit({ id: "unit_2", rentecPropertyId: "rentec_property_2" })],
      charges: [charge(), charge({ id: "charge_2", leaseId: "lease_2" })],
    }));
    expect(preview.items[0]).toMatchObject({ classification: C.MATCHED, leaseId: "lease_1", chargeId: "charge_1" });
  });

  it("resolves the lease's active schedule as the one with the most recent effectiveStartDate", () => {
    const preview = buildRentecPaymentImportPreview(baseInput({
      schedules: [
        schedule({ id: "old", effectiveStartDate: "2026-01-01", collectionMode: "forge" }),
        schedule({ id: "new", effectiveStartDate: "2026-06-01", collectionMode: "external" }),
      ],
    }));
    expect(preview.items[0].classification).toBe(C.MATCHED);
  });

  it("returns frozen items and counts summing to the transaction count", () => {
    const preview = buildRentecPaymentImportPreview(baseInput());
    expect(Object.isFrozen(preview.items)).toBe(true);
    expect(Object.isFrozen(preview.classificationCounts)).toBe(true);
    const total = Object.values(preview.classificationCounts).reduce((a, b) => a + b, 0);
    expect(total).toBe(1);
  });

  // Gap 1: transaction-type filtering. Category eligibility is an allowlist, never inferred from
  // amount, tenant, date, or a matching charge — a transaction that would otherwise match perfectly
  // is still excluded if its category isn't a recognized rent payment.
  describe("transaction-type filtering", () => {
    it("accepts a genuine rent-payment category", () => {
      const preview = buildRentecPaymentImportPreview(baseInput({ rentecTransactions: [txn({ categoryName: "Rent" })] }));
      expect(preview.items[0].classification).toBe(C.MATCHED);
    });

    it.each([
      ["Security Deposit", "a security deposit"],
      ["Late Fee", "a late fee or other charge"],
      ["Other Charge", "a late fee or other charge"],
      ["Refund", "a refund"],
      ["Payment Reversal", "a reversal"],
      ["Owner Contribution", "an owner contribution"],
      ["Owner Draw", "an owner contribution"],
      ["Transfer Between Accounts", "a transfer"],
      ["Vendor Payment", "a vendor transaction"],
      ["Accounts Payable", "a vendor transaction"],
      ["Journal Adjustment", "an accounting adjustment"],
      ["Returned Payment", "a returned payment"],
      ["NSF Fee", "a returned payment"],
    ])("rejects the non-rent category %s as ignored_non_rent, citing %s", (categoryName, expectedReasonFragment) => {
      const preview = buildRentecPaymentImportPreview(baseInput({ rentecTransactions: [txn({ categoryName })] }));
      expect(preview.items[0]).toMatchObject({ classification: C.IGNORED_NON_RENT, reason: expect.stringContaining(expectedReasonFragment) });
    });

    it("fails closed on an unrecognized/undocumented category — never imports on ambiguity", () => {
      const preview = buildRentecPaymentImportPreview(baseInput({ rentecTransactions: [txn({ categoryName: "Miscellaneous Ledger Entry #4471" })] }));
      expect(preview.items[0]).toMatchObject({ classification: C.IGNORED_NON_RENT, reason: expect.stringContaining("not a recognized rent-payment type") });
    });

    it("fails closed when no category is provided at all", () => {
      const preview = buildRentecPaymentImportPreview(baseInput({ rentecTransactions: [txn({ categoryName: "" })] }));
      expect(preview.items[0]).toMatchObject({ classification: C.IGNORED_NON_RENT, reason: expect.stringContaining("No Rentec transaction category was provided") });
    });

    it("does not infer a rent payment solely from a positive amount, a linked tenant, a matching date, or a matching charge — an unrecognized category still fails closed even when every other signal lines up perfectly", () => {
      const preview = buildRentecPaymentImportPreview(baseInput({ rentecTransactions: [txn({ categoryName: "General Ledger Entry" })] }));
      expect(preview.items[0].classification).toBe(C.IGNORED_NON_RENT);
    });

    it("rejects a negative-amount transaction under an otherwise rent-like category as conflict — never treats the wrong debit/credit direction as a payment", () => {
      const preview = buildRentecPaymentImportPreview(baseInput({ rentecTransactions: [txn({ categoryName: "Rent", amountCents: -150000 })] }));
      expect(preview.items[0]).toMatchObject({ classification: C.CONFLICT, reason: expect.stringContaining("not a positive debit") });
    });

    it("rejects a zero-amount transaction under a rent-like category as conflict", () => {
      const preview = buildRentecPaymentImportPreview(baseInput({ rentecTransactions: [txn({ categoryName: "Rent", amountCents: 0 })] }));
      expect(preview.items[0].classification).toBe(C.CONFLICT);
    });
  });

  // Gap 2: imported-source drift detection. already_imported is only ever returned when the fresh
  // Rentec evidence still matches what was stored at apply time — any drift, or the transaction
  // disappearing from Rentec entirely, is a conflict instead, and never alters the stored evidence
  // or implies the previously applied FORGE payment was touched.
  describe("imported-source drift detection", () => {
    it("returns already_imported only when amount, date, category, and both renter/property attribution are unchanged", () => {
      const preview = buildRentecPaymentImportPreview(baseInput({ alreadyImportedTransactions: [storedImport()] }));
      expect(preview.items).toEqual([{ classification: C.ALREADY_IMPORTED, transactionId: "txn_1" }]);
    });

    it("classifies a changed amount as conflict, not already_imported", () => {
      const preview = buildRentecPaymentImportPreview(baseInput({
        rentecTransactions: [txn({ amountCents: 175000 })],
        alreadyImportedTransactions: [storedImport({ amountCents: 150000 })],
      }));
      expect(preview.items).toEqual([{ classification: C.CONFLICT, transactionId: "txn_1", leaseId: "lease_1", chargeId: "charge_1",
        reason: expect.stringContaining("amount") }]);
    });

    it("classifies a changed date as conflict", () => {
      const preview = buildRentecPaymentImportPreview(baseInput({
        rentecTransactions: [txn({ transactionDate: "2026-08-20" })],
        alreadyImportedTransactions: [storedImport({ transactionDate: "2026-08-05" })],
      }));
      expect(preview.items[0]).toMatchObject({ classification: C.CONFLICT, reason: expect.stringContaining("date") });
    });

    it("classifies a changed category/type as conflict", () => {
      const preview = buildRentecPaymentImportPreview(baseInput({
        rentecTransactions: [txn({ categoryName: "Refund" })],
        alreadyImportedTransactions: [storedImport({ categoryName: "Rent Payment" })],
      }));
      expect(preview.items[0]).toMatchObject({ classification: C.CONFLICT, reason: expect.stringContaining("transaction type") });
    });

    it("classifies a changed renter/property attribution (reassigned in Rentec) as conflict", () => {
      const preview = buildRentecPaymentImportPreview(baseInput({
        rentecTransactions: [txn({ renterId: "rentec_renter_different" })],
        alreadyImportedTransactions: [storedImport({ renterId: "rentec_renter_1" })],
      }));
      expect(preview.items[0]).toMatchObject({ classification: C.CONFLICT, reason: expect.stringContaining("renter attribution") });
    });

    it("classifies a transaction that no longer appears in Rentec at all (deleted, voided, or reversed) as conflict, not already_imported", () => {
      const preview = buildRentecPaymentImportPreview(baseInput({
        rentecTransactions: [], // vanished from the fresh fetch entirely
        alreadyImportedTransactions: [storedImport()],
      }));
      expect(preview.items).toEqual([{ classification: C.CONFLICT, transactionId: "txn_1", leaseId: "lease_1", chargeId: "charge_1",
        reason: expect.stringContaining("no longer appears in Rentec") }]);
    });

    it("a drift conflict is a pure classification result — it carries no instruction or field that could mutate a balance or write an audit row; only an owner-approved, freshly-rematched 'matched' item can ever do that", () => {
      const preview = buildRentecPaymentImportPreview(baseInput({
        rentecTransactions: [txn({ amountCents: 175000 })],
        alreadyImportedTransactions: [storedImport({ amountCents: 150000 })],
      }));
      const [conflictItem] = preview.items;
      expect(conflictItem.classification).toBe(C.CONFLICT);
      expect(conflictItem).not.toHaveProperty("paymentId");
      expect(conflictItem).not.toHaveProperty("status", "applied");
    });
  });
});
