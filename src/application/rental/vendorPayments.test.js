import { describe, expect, it } from "vitest";
import {
  billStatusAfterApply,
  billStatusAfterVoid,
  buildVendorPaymentId,
  canEditPayment,
  canVoidPayment,
  paymentIsReconciled,
  serializeVendorPayment,
  validateVendorPaymentEdit,
  validateVendorPaymentInput,
  vendorBillBalanceCents,
  VENDOR_PAYMENT_ID_PREFIX,
} from "./vendorPayments";

const bill = (overrides = {}) => ({
  id: "rental_vendor_bill_1",
  vendor_id: "rental_vendor_1",
  status: "open",
  amount_cents: 25000,
  paid_amount_cents: 0,
  ...overrides,
});

const goodInput = (overrides = {}) => ({
  id: "rental_vendor_payment_1",
  vendorId: "rental_vendor_1",
  paymentDate: "2026-09-30",
  paymentMethod: "check",
  checkNumber: "1042",
  bankAccountId: "bank_1",
  memo: "September plumber",
  amountCents: 25000,
  applications: [{ billId: "rental_vendor_bill_1", amountCents: 25000 }],
  ...overrides,
});

describe("vendorBillBalanceCents", () => {
  it("returns the unpaid remainder", () => {
    expect(vendorBillBalanceCents(bill())).toBe(25000);
    expect(vendorBillBalanceCents(bill({ paid_amount_cents: 10000 }))).toBe(15000);
    expect(vendorBillBalanceCents(bill({ paid_amount_cents: 25000 }))).toBe(0);
  });
});

describe("billStatusAfterApply / billStatusAfterVoid", () => {
  it("moves open to paid on full payment and to partial on short payment", () => {
    expect(billStatusAfterApply(bill(), 25000)).toBe("paid");
    expect(billStatusAfterApply(bill(), 10000)).toBe("partial");
    expect(billStatusAfterApply(bill({ status: "partial", paid_amount_cents: 10000 }), 15000)).toBe("paid");
  });

  it("rolls back to open when the whole payment voids, partial otherwise", () => {
    expect(billStatusAfterVoid(bill({ status: "paid", paid_amount_cents: 25000 }), 25000)).toBe("open");
    expect(billStatusAfterVoid(bill({ status: "partial", paid_amount_cents: 15000 }), 10000)).toBe("partial");
  });
});

