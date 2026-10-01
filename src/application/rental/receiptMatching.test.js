import { describe, expect, it } from "vitest";
import {
  normalizeVendorName,
  vendorNameSimilarity,
  scoreReceiptBillMatch,
  rankBillMatches,
  MATCH_SUGGEST_THRESHOLD,
} from "./receiptMatching";

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
  bill_date: "2026-09-15",
  due_date: "2026-10-15",
  amount_cents: 25000,
  paid_amount_cents: 0,
  status: "open",
};

const names = new Map([["rental_vendor_1", "Acme Plumbing Co."]]);

describe("vendor name similarity", () => {
  it("normalizes punctuation and case", () => {
    expect(normalizeVendorName("Acme Plumbing Co., LLC!")).toBe("acme plumbing co llc");
  });

  it("scores exact matches at 1", () => {
    expect(vendorNameSimilarity("Acme Plumbing", "acme plumbing")).toBe(1);
  });

  it("scores containment below exact but high", () => {
    const score = vendorNameSimilarity("Acme Plumbing Co LLC", "Acme Plumbing");
    expect(score).toBeGreaterThanOrEqual(0.9);
    expect(score).toBeLessThan(1);
  });

  it("scores a fuzzy token overlap", () => {
    const score = vendorNameSimilarity("Acme Plumbing Supply", "Acme Plumbing Services");
    expect(score).toBeGreaterThan(0.3);
    expect(score).toBeLessThan(0.9);
  });

  it("scores unrelated names near zero", () => {
    expect(vendorNameSimilarity("Acme Plumbing", "Zebra Landscaping")).toBeLessThan(0.3);
  });
});

describe("scoreReceiptBillMatch", () => {
  it("suggests an exact match with high confidence", () => {
    const match = scoreReceiptBillMatch(receipt, bill, "Acme Plumbing Co.");
    expect(match.suggested).toBe(true);
    expect(match.confidence).toBeGreaterThanOrEqual(MATCH_SUGGEST_THRESHOLD);
    expect(match.billId).toBe(bill.id);
  });

  it("matches a fuzzy vendor name typed from the receipt", () => {
    const hintReceipt = { ...receipt, vendor_id: null, vendor_name_hint: "acme plumbng" };
    const match = scoreReceiptBillMatch(hintReceipt, bill, "Acme Plumbing Co.");
    expect(match.suggested).toBe(true);
  });

  it("rejects an amount mismatch — never suggested", () => {
    const wrongBill = { ...bill, amount_cents: 19999 };
    const match = scoreReceiptBillMatch(receipt, wrongBill, "Acme Plumbing Co.");
    expect(match.suggested).toBe(false);
    expect(match.reasons.join(" ")).toMatch(/differs/i);
  });

  it("rejects amounts outside the tolerance band", () => {
    // $250.00 receipt vs $260.00 bill — beyond the 1%/$2.50 tolerance.
    const wrongBill = { ...bill, amount_cents: 26000 };
    const match = scoreReceiptBillMatch(receipt, wrongBill, "Acme Plumbing Co.");
    expect(match.suggested).toBe(false);
  });

  it("credits the bill balance, not the gross, for partial bills", () => {
    const partial = { ...bill, amount_cents: 50000, paid_amount_cents: 25000, status: "partial" };
    const match = scoreReceiptBillMatch(receipt, partial, "Acme Plumbing Co.");
    expect(match.suggested).toBe(true);
  });

  it("penalizes bills outside the date window", () => {
    const oldBill = { ...bill, bill_date: "2026-01-02" };
    const inWindow = scoreReceiptBillMatch(receipt, bill, "Acme Plumbing Co.");
    const outOfWindow = scoreReceiptBillMatch(receipt, oldBill, "Acme Plumbing Co.");
    expect(outOfWindow.components.dateScore).toBe(0);
    expect(outOfWindow.confidence).toBeLessThan(inWindow.confidence);
  });
});

describe("rankBillMatches", () => {
  it("returns the best match first and caps at the limit", () => {
    const bills = [
      bill,
      { ...bill, id: "rental_vendor_bill_2", amount_cents: 99900 },
      { ...bill, id: "rental_vendor_bill_3", amount_cents: 88800 },
    ];
    const ranked = rankBillMatches(receipt, bills, names, { limit: 2 });
    expect(ranked).toHaveLength(2);
    expect(ranked[0].billId).toBe(bill.id);
    expect(ranked[0].confidence).toBeGreaterThanOrEqual(ranked[1].confidence);
  });

  it("never considers paid or voided bills", () => {
    const bills = [
      { ...bill, status: "paid" },
      { ...bill, id: "rental_vendor_bill_9", status: "voided" },
    ];
    expect(rankBillMatches(receipt, bills, names)).toHaveLength(0);
  });
});
