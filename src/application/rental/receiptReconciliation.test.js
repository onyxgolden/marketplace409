import { describe, expect, it } from "vitest";
import { matchReceiptsToBankEvents, bankEventIsSettled } from "./receiptReconciliation";

const receipt = {
  id: "rental_receipt_1",
  vendor_id: "rental_vendor_1",
  vendor_name_hint: null,
  receipt_date: "2026-09-15",
  amount_cents: 25000,
};

const bill = {
  id: "rental_vendor_bill_1",
  vendor_id: "rental_vendor_1",
  bill_date: "2026-09-10",
  amount_cents: 80000,
  paid_amount_cents: 0,
};

const bankEvent = (overrides = {}) => ({
  id: "evt_1",
  event_date: "2026-09-16",
  amount: 250.0,
  bank_account_id: "bank_1",
  payee: "Acme Plumbing",
  metadata: {},
  status: "active",
  is_deleted: false,
  ...overrides,
});

describe("bankEventIsSettled", () => {
  it("treats rows carrying a vendor_payment_id as already settled", () => {
    expect(bankEventIsSettled(bankEvent({ metadata: { vendor_payment_id: "pay_1" } }))).toBe(true);
    expect(bankEventIsSettled(bankEvent())).toBe(false);
  });
});

describe("matchReceiptsToBankEvents", () => {
  it("matches a receipt to a bank row by amount + date window", () => {
    const result = matchReceiptsToBankEvents(
      { receipts: [receipt], bills: [], bankEvents: [bankEvent()] },
      { windowDays: 5 }
    );
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({
      targetKind: "receipt",
      targetId: receipt.id,
      bankEventId: "evt_1",
    });
    expect(result.unmatchedReceipts).toHaveLength(0);
    expect(result.unmatchedBankEvents).toHaveLength(0);
  });

  it("rejects matches outside the date window", () => {
    const far = bankEvent({ id: "evt_far", event_date: "2026-10-20" });
    const result = matchReceiptsToBankEvents(
      { receipts: [receipt], bills: [], bankEvents: [far] },
      { windowDays: 5 }
    );
    expect(result.matches).toHaveLength(0);
    expect(result.unmatchedReceipts).toHaveLength(1);
    expect(result.unmatchedBankEvents).toHaveLength(1);
  });

  it("rejects amount mismatches to the cent", () => {
    const wrong = bankEvent({ amount: 250.01 });
    const result = matchReceiptsToBankEvents({ receipts: [receipt], bills: [], bankEvents: [wrong] });
    expect(result.matches).toHaveLength(0);
  });

  it("matches an unpaid bill to its bank row", () => {
    const paid = bankEvent({ id: "evt_bill", event_date: "2026-09-12", amount: 800.0 });
    const result = matchReceiptsToBankEvents(
      { receipts: [], bills: [bill], bankEvents: [paid] },
      { windowDays: 5 }
    );
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].targetKind).toBe("bill");
  });

  it("binds a bank row to at most one target — receipt wins over bill", () => {
    const both = bankEvent({ event_date: "2026-09-13" });
    const billNear = { ...bill, bill_date: "2026-09-13", amount_cents: 25000 };
    const result = matchReceiptsToBankEvents(
      { receipts: [receipt], bills: [billNear], bankEvents: [both] },
      { windowDays: 5 }
    );
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].targetKind).toBe("receipt");
    expect(result.unmatchedBills).toHaveLength(1);
  });

  it("excludes deleted rows and rows without a bank account", () => {
    const result = matchReceiptsToBankEvents({
      receipts: [],
      bills: [],
      bankEvents: [
        bankEvent({ id: "evt_del", is_deleted: true }),
        bankEvent({ id: "evt_nobank", bank_account_id: null }),
      ],
    });
    expect(result.unmatchedBankEvents).toHaveLength(0);
  });

  it("excludes settled payment rows from the unmatched bank list", () => {
    const settled = bankEvent({ id: "evt_settled", metadata: { vendor_payment_id: "pay_9" } });
    const result = matchReceiptsToBankEvents({ receipts: [], bills: [], bankEvents: [settled] });
    expect(result.unmatchedBankEvents).toHaveLength(0);
  });
});
