import { describe, expect, it } from "vitest";
import {
  billBalanceCents,
  buildVendorBillId,
  buildVendorBillSourceKey,
  canEditBill,
  canVoidBill,
  isBillOverdue,
  serializeVendorBill,
  validateVendorBillEdit,
  validateVendorBillInput,
  VENDOR_BILL_ID_PREFIX,
} from "./vendorBills";

const codes = new Set(["property_repairs", "utilities"]);

const goodInput = {
  vendorId: "rental_vendor_abc",
  billDate: "2026-09-15",
  dueDate: "2026-10-15",
  amountCents: 25000,
  expenseAccountCode: "property_repairs",
  propertyId: "prop_1",
  memo: "Water heater",
};

const openBill = {
  id: "b1", vendor_id: "v1", bill_date: "2026-09-15", due_date: "2026-10-15",
  amount_cents: 25000, paid_amount_cents: 0, status: "open",
};

describe("validateVendorBillInput", () => {
  it("accepts a complete valid bill", () => {
    const check = validateVendorBillInput(goodInput, { expenseAccountCodes: codes });
    expect(check.valid).toBe(true);
    expect(check.value.amountCents).toBe(25000);
  });

  it("requires vendor, dates, amount, and an expense account", () => {
    expect(validateVendorBillInput({ ...goodInput, vendorId: "" }, { expenseAccountCodes: codes }).valid).toBe(false);
    expect(validateVendorBillInput({ ...goodInput, billDate: "15/09/2026" }, { expenseAccountCodes: codes }).valid).toBe(false);
    expect(validateVendorBillInput({ ...goodInput, amountCents: 0 }, { expenseAccountCodes: codes }).valid).toBe(false);
    expect(validateVendorBillInput({ ...goodInput, amountCents: 10.5 }, { expenseAccountCodes: codes }).valid).toBe(false);
    expect(validateVendorBillInput({ ...goodInput, expenseAccountCode: "" }, { expenseAccountCodes: codes }).valid).toBe(false);
  });

  it("rejects a due date before the bill date", () => {
    const check = validateVendorBillInput({ ...goodInput, dueDate: "2026-09-01" }, { expenseAccountCodes: codes });
    expect(check.valid).toBe(false);
    expect(check.errors.join(" ")).toMatch(/before the bill date/);
  });

  it("rejects an inactive or unknown account code, but skips the check in legacy mode", () => {
    const bad = validateVendorBillInput({ ...goodInput, expenseAccountCode: "rental_income" }, { expenseAccountCodes: codes });
    expect(bad.valid).toBe(false);
    const legacy = validateVendorBillInput({ ...goodInput, expenseAccountCode: "rental_income" }, { expenseAccountCodes: null });
    expect(legacy.valid).toBe(true);
  });
});

describe("bill status rules", () => {
  it("edits only open, unpaid bills", () => {
    expect(canEditBill(openBill)).toBe(true);
    expect(canEditBill({ ...openBill, paid_amount_cents: 100 })).toBe(false);
    expect(canEditBill({ ...openBill, status: "paid" })).toBe(false);
    expect(canEditBill({ ...openBill, status: "voided" })).toBe(false);
  });

  it("voids open bills but never paid or already-voided ones", () => {
    expect(canVoidBill(openBill)).toBe(true);
    expect(canVoidBill({ ...openBill, status: "paid" })).toBe(false);
    expect(canVoidBill({ ...openBill, status: "voided" })).toBe(false);
    // A bill with any applied payment can never be voided — even when the
    // status still reads open (concurrent payment landed first).
    expect(canVoidBill({ ...openBill, status: "partial" })).toBe(false);
    expect(canVoidBill({ ...openBill, status: "open", paid_amount_cents: 1 })).toBe(false);
  });
});

describe("validateVendorBillEdit", () => {
  it("accepts a partial patch on an open bill", () => {
    const check = validateVendorBillEdit({ memo: "Updated", amountCents: 26000 }, openBill, { expenseAccountCodes: codes });
    expect(check.valid).toBe(true);
    expect(check.patch.memo).toBe("Updated");
    expect(check.patch.amount_cents).toBe(26000);
  });

  it("refuses to edit a paid bill", () => {
    const check = validateVendorBillEdit({ memo: "x" }, { ...openBill, status: "paid" }, { expenseAccountCodes: codes });
    expect(check.valid).toBe(false);
  });

  it("refuses an amount below what is already paid", () => {
    const check = validateVendorBillEdit(
      { amountCents: 5000 },
      { ...openBill, paid_amount_cents: 10000 },
      { expenseAccountCodes: codes }
    );
    // paid>0 also makes canEditBill false — either path must refuse
    expect(check.valid).toBe(false);
  });

  it("refuses an empty patch", () => {
    expect(validateVendorBillEdit({}, openBill, { expenseAccountCodes: codes }).valid).toBe(false);
  });
});

describe("billBalanceCents / isBillOverdue / serializeVendorBill", () => {
  it("computes the remaining balance", () => {
    expect(billBalanceCents(openBill)).toBe(25000);
    expect(billBalanceCents({ ...openBill, paid_amount_cents: 25000 })).toBe(0);
  });

  it("flags overdue open bills only", () => {
    expect(isBillOverdue(openBill, "2026-10-16")).toBe(true);
    expect(isBillOverdue(openBill, "2026-10-15")).toBe(false);
    expect(isBillOverdue({ ...openBill, status: "paid" }, "2026-10-16")).toBe(false);
    expect(isBillOverdue({ ...openBill, status: "voided" }, "2026-10-16")).toBe(false);
  });

  it("serializes with a computed balance", () => {
    const out = serializeVendorBill(openBill, "Acme");
    expect(out.vendorName).toBe("Acme");
    expect(out.balanceCents).toBe(25000);
    expect(out.billDate).toBe("2026-09-15");
  });
});

describe("buildVendorBillId", () => {
  it("uses the bill prefix, is unique, and derives a stable source key", () => {
    const id = buildVendorBillId();
    expect(id.startsWith(VENDOR_BILL_ID_PREFIX)).toBe(true);
    expect(buildVendorBillId()).not.toBe(id);
    expect(buildVendorBillSourceKey(id)).toBe(`vendorbill:${id}`);
  });
});
