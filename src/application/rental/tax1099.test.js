import { beforeEach, describe, expect, it } from "vitest";
import {
  FORM_TYPE_GUIDE,
  REPORTING_THRESHOLD_CENTS,
  aggregate1099Year,
  canTransitionFilingStatus,
  decryptTin,
  encryptTin,
  maskTin,
  normalizeTin,
  resolveFormType,
  serializeRecipient,
  tinLast4,
  validatePaymentEntryInput,
  validatePayerProfileInput,
  validateRecipientInput,
} from "./tax1099";

const vendorRecipient = (overrides = {}) => ({
  id: "rental_1099_recipient_vendor1",
  kind: "vendor",
  linked_vendor_id: "rental_vendor_1",
  display_name: "Acme Plumbing",
  entity_type: "llc",
  tin_ciphertext: "cipher",
  tin_last4: "6789",
  tin_type: "ein",
  is_active: true,
  ...overrides,
});

const ownerRecipient = (overrides = {}) => ({
  id: "rental_1099_recipient_owner1",
  kind: "owner",
  linked_vendor_id: null,
  display_name: "Brandy Morgan",
  entity_type: "individual",
  tin_ciphertext: "cipher",
  tin_last4: "4321",
  tin_type: "ssn",
  is_active: true,
  ...overrides,
});

describe("1099 form categorization", () => {
  it("maps vendors to 1099-NEC and owners to 1099-MISC", () => {
    expect(resolveFormType("vendor")).toBe("1099-NEC");
    expect(resolveFormType("owner")).toBe("1099-MISC");
  });

  it("carries plain-English guidance for both forms", () => {
    expect(FORM_TYPE_GUIDE["1099-NEC"].box).toContain("Box 1");
    expect(FORM_TYPE_GUIDE["1099-NEC"].plainEnglish).toContain("not your employees");
    expect(FORM_TYPE_GUIDE["1099-MISC"].box).toContain("Rents");
    expect(FORM_TYPE_GUIDE["1099-MISC"].plainEnglish.toLowerCase()).toContain("rents");
  });
});

describe("$600 threshold flagging", () => {
  it("flags exactly $600 as reportable and $599.99 as below threshold", () => {
    const atThreshold = aggregate1099Year({
      recipients: [vendorRecipient()],
      vendorPayments: [{ vendor_id: "rental_vendor_1", payment_date: "2026-03-01", amount_cents: 60000, status: "active" }],
      paymentEntries: [],
      filingStates: [],
      taxYear: 2026,
    });
    expect(atThreshold.rows[0].thresholdMet).toBe(true);
    expect(atThreshold.rows[0].reportable).toBe(true);

    const below = aggregate1099Year({
      recipients: [vendorRecipient()],
      vendorPayments: [{ vendor_id: "rental_vendor_1", payment_date: "2026-03-01", amount_cents: 59999, status: "active" }],
      paymentEntries: [],
      filingStates: [],
      taxYear: 2026,
    });
    expect(below.rows[0].thresholdMet).toBe(false);
    expect(below.rows[0].reportable).toBe(false);
    expect(below.rows[0].exclusionReason).toContain("$600");
  });

  it("returns below-threshold recipients with a flag instead of dropping them silently", () => {
    const { rows, summary } = aggregate1099Year({
      recipients: [vendorRecipient(), vendorRecipient({ id: "r2", display_name: "Tiny Vendor", linked_vendor_id: "rental_vendor_2" })],
      vendorPayments: [
        { vendor_id: "rental_vendor_1", payment_date: "2026-03-01", amount_cents: 60000, status: "active" },
        { vendor_id: "rental_vendor_2", payment_date: "2026-04-01", amount_cents: 5000, status: "active" },
      ],
      paymentEntries: [],
      filingStates: [],
      taxYear: 2026,
    });
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.recipientId === "r2").reportable).toBe(false);
    expect(summary.belowThresholdCount).toBe(1);
    expect(summary.reportableCount).toBe(1);
  });

  it("uses the federal $600 threshold constant", () => {
    expect(REPORTING_THRESHOLD_CENTS).toBe(60000);
  });
});

