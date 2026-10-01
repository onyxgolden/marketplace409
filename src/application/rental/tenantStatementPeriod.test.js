import { describe, expect, it } from "vitest";
import { buildTenantStatementPeriod, normalizeStatementPeriod } from "./tenantStatementPeriod";

function ledgerEntries() {
  // Zero-opening ledger entries as buildTenantPaymentLedger returns them.
  return [
    { id: "charge:c1", kind: "charge", date: "2026-08-01", amountCents: 160000, balanceEffectCents: 160000, label: "Rent charge", balanceAfterCents: 160000, status: "due" },
    { id: "payment:p1", kind: "payment", date: "2026-08-05", amountCents: 160000, balanceEffectCents: -160000, label: "Payment", balanceAfterCents: 0, status: "succeeded" },
    { id: "charge:c2", kind: "charge", date: "2026-09-01", amountCents: 160000, balanceEffectCents: 160000, label: "Rent charge", balanceAfterCents: 160000, status: "due" },
    { id: "charge:c3", kind: "charge", date: "2026-10-01", amountCents: 160000, balanceEffectCents: 160000, label: "Rent charge", balanceAfterCents: 320000, status: "due" },
    { id: "payment:p2", kind: "payment", date: "2026-10-15", amountCents: 200000, balanceEffectCents: -200000, label: "Payment", balanceAfterCents: 120000, status: "succeeded" },
    { id: "refund:r1", kind: "refund", date: "2026-10-20", amountCents: 20000, balanceEffectCents: 20000, label: "Refund (partial)", balanceAfterCents: 140000, status: "partially_refunded" },
    { id: "credit:cr1", kind: "credit", date: "2026-10-15", amountCents: 40000, balanceEffectCents: 0, label: "Overpayment credit", balanceAfterCents: 140000, status: "open" },
  ];
}

describe("normalizeStatementPeriod", () => {
  it("defaults to the current month", () => {
    const period = normalizeStatementPeriod(undefined, new Date(2026, 9, 1)); // Oct 2026
    expect(period).toMatchObject({ start: "2026-10-01", end: "2026-10-31", endExclusive: "2026-11-01", label: "October 2026" });
  });

  it("accepts YYYY-MM across a year boundary", () => {
    expect(normalizeStatementPeriod("2026-12")).toMatchObject({ start: "2026-12-01", end: "2026-12-31", endExclusive: "2027-01-01", label: "December 2026" });
  });

  it("rejects malformed periods", () => {
    expect(() => normalizeStatementPeriod("October")).toThrow("period must be YYYY-MM.");
    expect(() => normalizeStatementPeriod("2026-13")).toThrow("period must be YYYY-MM.");
    expect(() => normalizeStatementPeriod("2026-1")).toThrow("period must be YYYY-MM.");
  });
});

describe("buildTenantStatementPeriod", () => {
  it("slices the month: opening from earlier entries, running balances rebased, closing at the end", () => {
    const statement = buildTenantStatementPeriod({
      entries: ledgerEntries(), periodStart: "2026-10-01", periodEndExclusive: "2026-11-01",
    });
    expect(statement.openingBalanceCents).toBe(160000); // August + September rent, August paid
    expect(statement.entries.map((line) => line.id)).toEqual(["charge:c3", "credit:cr1", "payment:p2", "refund:r1"]);
    expect(statement.entries.map((line) => line.balanceAfterCents)).toEqual([320000, 320000, 120000, 140000]);
    expect(statement.closingBalanceCents).toBe(140000);
  });

  it("opens at 0 when nothing precedes the period", () => {
    const statement = buildTenantStatementPeriod({
      entries: ledgerEntries(), periodStart: "2026-08-01", periodEndExclusive: "2026-09-01",
    });
    expect(statement.openingBalanceCents).toBe(0);
    expect(statement.closingBalanceCents).toBe(0);
  });

  it("excludes entries after the period and keeps them out of the closing balance", () => {
    const statement = buildTenantStatementPeriod({
      entries: ledgerEntries(), periodStart: "2026-09-01", periodEndExclusive: "2026-10-01",
    });
    expect(statement.entries.map((line) => line.id)).toEqual(["charge:c2"]);
    expect(statement.openingBalanceCents).toBe(0);
    expect(statement.closingBalanceCents).toBe(160000);
  });

  it("assigns debits to charges/refunds and credits to payments; memo rows move nothing", () => {
    const statement = buildTenantStatementPeriod({
      entries: ledgerEntries(), periodStart: "2026-10-01", periodEndExclusive: "2026-11-01",
    });
    const byId = Object.fromEntries(statement.entries.map((line) => [line.id, line]));
    expect([byId["charge:c3"].debitCents, byId["charge:c3"].creditCents]).toEqual([160000, 0]);
    expect([byId["payment:p2"].debitCents, byId["payment:p2"].creditCents]).toEqual([0, 200000]);
    expect([byId["refund:r1"].debitCents, byId["refund:r1"].creditCents]).toEqual([20000, 0]);
    expect([byId["credit:cr1"].debitCents, byId["credit:cr1"].creditCents]).toEqual([0, 0]);
  });

  it("totals the period's charges, effective payments, and refunds", () => {
    const statement = buildTenantStatementPeriod({
      entries: ledgerEntries(), periodStart: "2026-10-01", periodEndExclusive: "2026-11-01",
    });
    expect(statement.totals).toEqual({ chargedCents: 160000, paidCents: 200000, refundedCents: 20000 });
  });

  it("is order-independent: unsorted input produces the same statement", () => {
    const reversed = [...ledgerEntries()].reverse();
    const sorted = buildTenantStatementPeriod({ entries: ledgerEntries(), periodStart: "2026-10-01", periodEndExclusive: "2026-11-01" });
    const fromReversed = buildTenantStatementPeriod({ entries: reversed, periodStart: "2026-10-01", periodEndExclusive: "2026-11-01" });
    expect(fromReversed).toEqual(sorted);
  });

  it("handles an empty ledger as an empty statement", () => {
    const statement = buildTenantStatementPeriod({ entries: [], periodStart: "2026-10-01", periodEndExclusive: "2026-11-01" });
    expect(statement).toMatchObject({ openingBalanceCents: 0, closingBalanceCents: 0 });
    expect(statement.entries).toEqual([]);
  });
});
