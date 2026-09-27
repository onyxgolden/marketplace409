import { describe, expect, it } from "vitest";
import { buildBankLedger } from "@/application/rental/bankLedger";
import {
  buildClearedSnapshot,
  parseStatementAmountToCents,
  planUndo,
  reconcileStatement,
  validateStatement,
} from "./bankReconciliation";

// A small register, built through the real read model (income = credit,
// expense = debit; amounts are decimal dollars like financial_events.amount).
const ev = (id, date, kind, amount, cleared = false, clearedAt = null) => ({
  id, event_date: date, transaction_kind: kind, amount, description: id, cleared, cleared_at: clearedAt, status: "active",
});
const register = () =>
  buildBankLedger({
    financialEvents: [
      ev("open", "2026-08-01", "income", 1000, true, "2026-08-05T00:00:00Z"), // cleared last month
      ev("rent1", "2026-09-01", "income", 1500),
      ev("mortgage", "2026-09-05", "expense", 800),
      ev("repair", "2026-09-20", "expense", 125.5),
      ev("rent2", "2026-09-30", "income", 1500),
      ev("october", "2026-10-02", "expense", 60), // after the period
      ev("nodate", null, "income", 5),
    ],
  }).entries;

const SEPT = { periodStart: "2026-09-01", periodEnd: "2026-09-30" };

describe("parseStatementAmountToCents", () => {
  it("reads dollars, commas, negatives and parentheses; rejects junk", () => {
    expect(parseStatementAmountToCents("$1,574.50")).toBe(157450);
    expect(parseStatementAmountToCents("-12.3")).toBe(-1230);
    expect(parseStatementAmountToCents("(45.00)")).toBe(-4500);
    expect(parseStatementAmountToCents("1200")).toBe(120000);
    expect(parseStatementAmountToCents("12.345")).toBeNull();
    expect(parseStatementAmountToCents("abc")).toBeNull();
    expect(parseStatementAmountToCents("")).toBeNull();
  });
});

describe("validateStatement", () => {
  it("requires both dates in order and a statement balance", () => {
    expect(validateStatement({ ...SEPT, statementEndingBalanceCents: 0 })).toEqual([]);
    expect(validateStatement({ periodStart: "2026-09-30", periodEnd: "2026-09-01", statementEndingBalanceCents: 0 })).toEqual([
      "The statement start date must be on or before the end date.",
    ]);
    expect(validateStatement({ periodStart: "", periodEnd: "x", statementEndingBalanceCents: null })).toHaveLength(3);
  });
});

describe("reconcileStatement", () => {
  it("before marking anything: cleared vs book balance, outstanding items, and the difference", () => {
    const r = reconcileStatement({ entries: register(), ...SEPT, statementEndingBalanceCents: 157450 });
    expect(r.ok).toBe(true);
    expect(r.clearedBalanceCents).toBe(100000); // only last month's opening deposit
    expect(r.bookBalanceCents).toBe(100000 + 150000 - 80000 - 12550 + 150000);
    expect(r.outstanding.map((e) => e.sourceId)).toEqual(["rent1", "mortgage", "repair", "rent2"]);
    expect(r.outstandingDepositsCents).toBe(300000);
    expect(r.outstandingPaymentsCents).toBe(92550);
    expect(r.differenceCents).toBe(157450 - 100000);
    expect(r.balanced).toBe(false);
    expect(r.undatedCount).toBe(1);
    // October isn't in this statement at all.
    expect(r.candidates.some((e) => e.sourceId === "october")).toBe(false);
  });

  it("balances when the items on the statement are marked cleared; the rest stay outstanding", () => {
    // Statement shows rent1, mortgage, repair; rent2 (deposited 9/30) is in transit.
    const marks = { rent1: true, mortgage: true, repair: true };
    const r = reconcileStatement({ entries: register(), ...SEPT, statementEndingBalanceCents: 100000 + 150000 - 80000 - 12550, clearedOverrides: marks });
    expect(r.differenceCents).toBe(0);
    expect(r.balanced).toBe(true);
    expect(r.outstanding.map((e) => e.sourceId)).toEqual(["rent2"]);
    expect(r.clearedDepositsInPeriodCents).toBe(150000);
    expect(r.clearedPaymentsInPeriodCents).toBe(92550);
    // Proof: statement + deposits in transit − uncleared payments = book balance.
    expect(r.adjustedBankBalanceCents).toBe(r.bookBalanceCents);
    expect(r.changes).toEqual([
      { sourceId: "rent1", from: false, to: true },
      { sourceId: "mortgage", from: false, to: true },
      { sourceId: "repair", from: false, to: true },
    ]);
  });

  it("un-marking an item that was cleared records that change too", () => {
    const r = reconcileStatement({ entries: register(), ...SEPT, statementEndingBalanceCents: 0, clearedOverrides: { open: false } });
    expect(r.changes).toEqual([{ sourceId: "open", from: true, to: false }]);
    expect(r.candidates.find((e) => e.sourceId === "open").proposedCleared).toBe(false);
  });

  it("refuses an invalid statement instead of computing", () => {
    expect(reconcileStatement({ entries: register(), periodStart: "2026-09-01", periodEnd: "", statementEndingBalanceCents: 1 })).toEqual({
      ok: false,
      problems: ["Enter the statement end date."],
    });
  });
});

describe("snapshots and undo", () => {
  it("captures each item's state and original cleared_at before the writes", () => {
    const entries = register();
    const snap = buildClearedSnapshot(entries, [
      { sourceId: "rent1", from: false, to: true },
      { sourceId: "open", from: true, to: false },
    ]);
    expect(snap).toEqual([
      { eventId: "rent1", clearedBefore: false, clearedAtBefore: null, clearedAfter: true },
      { eventId: "open", clearedBefore: true, clearedAtBefore: "2026-08-05T00:00:00Z", clearedAfter: false },
    ]);
  });

  it("plans an exact restore, and refuses while a later reconciliation is active", () => {
    const sept = {
      id: "r-sep", status: "active", period_start: "2026-09-01", period_end: "2026-09-30",
      cleared_snapshot: [
        { eventId: "rent1", clearedBefore: false, clearedAtBefore: null, clearedAfter: true },
        { eventId: "open", clearedBefore: true, clearedAtBefore: "2026-08-05T00:00:00Z", clearedAfter: false },
      ],
    };
    const oct = { id: "r-oct", status: "active", period_start: "2026-10-01", period_end: "2026-10-31", cleared_snapshot: [] };
    expect(planUndo(sept, [sept, oct])).toEqual({ ok: false, reason: "Undo the later reconciliation (2026-10-01 – 2026-10-31) first." });
    expect(planUndo(sept, [sept, { ...oct, status: "undone" }])).toEqual({
      ok: true,
      restores: [
        { eventId: "rent1", cleared: false, clearedAt: null },
        { eventId: "open", cleared: true, clearedAt: "2026-08-05T00:00:00Z" },
      ],
    });
    expect(planUndo({ ...sept, status: "undone" }, []).ok).toBe(false);
  });
});