describe("corporation exclusion", () => {
  it("marks C and S corporations as not reportable with an explanation", () => {
    for (const entityType of ["c_corporation", "s_corporation"]) {
      const { rows } = aggregate1099Year({
        recipients: [vendorRecipient({ entity_type: entityType })],
        vendorPayments: [{ vendor_id: "rental_vendor_1", payment_date: "2026-03-01", amount_cents: 500000, status: "active" }],
        paymentEntries: [],
        filingStates: [],
        taxYear: 2026,
      });
      expect(rows[0].thresholdMet).toBe(true);
      expect(rows[0].corpExcluded).toBe(true);
      expect(rows[0].reportable).toBe(false);
      expect(rows[0].exclusionReason).toContain("corporation");
    }
  });
});

describe("payment aggregation rules", () => {
  it("excludes voided payments and payments from other tax years (cash basis)", () => {
    const { rows } = aggregate1099Year({
      recipients: [vendorRecipient()],
      vendorPayments: [
        { vendor_id: "rental_vendor_1", payment_date: "2026-03-01", amount_cents: 40000, status: "active" },
        { vendor_id: "rental_vendor_1", payment_date: "2026-04-01", amount_cents: 90000, status: "voided" },
        { vendor_id: "rental_vendor_1", payment_date: "2025-12-31", amount_cents: 90000, status: "active" },
        { vendor_id: "rental_vendor_1", payment_date: "2027-01-02", amount_cents: 90000, status: "active" },
      ],
      paymentEntries: [],
      filingStates: [],
      taxYear: 2026,
    });
    expect(rows[0].totalCents).toBe(40000);
    expect(rows[0].paymentCount).toBe(1);
  });

  it("computes 1099-MISC Box 1 from GROSS RENT, never net disbursements", () => {
    // The CHANGES fix: owner Box 1 comes from the ledger's gross rent
    // (grossRentByRecipient), not from manual disbursement entries.
    const { rows, summary } = aggregate1099Year({
      recipients: [ownerRecipient()],
      vendorPayments: [],
      paymentEntries: [
        // A net disbursement entry must NOT count toward Box 1...
        { recipient_id: "rental_1099_recipient_owner1", tax_year: 2026, amount_cents: 100000, status: "active", source: "manual" },
        // ...but a CPA adjustment does.
        { recipient_id: "rental_1099_recipient_owner1", tax_year: 2026, amount_cents: 5000, status: "active", source: "adjustment" },
      ],
      filingStates: [],
      grossRentByRecipient: new Map([
        ["rental_1099_recipient_owner1", { totalCents: 192000, eventCount: 12 }],
      ]),
      taxYear: 2026,
    });
    expect(rows[0].formType).toBe("1099-MISC");
    expect(rows[0].grossRentCents).toBe(192000);
    expect(rows[0].adjustmentCents).toBe(5000);
    expect(rows[0].totalCents).toBe(197000); // 192000 gross + 5000 adjustment
    expect(rows[0].reportable).toBe(true);
    expect(summary.totalsByFormType["1099-MISC"]).toBe(197000);
  });

  it("reports $0 Box 1 for an owner with no linked properties (no gross rent)", () => {
    const { rows } = aggregate1099Year({
      recipients: [ownerRecipient()],
      vendorPayments: [],
      paymentEntries: [
        { recipient_id: "rental_1099_recipient_owner1", tax_year: 2026, amount_cents: 100000, status: "active", source: "manual" },
      ],
      filingStates: [],
      grossRentByRecipient: new Map(), // no linked properties
      taxYear: 2026,
    });
    expect(rows[0].totalCents).toBe(0);
    expect(rows[0].reportable).toBe(false);
  });

  it("exposes linkedPropertyCount so the UI can warn on unattributed owners", () => {
    const { rows } = aggregate1099Year({
      recipients: [ownerRecipient(), ownerRecipient({ id: "rental_1099_recipient_owner2", display_name: "Second Owner" }), vendorRecipient()],
      vendorPayments: [],
      paymentEntries: [],
      filingStates: [],
      grossRentByRecipient: new Map([
        ["rental_1099_recipient_owner1", { totalCents: 192000, eventCount: 12 }],
      ]),
      linkedPropertyIdsByRecipient: new Map([
        ["rental_1099_recipient_owner1", new Set(["prop-a", "prop-b"])],
      ]),
      taxYear: 2026,
    });
    const [owner1, owner2, vendor] = rows;
    expect(owner1.linkedPropertyCount).toBe(2);
    expect(owner2.linkedPropertyCount).toBe(0); // unattributed: UI must warn, never look filing-ready
    expect(vendor.linkedPropertyCount).toBe(0); // vendors don't attribute properties
  });

  it("keeps vendor 1099-NEC aggregation on payments plus all entry sources", () => {
    const { rows } = aggregate1099Year({
      recipients: [vendorRecipient()],
      vendorPayments: [
        { vendor_id: "rental_vendor_1", payment_date: "2026-03-01", amount_cents: 40000, status: "active" },
      ],
      paymentEntries: [
        { recipient_id: "rental_1099_recipient_vendor1", tax_year: 2026, amount_cents: 25000, status: "active", source: "manual" },
      ],
      filingStates: [],
      taxYear: 2026,
    });
    expect(rows[0].totalCents).toBe(65000);
  });

  it("sums per-form-type totals and sorts rows by total descending", () => {
    const { rows, summary } = aggregate1099Year({
      recipients: [vendorRecipient(), ownerRecipient()],
      vendorPayments: [{ vendor_id: "rental_vendor_1", payment_date: "2026-03-01", amount_cents: 61000, status: "active" }],
      paymentEntries: [],
      filingStates: [],
      grossRentByRecipient: new Map([
        ["rental_1099_recipient_owner1", { totalCents: 160000, eventCount: 10 }],
      ]),
      taxYear: 2026,
    });
    expect(rows[0].displayName).toBe("Brandy Morgan");
    expect(summary.totalsByFormType["1099-NEC"]).toBe(61000);
    expect(summary.totalsByFormType["1099-MISC"]).toBe(160000);
  });

  it("skips inactive recipients and joins filing states", () => {
    const { rows } = aggregate1099Year({
      recipients: [vendorRecipient({ is_active: false }), ownerRecipient()],
      vendorPayments: [],
      paymentEntries: [],
      filingStates: [{ recipient_id: "rental_1099_recipient_owner1", tax_year: 2026, status: "ready" }],
      grossRentByRecipient: new Map([
        ["rental_1099_recipient_owner1", { totalCents: 60000, eventCount: 4 }],
      ]),
      taxYear: 2026,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].filingStatus).toBe("ready");
  });
});

