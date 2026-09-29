import { describe, expect, it } from "vitest";
import {
  RECEIPT_RECIPIENT_TYPE,
  buildBorrowerReceiptEmail,
  buildOwnerReceiptEmail,
  buildReceiptDeliveryId,
  buildReceiptEmail,
  buildReceiptProviderIdempotencyKey,
  isBorrowerReceiptAllowed,
  parseActivationCutoff,
  resolvePaymentReceiptConfig,
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

describe("resolvePaymentReceiptConfig", () => {
  it("parses the borrower allowlist from PF_RECEIPT_BORROWER_IDS", () => {
    const config = resolvePaymentReceiptConfig({
      PF_RECEIPT_BORROWER_IDS: "pf_brw_ethan, pf_brw_tyler",
      OWNER_PAYMENT_NOTIFICATIONS_ENABLED: "true",
    });
    expect(config.allowedBorrowerIds).toEqual(["pf_brw_ethan", "pf_brw_tyler"]);
  });

  it("fails closed with no borrower allowlist configured", () => {
    const config = resolvePaymentReceiptConfig({ OWNER_PAYMENT_NOTIFICATIONS_ENABLED: "true" });
    expect(config.allowedBorrowerIds).toEqual([]);
    expect(isBorrowerReceiptAllowed(config, "pf_brw_ethan")).toBe(false);
  });
});

describe("isBorrowerReceiptAllowed", () => {
  const config = { allowedBorrowerIds: ["pf_brw_ethan", "pf_brw_tyler"] };

  it("allows listed borrowers", () => {
    expect(isBorrowerReceiptAllowed(config, "pf_brw_ethan")).toBe(true);
    expect(isBorrowerReceiptAllowed(config, "pf_brw_tyler")).toBe(true);
  });

  it("denies unlisted borrowers", () => {
    expect(isBorrowerReceiptAllowed(config, "pf_brw_stranger")).toBe(false);
  });

  it("denies missing borrower ids", () => {
    expect(isBorrowerReceiptAllowed(config, null)).toBe(false);
    expect(isBorrowerReceiptAllowed(config, undefined)).toBe(false);
  });

  it("denies everything when the allowlist is empty", () => {
    expect(isBorrowerReceiptAllowed({ allowedBorrowerIds: [] }, "pf_brw_ethan")).toBe(false);
    expect(isBorrowerReceiptAllowed({}, "pf_brw_ethan")).toBe(false);
  });
});

describe("parseActivationCutoff", () => {
  it("parses an explicit UTC timestamp to ISO", () => {
    expect(parseActivationCutoff("2026-09-29T20:00:00Z")).toBe("2026-09-29T20:00:00.000Z");
  });

  it("returns null when unset", () => {
    expect(parseActivationCutoff(undefined)).toBeNull();
    expect(parseActivationCutoff("")).toBeNull();
  });

  it("returns null for unparseable values (fail-closed)", () => {
    expect(parseActivationCutoff("not-a-date")).toBeNull();
  });
});

describe("resolvePaymentReceiptConfig activation cutoff", () => {
  it("carries the parsed cutoff through", () => {
    const config = resolvePaymentReceiptConfig({
      PAYMENT_RECEIPTS_ACTIVATED_AT: "2026-09-29T20:00:00Z",
    });
    expect(config.activatedAt).toBe("2026-09-29T20:00:00.000Z");
  });

  it("is null when the env var is unset", () => {
    expect(resolvePaymentReceiptConfig({}).activatedAt).toBeNull();
  });
});
