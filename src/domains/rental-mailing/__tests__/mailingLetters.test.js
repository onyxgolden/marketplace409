import { describe, expect, it } from "vitest";
import {
  LETTER_STATUSES,
  canTransitionLetterStatus,
  assertLetterStatusTransition,
  assertMailingEvidenceRules,
  validateTrackingNumber,
  validateCreateBatchInput,
  summarizeBatchLetters,
  formatLetterForFile,
} from "../mailingLetters";

describe("letter status machine", () => {
  it("knows the three statuses", () => {
    expect(LETTER_STATUSES).toEqual(["queued", "mailed", "delivered"]);
  });

  it("allows queued → mailed → delivered", () => {
    expect(canTransitionLetterStatus("queued", "mailed")).toBe(true);
    expect(canTransitionLetterStatus("mailed", "delivered")).toBe(true);
  });

  it("allows honest reversals for corrections", () => {
    expect(canTransitionLetterStatus("mailed", "queued")).toBe(true);
    expect(canTransitionLetterStatus("delivered", "mailed")).toBe(true);
  });

  it("rejects skipping ahead and rewinding to queued from delivered", () => {
    expect(canTransitionLetterStatus("queued", "delivered")).toBe(false);
    expect(canTransitionLetterStatus("delivered", "queued")).toBe(false);
    expect(canTransitionLetterStatus("queued", "queued")).toBe(false);
  });

  it("rejects unknown statuses", () => {
    expect(canTransitionLetterStatus("queued", "lost")).toBe(false);
    expect(canTransitionLetterStatus("lost", "mailed")).toBe(false);
  });

  it("assert throws a plain-English error on invalid transitions", () => {
    expect(() => assertLetterStatusTransition("queued", "delivered")).toThrow(/cannot move from "queued" to "delivered"/);
    expect(() => assertLetterStatusTransition("mailed", "delivered")).not.toThrow();
  });
});

describe("tracking number validation", () => {
  it("accepts a USPS-style number, normalizing case and separators", () => {
    expect(validateTrackingNumber("9407 1111 1111 1111 1111 11")).toBe("9407111111111111111111");
    expect(validateTrackingNumber(" 1z-999-aaa-01-2345-6789 ")).toBe("1Z999AAA0123456789");
  });

  it("rejects blanks and implausible values", () => {
    expect(() => validateTrackingNumber("")).toThrow(/tracking number is required/);
    expect(() => validateTrackingNumber("abc")).toThrow(/does not look like a tracking number/);
    expect(() => validateTrackingNumber("x".repeat(31))).toThrow(/does not look like a tracking number/);
    expect(() => validateTrackingNumber("9407!!1111")).toThrow(/does not look like a tracking number/);
  });
});

describe("certified-mail evidence rules", () => {
  const letter = (status, trackingNumber) => ({ status, tracking_number: trackingNumber });

  it("requires a tracking number to enter mailed", () => {
    expect(() => assertMailingEvidenceRules({ letter: letter("queued", null), nextStatus: "mailed" }))
      .toThrow(/tracking number/);
    expect(() => assertMailingEvidenceRules({ letter: letter("queued", null), nextStatus: "mailed", nextTrackingNumber: "9407111111111111111111" }))
      .not.toThrow();
    expect(() => assertMailingEvidenceRules({ letter: letter("queued", "9407111111111111111111"), nextStatus: "mailed" }))
      .not.toThrow();
  });

  it("requires a tracking number to enter delivered", () => {
    expect(() => assertMailingEvidenceRules({ letter: letter("mailed", null), nextStatus: "delivered" }))
      .toThrow(/tracking number/);
    expect(() => assertMailingEvidenceRules({ letter: letter("mailed", "9407111111111111111111"), nextStatus: "delivered" }))
      .not.toThrow();
  });

  it("forbids clearing tracking on mailed or delivered", () => {
    expect(() => assertMailingEvidenceRules({ letter: letter("mailed", "9407111111111111111111"), nextTrackingNumber: null }))
      .toThrow(/tracking number/);
    expect(() => assertMailingEvidenceRules({ letter: letter("delivered", "9407111111111111111111"), nextTrackingNumber: null }))
      .toThrow(/reopen it as mailed/);
  });

  it("allows clearing tracking while still queued", () => {
    expect(() => assertMailingEvidenceRules({ letter: letter("queued", "9407111111111111111111"), nextTrackingNumber: null }))
      .not.toThrow();
  });

  it("forbids changing tracking once delivered until the delivery is reversed", () => {
    expect(() => assertMailingEvidenceRules({
      letter: letter("delivered", "9407111111111111111111"), nextTrackingNumber: "9407222222222222222222",
    })).toThrow(/reopen it as mailed/);
    // The honest correction path: reopen delivered → mailed first, then change.
    expect(() => assertMailingEvidenceRules({
      letter: letter("mailed", "9407111111111111111111"), nextTrackingNumber: "9407222222222222222222",
    })).not.toThrow();
    // Reversing and correcting in one request is the same workflow.
    expect(() => assertMailingEvidenceRules({
      letter: letter("delivered", "9407111111111111111111"), nextStatus: "mailed", nextTrackingNumber: "9407222222222222222222",
    })).not.toThrow();
  });

  it("ignores requests that touch nothing", () => {
    expect(() => assertMailingEvidenceRules({ letter: letter("queued", null) })).not.toThrow();
    expect(() => assertMailingEvidenceRules({
      letter: letter("delivered", "9407111111111111111111"), nextTrackingNumber: "9407111111111111111111",
    })).not.toThrow();
  });
});