describe("TIN masking and encryption", () => {
  beforeEach(() => {
    process.env.FORGE_1099_TIN_KEY = "test-key-do-not-use-in-production";
  });

  it("masks TINs as XXX-XX-1234 and never exposes the full value in masked output", () => {
    const tin = "123456789";
    const masked = maskTin(tin);
    expect(masked).toBe("XXX-XX-6789");
    expect(masked).not.toContain("12345");
  });

  it("serializes recipients without the ciphertext — list views can never leak the full TIN", () => {
    const serialized = serializeRecipient(vendorRecipient());
    expect(serialized.tinMasked).toBe("XXX-XX-6789");
    expect(serialized.tinLast4).toBe("6789");
    expect(serialized.tinOnFile).toBe(true);
    expect("tin_ciphertext" in serialized).toBe(false);
    expect(JSON.stringify(serialized)).not.toContain("cipher");
  });

  it("round-trips encrypt/decrypt and normalizes dashed input", () => {
    expect(tinLast4("123-45-6789")).toBe("6789");
    const payload = encryptTin("123-45-6789");
    expect(payload).not.toContain("123456789");
    expect(payload.startsWith("v1.")).toBe(true);
    expect(decryptTin(payload)).toBe("123456789");
  });

  it("rejects non-9-digit TINs", () => {
    expect(() => normalizeTin("12345")).toThrow();
    expect(() => normalizeTin("")).toThrow();
  });

  it("fails closed when the encryption key is not configured", () => {
    delete process.env.FORGE_1099_TIN_KEY;
    expect(() => encryptTin("123456789")).toThrowError(expect.objectContaining({ code: "TIN_KEY_MISSING" }));
  });
});

