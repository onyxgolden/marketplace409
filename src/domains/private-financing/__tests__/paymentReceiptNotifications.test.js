import { describe, expect, it } from "vitest";
import {
  RECEIPT_RECIPIENT_TYPE,
  buildBorrowerReceiptEmail,
  buildOwnerReceiptEmail,
  buildReceiptDeliveryId,
  buildReceiptEmail,
  buildReceiptProviderIdempotencyKey,
} from "../paymentReceiptNotifications.js";

const FACTS = {
  borrowerName: "Ethan Morgan",
  amountCents: 50000,
  product: "personal_loan",
  occurredAt: "2026-09-26T23:54:01.222Z",
  isAutopay: false,
};

describe("buildReceiptDeliveryId", () => {
  it("is deterministic for the same logical delivery", () => {
    const args = { ownerId: "o1", paymentId: "pf_payment_1", recipientType: "owner" };
    expect(buildReceiptDeliveryId(args)).toBe(buildReceiptDeliveryId(args));
  });

  it("differs by recipient type", () => {
    expect(
      buildReceiptDeliveryId({ ownerId: "o1", paymentId: "pf_payment_1", recipientType: "owner" }),
    ).not.toBe(
      buildReceiptDeliveryId({ ownerId: "o1", paymentId: "pf_payment_1", recipientType: "borrower" }),
    );
  });

  it("rejects unknown recipient types", () => {
    expect(() =>
      buildReceiptDeliveryId({ ownerId: "o1", paymentId: "p1", recipientType: "landlord" }),
    ).toThrow();
  });
});

describe("buildReceiptProviderIdempotencyKey", () => {
  it("is stable per delivery id", () => {
    expect(buildReceiptProviderIdempotencyKey("pf_receipt_x")).toBe("pf-receipt-pf_receipt_x");
  });
});

describe("buildOwnerReceiptEmail", () => {
  it("names the borrower, amount, and portal source", () => {
    const email = buildOwnerReceiptEmail(FACTS);
    expect(email.subject).toBe("Personal loan payment received: $500.00 from Ethan Morgan");
    expect(email.bodyText).toContain("portal payment of $500.00");
    expect(email.bodyText).toContain("personal loan");
    expect(email.bodyText).toContain("September 26, 2026");
  });

  it("says automatic payment for autopay-sourced payments", () => {
    const email = buildOwnerReceiptEmail({ ...FACTS, isAutopay: true });
    expect(email.bodyText).toContain("automatic payment of $500.00");
  });

  it("rejects non-positive amounts", () => {
    expect(() => buildOwnerReceiptEmail({ ...FACTS, amountCents: 0 })).toThrow();
  });
});

describe("buildBorrowerReceiptEmail", () => {
  it("confirms receipt to the borrower", () => {
    const email = buildBorrowerReceiptEmail(FACTS);
    expect(email.subject).toBe("Payment received: $500.00 applied to your personal loan");
    expect(email.bodyText).toContain("Hi Ethan Morgan");
    expect(email.bodyText).toContain("$500.00 on September 26, 2026");
  });
});

describe("buildReceiptEmail", () => {
  it("dispatches on recipient type", () => {
    expect(buildReceiptEmail({ recipientType: RECEIPT_RECIPIENT_TYPE.OWNER, facts: FACTS }).subject).toContain(
      "Personal loan payment received",
    );
    expect(
      buildReceiptEmail({ recipientType: RECEIPT_RECIPIENT_TYPE.BORROWER, facts: FACTS }).subject,
    ).toContain("Payment received: $500.00");
  });

  it("rejects unknown recipient types", () => {
    expect(() => buildReceiptEmail({ recipientType: "nope", facts: FACTS })).toThrow();
  });
});
