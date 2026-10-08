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

  it("exposes check number, cleared state, attachment presence, payee, and memo on manual entries", () => {
    const ledger = buildPropertyLedger(baseInput({
      financialEvents: [
        { id: "e1", property_id: PROP, event_date: "2026-08-01", description: "Water heater", amount: "450.00", transaction_kind: "expense", normalized_category: "property_repairs", source_system: "manual", status: "active", is_deleted: false, check_number: "1024", cleared: true, payee: "Gulf Coast Plumbing", metadata: { memo: "Emergency call" } },
        { id: "e2", property_id: PROP, event_date: "2026-08-05", description: "Supplies", amount: "88.41", transaction_kind: "expense", normalized_category: "supplies", source_system: "manual", status: "active", is_deleted: false, check_number: null, cleared: false, payee: null, metadata: {} },
      ],
      attachmentEventIds: new Set(["e1"]),
    }));
    expect(ledger.entries).toHaveLength(2);
    // Newest first: e2 first.
    expect(ledger.entries[0].checkNumber).toBeNull();
    expect(ledger.entries[0].cleared).toBe(false);
    expect(ledger.entries[0].hasAttachment).toBe(false);
    expect(ledger.entries[1].checkNumber).toBe("1024");
    expect(ledger.entries[1].cleared).toBe(true);
    expect(ledger.entries[1].hasAttachment).toBe(true);
    expect(ledger.entries[1].payee).toBe("Gulf Coast Plumbing");
    expect(ledger.entries[1].memo).toBe("Emergency call");
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

  it("does not suppress an income event linked to a contractor payment — suppression is expense-only", () => {
    const ledger = buildPropertyLedger(baseInput({
      contractorPayments: [
        { id: "cp1", property_id: PROP, paid_at: "2026-08-10", amount_cents: 45000, contractor_id: "c1" },
      ],
      financialEvents: [
        { id: "e1", property_id: PROP, event_date: "2026-08-10", description: "Reimbursement", amount: "450.00", transaction_kind: "income", normalized_category: "other", source_system: "manual", source_record_id: "rental_contractor_payment_cp1", status: "active", is_deleted: false, metadata: {} },
      ],
    }));
    // The income event stays visible as a credit; the contractor debit stays too.
    expect(ledger.entries).toHaveLength(2);
    expect(ledger.suppressedDuplicateCount).toBe(0);
    const income = ledger.entries.find((e) => e.id === "event:e1");
    expect(income.creditCents).toBe(45000);
    expect(income.debitCents).toBe(0);
    expect(ledger.balanceCents).toBe(0);
  });

  it("does not flag a debit and a credit of the same amount on the same date as duplicates", () => {
    const ledger = buildPropertyLedger(baseInput({
      contractorPayments: [
        { id: "cp1", property_id: PROP, paid_at: "2026-09-01", amount_cents: 50000, contractor_id: "c1" },
      ],
      financialEvents: [
        { id: "e1", property_id: PROP, event_date: "2026-09-01", description: "Rebate", amount: "500.00", transaction_kind: "income", normalized_category: "other", source_system: "manual", status: "active", is_deleted: false, metadata: {} },
      ],
    }));
    expect(ledger.entries).toHaveLength(2);
    expect(ledger.possibleDuplicateCount).toBe(0);
  });

  it("still flags two same-direction debits of the same amount on the same date", () => {    const ledger = buildPropertyLedger(baseInput({
      financialEvents: [
        { id: "e1", property_id: PROP, event_date: "2026-09-01", description: "Supplies A", amount: "500.00", transaction_kind: "expense", normalized_category: "supplies", source_system: "manual", status: "active", is_deleted: false, metadata: {} },
        { id: "e2", property_id: PROP, event_date: "2026-09-01", description: "Supplies B", amount: "500.00", transaction_kind: "expense", normalized_category: "supplies", source_system: "rentec", status: "active", is_deleted: false, metadata: {} },
      ],
    }));
    expect(ledger.entries).toHaveLength(2);
    expect(ledger.possibleDuplicateCount).toBe(2);
  });

  it("annotates a payment that includes a refund instead of silently netting it", () => {
    const ledger = buildPropertyLedger(baseInput({
      leases: [{ id: "lease_1", property_id: PROP, unit_id: UNIT }],
      rentalPayments: [
        { id: "pay_1", lease_id: "lease_1", tenant_id: "t1", amount_cents: 100000, refunded_amount_cents: 20000, status: "succeeded", provider: "stripe", received_at: "2026-09-01T10:00:00Z" },
      ],
    }));
    expect(ledger.entries).toHaveLength(1);
    const entry = ledger.entries[0];
    expect(entry.creditCents).toBe(80000);
    expect(entry.notes).toContain("Includes $200.00 refund");
    expect(entry.notes).toContain("refund date not recorded");
  });

  it("keeps notes null for a plain succeeded payment with no refund", () => {
    const ledger = buildPropertyLedger(baseInput({
      leases: [{ id: "lease_1", property_id: PROP, unit_id: UNIT }],
      rentalPayments: [
        { id: "pay_1", lease_id: "lease_1", tenant_id: "t1", amount_cents: 160000, refunded_amount_cents: 0, status: "succeeded", provider: "stripe", received_at: "2026-09-01T10:00:00Z" },
      ],
    }));
    expect(ledger.entries[0].notes).toBeNull();
  });
});