describe("filing status machine", () => {
  it("allows the forward path not_started -> ready -> exported -> filed_manually", () => {
    expect(canTransitionFilingStatus("not_started", "ready")).toBe(true);
    expect(canTransitionFilingStatus("ready", "exported")).toBe(true);
    expect(canTransitionFilingStatus("exported", "filed_manually")).toBe(true);
  });

  it("allows reset and re-export but never skips or escapes the terminal state", () => {
    expect(canTransitionFilingStatus("ready", "not_started")).toBe(true);
    expect(canTransitionFilingStatus("exported", "ready")).toBe(true);
    expect(canTransitionFilingStatus("not_started", "exported")).toBe(false);
    expect(canTransitionFilingStatus("not_started", "filed_manually")).toBe(false);
    expect(canTransitionFilingStatus("filed_manually", "ready")).toBe(false);
    expect(canTransitionFilingStatus("filed_manually", "not_started")).toBe(false);
    expect(canTransitionFilingStatus("bogus", "ready")).toBe(false);
  });
});

describe("input validation", () => {
  it("requires a name and a valid kind, and validates TIN/state/ZIP when supplied", () => {
    expect(validateRecipientInput({ kind: "vendor", displayName: "" }).valid).toBe(false);
    expect(validateRecipientInput({ kind: "alien", displayName: "X" }).valid).toBe(false);
    expect(validateRecipientInput({ kind: "vendor", displayName: "Acme", tin: "12345" }).valid).toBe(false);
    expect(validateRecipientInput({ kind: "vendor", displayName: "Acme", state: "Texas" }).valid).toBe(false);
    expect(validateRecipientInput({ kind: "vendor", displayName: "Acme", zip: "abc" }).valid).toBe(false);
    const ok = validateRecipientInput({ kind: "owner", displayName: "Brandy Morgan", tin: "123-45-6789", state: "tx", zip: "77001" });
    expect(ok.valid).toBe(true);
    expect(ok.value.tin).toBe("123456789");
    expect(ok.value.state).toBe("TX");
  });

  it("treats an empty TIN as not-supplied (leave unchanged on PATCH)", () => {
    const result = validateRecipientInput({ kind: "vendor", displayName: "Acme", tin: "" });
    expect(result.valid).toBe(true);
    expect(result.value.tin).toBeNull();
  });

  it("validates payment entries and payer profiles", () => {
    expect(validatePaymentEntryInput({ recipientId: "", taxYear: 2026, paymentDate: "2026-01-15", amountCents: 100 }).valid).toBe(false);
    expect(validatePaymentEntryInput({ recipientId: "r1", taxYear: 1999, paymentDate: "2026-01-15", amountCents: 100 }).valid).toBe(false);
    expect(validatePaymentEntryInput({ recipientId: "r1", taxYear: 2026, paymentDate: "01/15/2026", amountCents: 100 }).valid).toBe(false);
    expect(validatePaymentEntryInput({ recipientId: "r1", taxYear: 2026, paymentDate: "2026-01-15", amountCents: 0 }).valid).toBe(false);
    expect(validatePaymentEntryInput({ recipientId: "r1", taxYear: 2026, paymentDate: "2026-01-15", amountCents: 160000 }).valid).toBe(true);
    expect(validatePayerProfileInput({ businessName: "", taxYear: 2026 }).valid).toBe(false);
    expect(validatePayerProfileInput({ businessName: "409 Marketplace LLC", taxYear: 2026, tin: "12-3456789" }).valid).toBe(true);
  });
});
