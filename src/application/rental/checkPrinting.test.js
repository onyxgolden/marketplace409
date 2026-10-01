import { describe, expect, it } from "vitest";
import {
  amountCentsToWords,
  buildCheckRunId,
  checkRunPrintProblems,
  serializeCheckRun,
  validateCheckRunInput,
} from "./checkPrinting";

const checkPayment = (overrides = {}) => ({
  id: "rental_vendor_payment_1",
  payment_method: "check",
  status: "active",
  amount_cents: 25000,
  bank_account_id: "bank_1",
  check_number: "1042",
  ...overrides,
});

const goodInput = (overrides = {}) => ({
  id: "rental_check_run_1",
  runDate: "2026-09-30",
  bankAccountId: "bank_1",
  paymentIds: ["rental_vendor_payment_1"],
  ...overrides,
});

describe("amountCentsToWords", () => {
  it("writes standard check amounts", () => {
    expect(amountCentsToWords(1)).toBe("Zero and 01/100");
    expect(amountCentsToWords(100)).toBe("One and 00/100");
    expect(amountCentsToWords(25000)).toBe("Two hundred fifty and 00/100");
    expect(amountCentsToWords(123456)).toBe("One thousand two hundred thirty-four and 56/100");
    expect(amountCentsToWords(160000)).toBe("One thousand six hundred and 00/100");
    expect(amountCentsToWords(1000000)).toBe("Ten thousand and 00/100");
    expect(amountCentsToWords(123456789)).toBe("One million two hundred thirty-four thousand five hundred sixty-seven and 89/100");
  });

  it("handles teens, hyphenated tens, and exact hundreds", () => {
    expect(amountCentsToWords(1100)).toBe("Eleven and 00/100");
    expect(amountCentsToWords(1900)).toBe("Nineteen and 00/100");
    expect(amountCentsToWords(2100)).toBe("Twenty-one and 00/100");
    expect(amountCentsToWords(9900)).toBe("Ninety-nine and 00/100");
    expect(amountCentsToWords(10000)).toBe("One hundred and 00/100");
    expect(amountCentsToWords(10100)).toBe("One hundred one and 00/100");
  });

  it("rejects negative and non-integer amounts", () => {
    expect(() => amountCentsToWords(-100)).toThrow(RangeError);
    expect(() => amountCentsToWords(Number.NaN)).toThrow(RangeError);
  });
});

describe("validateCheckRunInput", () => {
  it("accepts a well-formed run and totals the checks", () => {
    const payments = [
      checkPayment(),
      checkPayment({ id: "rental_vendor_payment_2", amount_cents: 10000, check_number: "1043" }),
    ];
    const { valid, errors, value } = validateCheckRunInput(
      goodInput({ paymentIds: ["rental_vendor_payment_1", "rental_vendor_payment_2"] }),
      { payments }
    );
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
    expect(value.checkCount).toBe(2);
    expect(value.totalCents).toBe(35000);
  });

  it("refuses voided payments — voided payments must never print", () => {
    const { valid, errors } = validateCheckRunInput(goodInput(), {
      payments: [checkPayment({ status: "voided" })],
    });
    expect(valid).toBe(false);
    expect(errors).toContain("Voided payments cannot be printed.");
  });

  it("refuses non-check payments", () => {
    const { valid, errors } = validateCheckRunInput(goodInput(), {
      payments: [checkPayment({ payment_method: "ach" })],
    });
    expect(valid).toBe(false);
    expect(errors).toContain("Only check payments can be printed.");
  });

  it("requires every check on the run's bank account", () => {
    const { valid, errors } = validateCheckRunInput(goodInput(), {
      payments: [checkPayment({ bank_account_id: "bank_2" })],
    });
    expect(valid).toBe(false);
    expect(errors).toContain("All checks in a run must be drawn on the same bank account.");
  });

  it("requires a check number on every check", () => {
    const { valid, errors } = validateCheckRunInput(goodInput(), {
      payments: [checkPayment({ check_number: "" })],
    });
    expect(valid).toBe(false);
    expect(errors).toContain("A check payment without a check number cannot be printed.");
  });

  it("requires at least one check and a valid run date", () => {
    const { valid, errors } = validateCheckRunInput(
      goodInput({ paymentIds: [], runDate: "bogus" }),
      { payments: [] }
    );
    expect(valid).toBe(false);
    expect(errors).toContain("Choose at least one check payment to print.");
    expect(errors).toContain("Enter a valid run date (YYYY-MM-DD).");
  });

  it("dedupes repeated payment ids", () => {
    const { valid, value } = validateCheckRunInput(
      goodInput({ paymentIds: ["rental_vendor_payment_1", "rental_vendor_payment_1"] }),
      { payments: [checkPayment()] }
    );
    expect(valid).toBe(true);
    expect(value.checkCount).toBe(1);
  });

  it("generates an id when none is supplied", () => {
    const { valid, value } = validateCheckRunInput(goodInput({ id: undefined }), { payments: [checkPayment()] });
    expect(valid).toBe(true);
    expect(value.id.startsWith("rental_check_run_")).toBe(true);
    expect(buildCheckRunId().startsWith("rental_check_run_")).toBe(true);
  });
});

describe("checkRunPrintProblems", () => {
  const items = [{ vendor_payment_id: "rental_vendor_payment_1" }];

  it("returns no problems for printable checks", () => {
    expect(
      checkRunPrintProblems(items, new Map([["rental_vendor_payment_1", { payment_method: "check", status: "active" }]]))
    ).toEqual([]);
  });

  it("flags voided payments at print time", () => {
    expect(
      checkRunPrintProblems(items, new Map([["rental_vendor_payment_1", { payment_method: "check", status: "voided" }]]))
    ).toContain("A voided payment cannot be printed.");
  });

  it("flags payments that disappeared from the record", () => {
    expect(checkRunPrintProblems(items, new Map())).toContain("A check on this run is no longer on record.");
  });
});

describe("serializeCheckRun", () => {
  it("serializes the run with amount words on every check", () => {
    const serialized = serializeCheckRun(
      {
        id: "rental_check_run_1", run_date: "2026-09-30", bank_account_id: "bank_1",
        check_count: 1, total_amount_cents: 25000, created_at: "2026-09-30T00:00:00Z",
      },
      {
        items: [
          {
            vendor_payment_id: "rental_vendor_payment_1", seq: 0, payee_name: "Acme Plumbing",
            amount_cents: 25000, check_number: "1042", payment_date: "2026-09-28",
            memo: "Invoice 12", bank_account_id: "bank_1",
          },
        ],
      }
    );
    expect(serialized).toMatchObject({
      id: "rental_check_run_1",
      checkCount: 1,
      totalAmountCents: 25000,
      totalAmountWords: "Two hundred fifty and 00/100",
    });
    expect(serialized.checks).toHaveLength(1);
    expect(serialized.checks[0]).toMatchObject({
      payeeName: "Acme Plumbing",
      amountWords: "Two hundred fifty and 00/100",
      checkNumber: "1042",
    });
  });
});
