import { describe, expect, it } from "vitest";
import {
  buildReceiptId,
  isValidReceiptId,
  canEditReceipt,
  validateReceiptInput,
  validateReceiptEdit,
  RECEIPT_STATUSES,
} from "./receipts";

describe("receipt ids and statuses", () => {
  it("builds ids that pass the route pattern", () => {
    const id = buildReceiptId();
    expect(isValidReceiptId(id)).toBe(true);
    expect(isValidReceiptId("bogus")).toBe(false);
  });

  it("exposes the inbox/applied/voided status machine", () => {
    expect(RECEIPT_STATUSES).toEqual(["inbox", "applied", "voided"]);
    expect(canEditReceipt({ status: "inbox" })).toBe(true);
    expect(canEditReceipt({ status: "applied" })).toBe(false);
    expect(canEditReceipt({ status: "voided" })).toBe(false);
  });
});

describe("validateReceiptInput", () => {
  const good = {
    vendorId: "rental_vendor_1",
    receiptDate: "2026-09-15",
    amountCents: 25000,
    taxCents: 1875,
    lineItems: [{ description: "Water heater", quantity: 1, amountCents: 23125 }],
  };

  it("accepts a complete receipt with a known vendor", () => {
    const check = validateReceiptInput(good);
    expect(check.valid).toBe(true);
    expect(check.value.vendorId).toBe("rental_vendor_1");
    expect(check.value.vendorNameHint).toBeNull();
  });

  it("accepts an unknown vendor via a name hint", () => {
    const check = validateReceiptInput({
      vendorNameHint: "Some guy's plumbing",
      receiptDate: "2026-09-15",
      amountCents: 1000,
    });
    expect(check.valid).toBe(true);
    expect(check.value.vendorId).toBeNull();
    expect(check.value.vendorNameHint).toBe("Some guy's plumbing");
  });

  it("rejects a receipt with neither vendor nor hint", () => {
    const check = validateReceiptInput({ receiptDate: "2026-09-15", amountCents: 1000 });
    expect(check.valid).toBe(false);
  });

  it("rejects a bad date, a zero amount, and tax above the total", () => {
    expect(validateReceiptInput({ ...good, receiptDate: "2026-13-40" }).valid).toBe(false);
    expect(validateReceiptInput({ ...good, amountCents: 0 }).valid).toBe(false);
    expect(validateReceiptInput({ ...good, taxCents: 99999 }).valid).toBe(false);
  });

  it("requires line items to add up to total minus tax", () => {
    const mismatch = validateReceiptInput({
      ...good,
      lineItems: [{ description: "Water heater", amountCents: 10000 }],
    });
    expect(mismatch.valid).toBe(false);
    expect(mismatch.errors.join(" ")).toMatch(/add up/i);
  });

  it("rejects line items with blank descriptions or negative amounts", () => {
    const bad = validateReceiptInput({
      ...good,
      lineItems: [{ description: "   ", amountCents: -5 }],
    });
    expect(bad.valid).toBe(false);
  });
});

describe("validateReceiptEdit", () => {
  const inbox = { status: "inbox", amount_cents: 25000, tax_cents: 0 };

  it("refuses edits on applied receipts", () => {
    const check = validateReceiptEdit({ notes: "x" }, { status: "applied" });
    expect(check.valid).toBe(false);
    expect(check.errors[0]).toMatch(/only inbox/i);
  });

  it("patches fields on inbox receipts", () => {
    const check = validateReceiptEdit({ notes: "Paid cash", receiptDate: "2026-09-16" }, inbox);
    expect(check.valid).toBe(true);
    expect(check.value.notes).toBe("Paid cash");
    expect(check.value.receipt_date).toBe("2026-09-16");
  });

  it("rechecks line items against an edited total", () => {
    const check = validateReceiptEdit(
      { amountCents: 20000, lineItems: [{ description: "Water heater", amountCents: 20000 }] },
      inbox
    );
    expect(check.valid).toBe(true);
  });
});