describe("buildVendorPaymentId", () => {
  it("builds a prefixed unique id", () => {
    const a = buildVendorPaymentId();
    const b = buildVendorPaymentId();
    expect(a.startsWith(VENDOR_PAYMENT_ID_PREFIX)).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe("validateVendorPaymentInput", () => {
  const bills = [bill()];

  it("accepts a full check payment", () => {
    const { valid, errors, value } = validateVendorPaymentInput(goodInput(), { bills });
    expect(valid).toBe(true);
    expect(errors).toEqual([]);
    expect(value).toMatchObject({ paymentMethod: "check", checkNumber: "1042", amountCents: 25000 });
  });

  it("accepts a partial payment and derives the total when omitted", () => {
    const { valid, value } = validateVendorPaymentInput(
      goodInput({ amountCents: undefined, applications: [{ billId: "rental_vendor_bill_1", amountCents: 10000 }] }),
      { bills }
    );
    expect(valid).toBe(true);
    expect(value.amountCents).toBe(10000);
  });

  it("accepts a payment split across several bills", () => {
    const billsTwo = [bill(), bill({ id: "rental_vendor_bill_2" })];
    const { valid, value } = validateVendorPaymentInput(
      goodInput({
        amountCents: 30000,
        applications: [
          { billId: "rental_vendor_bill_1", amountCents: 25000 },
          { billId: "rental_vendor_bill_2", amountCents: 5000 },
        ],
      }),
      { bills: billsTwo }
    );
    expect(valid).toBe(true);
    expect(value.applications).toHaveLength(2);
  });

  it("blocks an application that exceeds the bill balance (no overpayment)", () => {
    const { valid, errors } = validateVendorPaymentInput(
      goodInput({ applications: [{ billId: "rental_vendor_bill_1", amountCents: 25001 }] }),
      { bills }
    );
    expect(valid).toBe(false);
    expect(errors.join(" ")).toMatch(/balance/i);
  });

  it("blocks applications that do not add up to the payment amount", () => {
    const { valid, errors } = validateVendorPaymentInput(
      goodInput({ amountCents: 20000, applications: [{ billId: "rental_vendor_bill_1", amountCents: 25000 }] }),
      { bills }
    );
    expect(valid).toBe(false);
    expect(errors.join(" ")).toMatch(/add up/i);
  });

  it("requires a check number for check payments but not ACH", () => {
    const checkMissing = validateVendorPaymentInput(goodInput({ checkNumber: "" }), { bills });
    expect(checkMissing.valid).toBe(false);
    expect(checkMissing.errors.join(" ")).toMatch(/check number/i);

    const ach = validateVendorPaymentInput(
      goodInput({ paymentMethod: "ach", checkNumber: "" }),
      { bills }
    );
    expect(ach.valid).toBe(true);
    expect(ach.value.checkNumber).toBe("");
  });

  it("rejects an invalid method, missing bank account, missing vendor, and bad date", () => {
    expect(validateVendorPaymentInput(goodInput({ paymentMethod: "cash" }), { bills }).valid).toBe(false);
    expect(validateVendorPaymentInput(goodInput({ bankAccountId: "" }), { bills }).valid).toBe(false);
    expect(validateVendorPaymentInput(goodInput({ vendorId: "" }), { bills }).valid).toBe(false);
    expect(validateVendorPaymentInput(goodInput({ paymentDate: "yesterday" }), { bills }).valid).toBe(false);
  });

  it("rejects bills from another vendor, missing bills, voided bills, and duplicates", () => {
    const otherVendor = bill({ id: "b2", vendor_id: "rental_vendor_2" });
    const voided = bill({ id: "b3", status: "voided" });
    const ctx = { bills: [bill(), otherVendor, voided] };
    expect(validateVendorPaymentInput(goodInput({ applications: [{ billId: "b2", amountCents: 100 }] }), ctx).valid).toBe(false);
    expect(validateVendorPaymentInput(goodInput({ applications: [{ billId: "nope", amountCents: 100 }] }), ctx).valid).toBe(false);
    expect(validateVendorPaymentInput(goodInput({ applications: [{ billId: "b3", amountCents: 100 }] }), ctx).valid).toBe(false);
    const dup = validateVendorPaymentInput(
      goodInput({ applications: [{ billId: "rental_vendor_bill_1", amountCents: 100 }, { billId: "rental_vendor_bill_1", amountCents: 100 }] }),
      ctx
    );
    expect(dup.valid).toBe(false);
  });

  it("requires at least one application", () => {
    const { valid, errors } = validateVendorPaymentInput(goodInput({ applications: [] }), { bills });
    expect(valid).toBe(false);
    expect(errors.join(" ")).toMatch(/at least one bill/i);
  });

  it("generates an id when the client omits it", () => {
    const { valid, value } = validateVendorPaymentInput(goodInput({ id: undefined }), { bills });
    expect(valid).toBe(true);
    expect(value.id.startsWith(VENDOR_PAYMENT_ID_PREFIX)).toBe(true);
  });
});

describe("validateVendorPaymentEdit", () => {
  it("accepts memo, check number, and date edits", () => {
    const { valid, value } = validateVendorPaymentEdit({ memo: " corrected ", paymentDate: "2026-10-01", checkNumber: "1043" });
    expect(valid).toBe(true);
    expect(value).toEqual({ memo: "corrected", paymentDate: "2026-10-01", checkNumber: "1043" });
  });

  it("rejects an empty edit and a bad date", () => {
    expect(validateVendorPaymentEdit({}).valid).toBe(false);
    expect(validateVendorPaymentEdit({ paymentDate: "soon" }).valid).toBe(false);
  });
});

describe("canEditPayment / canVoidPayment", () => {
  it("allows changes only while the payment is active", () => {
    expect(canEditPayment({ status: "active" })).toBe(true);
    expect(canVoidPayment({ status: "active" })).toBe(true);
    expect(canEditPayment({ status: "voided" })).toBe(false);
    expect(canVoidPayment({ status: "voided" })).toBe(false);
  });
});

describe("paymentIsReconciled", () => {
  const rec = (ids, status = "active") => ({ status, cleared_event_ids: ids });

  it("is true when any event sits on an active reconciliation", () => {
    expect(paymentIsReconciled(["e1", "e2"], [rec(["e9"]), rec(["e2"])])).toBe(true);
    expect(paymentIsReconciled(["e1"], [rec(["e2"])])).toBe(false);
  });

  it("ignores undone reconciliations and empty inputs", () => {
    expect(paymentIsReconciled(["e1"], [rec(["e1"], "undone")])).toBe(false);
    expect(paymentIsReconciled([], [rec(["e1"])])).toBe(false);
    expect(paymentIsReconciled(["e1"], [])).toBe(false);
  });
});

describe("serializeVendorPayment", () => {
  it("maps the row and its bill applications to API shape", () => {
    const row = {
      id: "p1", vendor_id: "v1", payment_date: "2026-09-30", payment_method: "check",
      amount_cents: 25000, bank_account_id: "b1", check_number: "1042", memo: "m",
      financial_event_ids: ["e1"], status: "active", void_reason: null, voided_at: null,
      created_at: "2026-09-30T00:00:00Z", updated_at: "2026-09-30T00:00:00Z",
    };
    const serialized = serializeVendorPayment(row, {
      vendorName: "Acme Plumbing",
      applications: [{ bill_id: "bill1", amount_cents: 25000, bill_bill_date: "2026-09-15", bill_due_date: "2026-10-15", bill_amount_cents: 25000 }],
    });
    expect(serialized).toMatchObject({
      id: "p1", vendorId: "v1", vendorName: "Acme Plumbing", paymentMethod: "check",
      checkNumber: "1042", amountCents: 25000, status: "active", eventIds: ["e1"],
    });
    expect(serialized.applications).toEqual([
      { billId: "bill1", amountCents: 25000, billBillDate: "2026-09-15", billDueDate: "2026-10-15", billAmountCents: 25000 },
    ]);
  });
});
