import { describe, it, expect } from "vitest";
import { buildPropertyLedger } from "./propertyLedger";

const PROP = "prop_1";
const UNIT = "unit_1";

function baseInput(overrides = {}) {
  return {
    propertyId: PROP,
    propertyLabel: "308 Paula",
    unitIds: [UNIT],
    financialEvents: [],
    contractorPayments: [],
    contractors: [],
    rentalPayments: [],
    leases: [],
    tenantsById: {},
    ...overrides,
  };
}

describe("buildPropertyLedger", () => {
  it("posts expenses to Debit and income to Credit with a running balance", () => {
    const ledger = buildPropertyLedger(baseInput({
      financialEvents: [
        { id: "e1", property_id: PROP, event_date: "2026-08-01", description: "Rent", amount: "1600.00", transaction_kind: "income", normalized_category: "rental_income", source_system: "manual", status: "active", is_deleted: false, metadata: {} },
        { id: "e2", property_id: PROP, event_date: "2026-08-05", description: "Home Depot", amount: "88.41", transaction_kind: "expense", normalized_category: "supplies", source_system: "manual", status: "active", is_deleted: false, metadata: {} },
      ],
    }));
    // Display order is newest first; balance is computed chronologically.
    expect(ledger.entries).toHaveLength(2);
    expect(ledger.entries[0].id).toBe("event:e2");
    expect(ledger.entries[0].debitCents).toBe(8841);
    expect(ledger.entries[0].creditCents).toBe(0);
    expect(ledger.entries[0].balanceAfterCents).toBe(160000 - 8841);
    expect(ledger.entries[1].id).toBe("event:e1");
    expect(ledger.entries[1].debitCents).toBe(0);
    expect(ledger.entries[1].creditCents).toBe(160000);
    expect(ledger.entries[1].balanceAfterCents).toBe(160000);
    expect(ledger.totalDebitCents).toBe(8841);
    expect(ledger.totalCreditCents).toBe(160000);
    expect(ledger.balanceCents).toBe(160000 - 8841);
  });

  it("includes succeeded rental payments as rental income via their lease", () => {
    const ledger = buildPropertyLedger(baseInput({
      leases: [{ id: "lease_1", property_id: PROP, unit_id: UNIT }],
      rentalPayments: [
        { id: "pay_1", lease_id: "lease_1", tenant_id: "t1", amount_cents: 160000, refunded_amount_cents: 0, status: "succeeded", provider: "stripe", received_at: "2026-09-01T10:00:00Z" },
      ],
      tenantsById: { t1: { display_name: "Eric Carrillo" } },
    }));
    expect(ledger.entries).toHaveLength(1);
    const entry = ledger.entries[0];
    expect(entry.creditCents).toBe(160000);
    expect(entry.debitCents).toBe(0);
    expect(entry.description).toContain("Eric Carrillo");
    expect(entry.category).toBe("Rental income");
  });

  it("excludes failed payments from the balance but keeps them visible", () => {
    const ledger = buildPropertyLedger(baseInput({
      leases: [{ id: "lease_1", property_id: PROP, unit_id: UNIT }],
      rentalPayments: [
        { id: "pay_1", lease_id: "lease_1", tenant_id: "t1", amount_cents: 160000, refunded_amount_cents: 0, status: "failed", provider: "stripe", created_at: "2026-09-01T10:00:00Z" },
      ],
    }));
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0].creditCents).toBe(0);
    expect(ledger.balanceCents).toBe(0);
    expect(ledger.entries[0].notes).toContain("failed");
  });

  it("ignores payments on other properties' leases", () => {
    const ledger = buildPropertyLedger(baseInput({
      leases: [{ id: "lease_9", property_id: "prop_other", unit_id: "unit_other" }],
      rentalPayments: [
        { id: "pay_1", lease_id: "lease_9", tenant_id: "t1", amount_cents: 160000, refunded_amount_cents: 0, status: "succeeded", provider: "stripe", received_at: "2026-09-01T10:00:00Z" },
      ],
    }));
    expect(ledger.entries).toHaveLength(0);
  });

  it("includes contractor payments as debits", () => {
    const ledger = buildPropertyLedger(baseInput({
      contractorPayments: [
        { id: "cp1", property_id: PROP, paid_at: "2026-08-10", amount_cents: 45000, contractor_id: "c1", payment_method: "check" },
      ],
      contractors: [{ id: "c1", business_name: "BC Roofing", trade: "Roofing" }],
    }));
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0].debitCents).toBe(45000);
    expect(ledger.entries[0].description).toBe("BC Roofing");
    expect(ledger.balanceCents).toBe(-45000);
  });

  it("collapses a financial event explicitly linked to a contractor payment when amounts agree", () => {
    const ledger = buildPropertyLedger(baseInput({
      contractorPayments: [
        { id: "cp1", property_id: PROP, paid_at: "2026-08-10", amount_cents: 45000, contractor_id: "c1" },
      ],
      financialEvents: [
        { id: "e1", property_id: PROP, event_date: "2026-08-10", description: "Roof", amount: "450.00", transaction_kind: "expense", normalized_category: "property_repairs", source_system: "manual", source_record_id: "rental_contractor_payment_cp1", status: "active", is_deleted: false, metadata: {} },
      ],
    }));
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0].id).toBe("contractor:cp1");
    expect(ledger.suppressedDuplicateCount).toBe(1);
  });

  it("flags same amount+date across sources as possible duplicates without collapsing", () => {
    const ledger = buildPropertyLedger(baseInput({
      financialEvents: [
        { id: "e1", property_id: PROP, event_date: "2026-09-01", description: "Rent posted manually", amount: "1600.00", transaction_kind: "income", normalized_category: "rental_income", source_system: "manual", status: "active", is_deleted: false, metadata: {} },
      ],
      leases: [{ id: "lease_1", property_id: PROP, unit_id: UNIT }],
      rentalPayments: [
        { id: "pay_1", lease_id: "lease_1", tenant_id: "t1", amount_cents: 160000, refunded_amount_cents: 0, status: "succeeded", provider: "stripe", received_at: "2026-09-01T12:00:00Z" },
      ],
    }));
    expect(ledger.entries).toHaveLength(2);
    expect(ledger.possibleDuplicateCount).toBe(2);
    // Both still move the balance — the owner resolves the duplication by deleting one.
    expect(ledger.totalCreditCents).toBe(320000);
  });

  it("skips deleted, inactive, and unsafe-source events", () => {
    const ledger = buildPropertyLedger(baseInput({
      financialEvents: [
        { id: "e1", property_id: PROP, event_date: "2026-08-01", description: "Deleted", amount: "10.00", transaction_kind: "expense", source_system: "manual", status: "active", is_deleted: true, metadata: {} },
        { id: "e2", property_id: PROP, event_date: "2026-08-01", description: "Inactive", amount: "10.00", transaction_kind: "expense", source_system: "manual", status: "inactive", is_deleted: false, metadata: {} },
        { id: "e3", property_id: PROP, event_date: "2026-08-01", description: "Bank feed", amount: "10.00", transaction_kind: "expense", source_system: "plaid", status: "active", is_deleted: false, metadata: {} },
      ],
    }));
    expect(ledger.entries).toHaveLength(0);
  });

  it("matches events scoped to a unit id as well as the property id", () => {
    const ledger = buildPropertyLedger(baseInput({
      financialEvents: [
        { id: "e1", property_id: UNIT, event_date: "2026-08-01", description: "Unit expense", amount: "25.00", transaction_kind: "expense", normalized_category: "supplies", source_system: "manual", status: "active", is_deleted: false, metadata: {} },
      ],
    }));
    expect(ledger.entries).toHaveLength(1);
  });
});
