import { describe, expect, it } from "vitest";
import {
  FIRE_RECORD_LENGTH,
  build1099FireExport,
  build1099SummaryCsv,
} from "./build1099FireExport";

const payer = {
  tin: "123456789",
  name: "409 Marketplace LLC",
  address: "123 Main St",
  city: "Houston",
  state: "TX",
  zip: "77001",
};

const necRecipient = {
  recipientId: "rental_1099_recipient_vendor1",
  displayName: "Acme Plumbing",
  tinType: "ein",
  tin: "987654321",
  addressLine1: "456 Oak Ave",
  city: "Beaumont",
  state: "TX",
  zip: "77701",
  totalCents: 123456, // $1,234.56
  formType: "1099-NEC",
  reportable: true,
};

const miscRecipient = {
  recipientId: "rental_1099_recipient_owner1",
  displayName: "Brandy Morgan",
  tinType: "ssn",
  tin: "111223333",
  addressLine1: "789 Pine Rd",
  city: "Port Arthur",
  state: "TX",
  zip: "77640",
  totalCents: 1920000, // $19,200.00
  formType: "1099-MISC",
  reportable: true,
};

describe("FIRE-format export", () => {
  it("emits CRLF records, each exactly 750 chars, in T/A/B/C/K/F sequence", () => {
    const file = build1099FireExport({ taxYear: 2026, payer, recipients: [necRecipient, miscRecipient] });
    const lines = file.content.split("\r\n").filter((line) => line.length > 0);
    for (const line of lines) expect(line.length).toBe(FIRE_RECORD_LENGTH);
    // T + (A,B,C) x 2 + K + F = 9 records
    expect(lines).toHaveLength(9);
    expect(lines.map((line) => line[0]).join("")).toBe("TABCABCKF");
    for (const line of lines) {
      // The F record is zero-filled per the documented spec (no ### marker).
      if (line[0] !== "F") expect(line.slice(747)).toBe("###");
    }
    expect(file.filename).toBe("FORGE-1099-2026.txt");
    expect(file.bRecordCount).toBe(2);
  });

  it("places the full payee TIN and the zero-padded Box 1 amount at the documented positions", () => {
    const file = build1099FireExport({ taxYear: 2026, payer, recipients: [necRecipient] });
    const bRecord = file.content.split("\r\n").find((line) => line[0] === "B");
    expect(bRecord.slice(5, 14)).toBe("987654321"); // positions 6-14: payee TIN
    expect(bRecord.slice(18, 19)).toBe("1"); // position 19: EIN indicator
    expect(bRecord.slice(160, 172)).toBe("000000123456"); // positions 161-172: $1,234.56
  });

  it("uses the correct type-of-return code per form type", () => {
    const file = build1099FireExport({ taxYear: 2026, payer, recipients: [necRecipient, miscRecipient] });
    const aRecords = file.content.split("\r\n").filter((line) => line[0] === "A");
    expect(aRecords).toHaveLength(2);
    expect(aRecords[0].slice(18, 20)).toBe("NE"); // 1099-NEC
    expect(aRecords[1].slice(18, 20)).toBe("A "); // 1099-MISC
  });

  it("reconciles the C and K record control totals", () => {
    const file = build1099FireExport({ taxYear: 2026, payer, recipients: [necRecipient, miscRecipient] });
    const lines = file.content.split("\r\n");
    const cRecords = lines.filter((line) => line[0] === "C");
    expect(cRecords[0].slice(14, 19)).toBe("00001"); // one B record in NEC group
    expect(cRecords[0].slice(19, 31)).toBe("000000123456"); // NEC group total
    const kRecord = lines.find((line) => line[0] === "K");
    expect(kRecord.slice(5, 10)).toBe("00002"); // two A records (two form types)
    expect(kRecord.slice(10, 15)).toBe("00002"); // two B records total
    expect(kRecord.slice(15, 27)).toBe("000002043456"); // grand total $20,434.56
  });

  it("excludes below-threshold recipients and skips recipients with no TIN, with reasons", () => {
    const file = build1099FireExport({
      taxYear: 2026,
      payer,
      recipients: [
        necRecipient,
        { ...necRecipient, recipientId: "r2", displayName: "Tiny Vendor", reportable: false },
        { ...necRecipient, recipientId: "r3", displayName: "No TIN Vendor", tin: null },
      ],
    });
    expect(file.bRecordCount).toBe(1);
    expect(file.skipped).toHaveLength(1);
    expect(file.skipped[0].recipientId).toBe("r3");
    expect(file.skipped[0].reason).toContain("W-9");
    expect(file.belowThresholdNote).toContain("$600");
  });

  it("throws on a missing tax year", () => {
    expect(() => build1099FireExport({ taxYear: null, payer, recipients: [] })).toThrow();
  });
});

describe("CSV summary companion", () => {
  it("carries masked TINs only — the full value never appears", () => {
    const rows = [{
      displayName: "Acme Plumbing", kind: "vendor", formType: "1099-NEC", formBox: "Box 1 — Nonemployee compensation",
      entityType: "llc", tinMasked: "XXX-XX-4321", totalCents: 123456, paymentCount: 3,
      reportable: true, exclusionReason: null, filingStatus: "ready",
    }];
    const file = build1099SummaryCsv({ taxYear: 2026, rows });
    expect(file.filename).toBe("FORGE-1099-summary-2026.csv");
    expect(file.content).toContain("XXX-XX-4321");
    expect(file.content).not.toContain("987654321");
    expect(file.content).toContain("1099-NEC");
  });
});