describe("create-batch input validation", () => {
  it("requires a template and at least one tenant", () => {
    expect(validateCreateBatchInput({}).ok).toBe(false);
    expect(validateCreateBatchInput({ templateId: "tpl_1" }).ok).toBe(false);
    const good = validateCreateBatchInput({ templateId: "tpl_1", tenantIds: ["t1", "t2"] });
    expect(good.ok).toBe(true);
    expect(good.clean.tenantIds).toEqual(["t1", "t2"]);
  });

  it("deduplicates tenant ids so a tenant never gets two letters in one batch", () => {
    const result = validateCreateBatchInput({ templateId: "tpl_1", tenantIds: ["t1", "t1", " t2 "] });
    expect(result.ok).toBe(true);
    expect(result.clean.tenantIds).toEqual(["t1", "t2"]);
  });

  it("caps the batch size and trims the name", () => {
    const many = Array.from({ length: 201 }, (_, i) => `t${i}`);
    expect(validateCreateBatchInput({ templateId: "tpl_1", tenantIds: many }).ok).toBe(false);
    const named = validateCreateBatchInput({ name: "  October late notices  ", templateId: "tpl_1", tenantIds: ["t1"] });
    expect(named.clean.name).toBe("October late notices");
  });

  it("keeps per-tenant address overrides and the return address", () => {
    const result = validateCreateBatchInput({
      templateId: "tpl_1",
      tenantIds: ["t1"],
      returnAddress: "Owner\n1 Main St",
      recipientAddresses: { t1: "PO Box 5" },
    });
    expect(result.clean.returnAddress).toBe("Owner\n1 Main St");
    expect(result.clean.recipientAddresses).toEqual({ t1: "PO Box 5" });
  });
});

describe("batch summary", () => {
  it("counts letters by status", () => {
    const summary = summarizeBatchLetters([
      { status: "queued" }, { status: "queued" }, { status: "mailed" }, { status: "delivered" },
    ]);
    expect(summary).toEqual({ total: 4, queued: 2, mailed: 1, delivered: 1 });
  });

  it("handles an empty batch", () => {
    expect(summarizeBatchLetters([])).toEqual({ total: 0, queued: 0, mailed: 0, delivered: 0 });
  });
});

describe("letter file rendering", () => {
  it("builds the plain-text compliance copy with addresses and the certified-mail line", () => {
    const text = formatLetterForFile({
      subject: "Past-due rent",
      body: "Dear Eric,",
      tenantName: "Eric Carrillo",
      tenantAddress: "308 Paula\nHouston, TX",
      returnAddress: "Jason Morgan\n1 Main St",
      letterDate: "Oct 1, 2026",
    });
    expect(text).toContain("Jason Morgan");
    expect(text).toContain("Oct 1, 2026");
    expect(text).toContain("Eric Carrillo");
    expect(text).toContain("VIA CERTIFIED MAIL");
    expect(text).toContain("Re: Past-due rent");
    expect(text).toContain("Dear Eric,");
  });

  it("omits the return address and subject lines when absent", () => {
    const text = formatLetterForFile({ body: "Hi", tenantName: "T", tenantAddress: "A" });
    expect(text).toContain("Hi");
    expect(text).not.toContain("Re:");
  });
});
