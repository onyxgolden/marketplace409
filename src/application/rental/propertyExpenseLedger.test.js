import { describe, expect, it } from "vitest";
import { buildPropertyExpenseLedger } from "./propertyExpenseLedger";

const PROP = "145-laxon";
const UNIT = "unit_laxon";

function baseInput(overrides = {}) {
  return {
    propertyId: PROP,
    unitId: UNIT,
    financialEvents: [],
    contractorPayments: [],
    contractors: [{ id: "con_1", business_name: "Gulf Coast Plumbing", trade: "Plumbing" }],
    ...overrides,
  };
}

const manualEvent = (overrides = {}) => ({
  id: "evt_1", event_date: "2026-09-10", description: "Cash payment to Gulf Coast Plumbing",
  amount: 450.0, transaction_kind: "expense", normalized_category: "property_repairs",
  property_id: PROP, source_system: "manual", source_record_id: null,
  metadata: { payment_method: "cash" }, status: "active", is_deleted: false, business_scope: "rental",
  ...overrides,
});
const contractorPayment = (overrides = {}) => ({
  id: "rental_contractor_payment_1", contractor_id: "con_1", work_order_id: null, property_id: PROP,
  paid_at: "2026-09-10", amount_cents: 45000, payment_method: "check",
  reference: null, invoice_reference: "INV-77", notes: null,
  ...overrides,
});

describe("buildPropertyExpenseLedger", () => {
  it("rounds decimal amounts to cents deliberately — 19.99 becomes 1999, not 0", () => {
    const ledger = buildPropertyExpenseLedger(baseInput({
      financialEvents: [manualEvent({ id: "evt_cents", amount: 19.99 })],
    }));
    expect(ledger.entries[0].amountCents).toBe(1999);
    expect(ledger.totalCents).toBe(1999);
  });
  it("combines manual expenses and contractor payments newest-first with a running total", () => {
    const ledger = buildPropertyExpenseLedger(baseInput({
      financialEvents: [manualEvent({ id: "evt_1", event_date: "2026-09-10", amount: 450.0 })],
      contractorPayments: [contractorPayment({ id: "rental_contractor_payment_1", paid_at: "2026-08-01", amount_cents: 120000 })],
    }));
    expect(ledger.entries.map((e) => e.id)).toEqual(["event:evt_1", "contractor:rental_contractor_payment_1"]);
    expect(ledger.entries[0].sourceLabel).toBe("Manual entry");
    expect(ledger.entries[1].sourceLabel).toBe("Contractor payment");
    expect(ledger.entries[1].vendor).toBe("Gulf Coast Plumbing");
    expect(ledger.entries[1].category).toBe("Contractor — Plumbing");
    expect(ledger.entries[1].reference).toBe("INV-77");
    expect(ledger.totalCents).toBe(165000);
  });

  it("scopes strictly to the property — other properties and income never appear", () => {
    const ledger = buildPropertyExpenseLedger(baseInput({
      financialEvents: [
        manualEvent({ id: "evt_mine" }),
        manualEvent({ id: "evt_other", property_id: "4800-kent-ave" }),
        manualEvent({ id: "evt_income", transaction_kind: "income", amount: 1500.0 }),
        manualEvent({ id: "evt_deleted", is_deleted: true }),
        manualEvent({ id: "evt_inactive", status: "inactive" }),
        manualEvent({ id: "evt_plaid", source_system: "transaction" }),
      ],
      contractorPayments: [contractorPayment({ id: "rental_contractor_payment_2", property_id: "4800-kent-ave" })],
    }));
    expect(ledger.entries.map((e) => e.id)).toEqual(["event:evt_mine"]);
  });

  it("matches expenses recorded against the unit id as well as the property slug", () => {
    const ledger = buildPropertyExpenseLedger(baseInput({
      financialEvents: [manualEvent({ id: "evt_uid", property_id: UNIT })],
    }));
    expect(ledger.entries).toHaveLength(1);
  });

  it("collapses an explicitly linked manual event into its contractor payment", () => {
    const ledger = buildPropertyExpenseLedger(baseInput({
      financialEvents: [manualEvent({
        id: "evt_dup", metadata: { payment_method: "cash", contractor_payment_id: "rental_contractor_payment_1" },
      })],
      contractorPayments: [contractorPayment()],
    }));
    expect(ledger.entries.map((e) => e.id)).toEqual(["contractor:rental_contractor_payment_1"]);
    expect(ledger.entries[0].alsoRecordedAs).toContain("Manual entry");
    expect(ledger.suppressedDuplicateCount).toBe(1);
    expect(ledger.totalCents).toBe(45000);
  });

  it("collapses on a source_record_id contractor reference too", () => {
    const ledger = buildPropertyExpenseLedger(baseInput({
      financialEvents: [manualEvent({
        id: "evt_dup2", source_record_id: "rental_contractor_payment_9", metadata: {},
      })],
      contractorPayments: [contractorPayment({ id: "rental_contractor_payment_9" })],
    }));
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0].id).toBe("contractor:rental_contractor_payment_9");
  });

  it("flags ambiguous same-amount same-day pairs instead of guessing", () => {
    const ledger = buildPropertyExpenseLedger(baseInput({
      financialEvents: [manualEvent({ id: "evt_amb" })],
      contractorPayments: [contractorPayment({ id: "rental_contractor_payment_amb" })],
    }));
    expect(ledger.entries).toHaveLength(2);
    expect(ledger.entries.every((e) => e.possibleDuplicate)).toBe(true);
    expect(ledger.possibleDuplicateCount).toBe(2);
    // Both kept: nothing silently erased.
    expect(ledger.totalCents).toBe(90000);
  });

  it("does not flag same-day entries with different amounts", () => {
    const ledger = buildPropertyExpenseLedger(baseInput({
      financialEvents: [manualEvent({ id: "evt_ok", amount: 100.0 })],
      contractorPayments: [contractorPayment()],
    }));
    expect(ledger.entries.every((e) => !e.possibleDuplicate)).toBe(true);
  });

  it("carries vendor, category, method, status, and reference on every row", () => {
    const ledger = buildPropertyExpenseLedger(baseInput({
      financialEvents: [manualEvent()],
    }));
    const entry = ledger.entries[0];
    expect(entry.vendor).toBe("Cash payment to Gulf Coast Plumbing");
    expect(entry.category).toBe("property repairs");
    expect(entry.method).toBe("cash");
    expect(entry.status).toBe("active");
    expect(entry.date).toBe("2026-09-10");
  });
});