describe("buildPropertyLedger — canonical property identity (import-pipeline aliases)", () => {
  // Canonical "1900-w-decker" (rental_units identity) vs alias
  // "1900-west-decker" written by the other import pipeline.
  const CANON = "1900-w-decker";
  const ALIAS = "1900-west-decker";
  const UNIT_D = "unit-decker-1";

  const aliasInput = (overrides = {}) => ({
    propertyId: CANON,
    propertyLabel: "1900 W Decker",
    unitIds: [UNIT_D],
    financialEvents: [],
    contractorPayments: [],
    contractors: [],
    rentalPayments: [],
    leases: [],
    tenantsById: {},
    ...overrides,
  });

  const ev = (overrides = {}) => ({
    id: "e1",
    property_id: ALIAS,
    event_date: "2026-09-01",
    description: "Rent",
    amount: "1600.00",
    transaction_kind: "income",
    normalized_category: "rental_income",
    source_system: "rentec",
    status: "active",
    is_deleted: false,
    metadata: {},
    ...overrides,
  });

  it("alias financial events and alias contractor payments appear under the canonical property", () => {
    const ledger = buildPropertyLedger(aliasInput({
      financialEvents: [ev()],
      contractorPayments: [
        { id: "cp1", property_id: ALIAS, paid_at: "2026-09-03", amount_cents: 45000, contractor_id: "c1" },
      ],
      contractors: [{ id: "c1", business_name: "BC Roofing", trade: "Roofing" }],
    }));
    expect(ledger.entries.map((e) => e.id).sort()).toEqual(["contractor:cp1", "event:e1"]);
    expect(ledger.totalCreditCents).toBe(160000);
    expect(ledger.totalDebitCents).toBe(45000);
    expect(ledger.balanceCents).toBe(160000 - 45000);
  });

  it("resolves in both directions: querying by the alias slug finds canonical rows", () => {
    const ledger = buildPropertyLedger(aliasInput({
      propertyId: ALIAS,
      financialEvents: [ev({ id: "e1", property_id: CANON }), ev({ id: "e2", property_id: ALIAS, event_date: "2026-09-02", amount: "100.00" })],
    }));
    expect(ledger.entryCount).toBe(2);
    expect(ledger.totalCreditCents).toBe(170000);
  });

  it("mixed canonical + alias rows each count exactly once — no double-count, no drop", () => {
    const ledger = buildPropertyLedger(aliasInput({
      financialEvents: [
        ev({ id: "e1", property_id: CANON }),
        ev({ id: "e2", property_id: ALIAS, event_date: "2026-09-02" }),
        ev({ id: "e3", property_id: ALIAS, event_date: "2026-09-03", description: "Repairs", amount: "200.00", transaction_kind: "expense", normalized_category: "property_repairs", source_system: "manual" }),
      ],
    }));
    expect(ledger.entryCount).toBe(3);
    expect(ledger.totalCreditCents).toBe(320000);
    expect(ledger.totalDebitCents).toBe(20000);
    expect(ledger.balanceCents).toBe(300000);
    const byId = new Map(ledger.entries.map((e) => [e.id, e]));
    // Chronological running balance: +1600 (09-01), +1600 (09-02), -200 (09-03).
    expect(byId.get("event:e1").balanceAfterCents).toBe(160000);
    expect(byId.get("event:e2").balanceAfterCents).toBe(320000);
    expect(byId.get("event:e3").balanceAfterCents).toBe(300000);
  });

  it("excludes unrelated houses and never matches a null property_id", () => {
    const ledger = buildPropertyLedger(aliasInput({
      financialEvents: [
        ev({ id: "x1", property_id: "185-laxon-st" }), // a different house's alias
        ev({ id: "n1", property_id: null }),
        ev({ id: "a1", property_id: ALIAS }),
      ],
      contractorPayments: [
        { id: "cp9", property_id: null, paid_at: "2026-09-03", amount_cents: 100, contractor_id: "c1" },
      ],
    }));
    expect(ledger.entries.map((e) => e.id)).toEqual(["event:a1"]);
  });

  it("rental payments arrive through a lease whose property_id is the alias", () => {
    const ledger = buildPropertyLedger(aliasInput({
      leases: [{ id: "lease_1", property_id: ALIAS, unit_id: UNIT_D }],
      rentalPayments: [
        { id: "pay_1", lease_id: "lease_1", tenant_id: "t1", amount_cents: 160000, refunded_amount_cents: 0, status: "succeeded", provider: "stripe", received_at: "2026-09-01T10:00:00Z" },
      ],
    }));
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0].creditCents).toBe(160000);
  });

  it("unit IDs stay exact: a unit_id that merely spells the alias slug is not a property match", () => {
    const ledger = buildPropertyLedger(aliasInput({
      leases: [{ id: "lease_9", property_id: "other-house", unit_id: ALIAS }],
      rentalPayments: [
        { id: "pay_1", lease_id: "lease_9", tenant_id: "t1", amount_cents: 160000, refunded_amount_cents: 0, status: "succeeded", provider: "stripe", received_at: "2026-09-01T10:00:00Z" },
      ],
    }));
    expect(ledger.entries).toHaveLength(0);
  });

  it("unit-scoped events (property_id = unit ID) still match alongside aliases", () => {
    const ledger = buildPropertyLedger(aliasInput({
      financialEvents: [
        ev({ id: "u1", property_id: UNIT_D, description: "Unit supplies", amount: "25.00", transaction_kind: "expense", normalized_category: "supplies", source_system: "manual" }),
        ev({ id: "a1", property_id: ALIAS, event_date: "2026-09-04" }),
      ],
    }));
    expect(ledger.entries.map((e) => e.id).sort()).toEqual(["event:a1", "event:u1"]);
  });

  it("contractor suppression still collapses an explicitly linked event across the alias boundary", () => {
    const ledger = buildPropertyLedger(aliasInput({
      contractorPayments: [
        { id: "cp1", property_id: CANON, paid_at: "2026-08-10", amount_cents: 45000, contractor_id: "c1" },
      ],
      financialEvents: [
        ev({ id: "e1", property_id: ALIAS, event_date: "2026-08-10", description: "Roof", amount: "450.00", transaction_kind: "expense", normalized_category: "property_repairs", source_system: "manual", source_record_id: "rental_contractor_payment_cp1" }),
      ],
    }));
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0].id).toBe("contractor:cp1");
    expect(ledger.suppressedDuplicateCount).toBe(1);
  });

  it("possible-duplicate flagging is preserved across alias sources", () => {
    const ledger = buildPropertyLedger(aliasInput({
      financialEvents: [ev({ id: "e1", property_id: ALIAS, source_system: "manual" })],
      leases: [{ id: "lease_1", property_id: CANON, unit_id: UNIT_D }],
      rentalPayments: [
        { id: "pay_1", lease_id: "lease_1", tenant_id: "t1", amount_cents: 160000, refunded_amount_cents: 0, status: "succeeded", provider: "stripe", received_at: "2026-09-01T12:00:00Z" },
      ],
    }));
    expect(ledger.entries).toHaveLength(2);
    expect(ledger.possibleDuplicateCount).toBe(2);
    expect(ledger.totalCreditCents).toBe(320000);
  });

  it("does not mutate its inputs while canonicalizing", () => {
    const input = aliasInput({
      financialEvents: [ev()],
      leases: [{ id: "lease_1", property_id: ALIAS, unit_id: UNIT_D }],
    });
    const snapshot = JSON.stringify(input);
    buildPropertyLedger(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
