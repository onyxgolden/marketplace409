// FORGE Doc-to-Overview — slice A: classification and exclusion tests.

import { describe, expect, it } from "vitest";
import { classifyDocument } from "./classification.js";

function doc(overrides = {}) {
  return { text: "Photosynthesis converts sunlight, water and carbon dioxide into sugars.", permissionGranted: true, ...overrides };
}

describe("admission", () => {
  it("admits clean non-procedure reference prose", () => {
    const result = classifyDocument(doc());
    expect(result.decision).toBe("admit");
    expect(result.reasons).toEqual([]);
  });

  it("admits a mere mention of tenants without a tenant record", () => {
    const result = classifyDocument(doc({
      text: "Tenant improvement allowances are negotiated in commercial leases as part of the fit-out.",
    }));
    expect(result.decision).toBe("admit");
  });
});

describe("procedure holds", () => {
  it("holds SOP, work-instruction, operating-instruction and step-by-step text", () => {
    expect(classifyDocument(doc({ text: "Standard Operating Procedure: valve inspection." })).decision).toBe("hold");
    expect(classifyDocument(doc({ text: "Work instruction WI-42: torque the bolts." })).decision).toBe("hold");
    expect(classifyDocument(doc({ text: "Operating instructions for the pump skid." })).decision).toBe("hold");
    expect(classifyDocument(doc({ text: "Follow this step-by-step guide to calibrate." })).decision).toBe("hold");
  });

  it("holds checklists and numbered step sequences", () => {
    const checklist = "- [ ] Open the valve\n- [ ] Check the gauge\n- [x] Record the reading";
    expect(classifyDocument(doc({ text: checklist })).decision).toBe("hold");
    const steps = "1. Open the valve.\n2. Check the gauge.\n3. Record the reading.\n4. Close the valve.";
    expect(classifyDocument(doc({ text: steps })).decision).toBe("hold");
    const headers = "Step 1: Open the valve.\nStep 2: Check the gauge.";
    expect(classifyDocument(doc({ text: headers })).decision).toBe("hold");
  });

  it("names the procedure signal codes", () => {
    const result = classifyDocument(doc({ text: "Standard Operating Procedure: valve inspection." }));
    expect(result.reasons.map((r) => r.code)).toContain("PROCEDURE_SOP");
  });
});

describe("exclusion rejections", () => {
  it("rejects secrets-bearing text", () => {
    expect(classifyDocument(doc({ text: "Key: -----BEGIN PRIVATE KEY-----\nMII..." })).decision).toBe("reject");
    expect(classifyDocument(doc({ text: "token ghp_abcdefghij1234567890" })).decision).toBe("reject");
    expect(classifyDocument(doc({ text: "password: hunter2" })).decision).toBe("reject");
    expect(classifyDocument(doc({ text: "api_key=AKIAIOSFODNN7EXAMPLE" })).decision).toBe("reject");
  });

  it("rejects SSNs, Luhn-valid cards, bank accounts and tenant/ledger records", () => {
    expect(classifyDocument(doc({ text: "SSN on file: 123-45-6789" })).decision).toBe("reject");
    expect(classifyDocument(doc({ text: "Card charged: 4111 1111 1111 1111" })).decision).toBe("reject");
    expect(classifyDocument(doc({ text: "Account number: 123456789" })).decision).toBe("reject");
    expect(classifyDocument(doc({ text: "Tenant Maria Lopez, 12 Oak Street, rent $1,200 per month." })).decision).toBe("reject");
    expect(classifyDocument(doc({ text: "General ledger, balance $4,200 total for the month." })).decision).toBe("reject");
  });

  it("does not reject a long number that fails Luhn", () => {
    // 1234 5678 9012 3456 fails Luhn — a part number, not a card.
    expect(classifyDocument(doc({ text: "Part number 1234 5678 9012 3456 ships Tuesday." })).decision).toBe("admit");
  });

  it("rejects missing permission, oversized and unreadable sources", () => {
    expect(classifyDocument(doc({ permissionGranted: false })).decision).toBe("reject");
    expect(classifyDocument(doc({ text: "x ".repeat(600000) })).decision).toBe("reject");
    expect(classifyDocument(doc({ text: "x ".repeat(600000) })).reasons[0].code).toBe("OVERSIZED");
    expect(classifyDocument(doc({ text: "" })).reasons[0].code).toBe("UNREADABLE");
    expect(classifyDocument(doc({ text: "�".repeat(100) + "hello" })).reasons[0].code).toBe("UNREADABLE");
    expect(classifyDocument(doc({ pageCount: 501 })).reasons[0].code).toBe("OVERSIZED");
  });
});
