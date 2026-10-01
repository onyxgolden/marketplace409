// Rentec parity R23 — IRS-modeled 1099 export file builder.
//
// FORMAT CHOSEN (documented here and in IRS_FIRE_FORMAT.md): a fixed-width,
// 750-character-per-record file with CRLF line endings, record sequence
//   T (Transmitter) → A (Payer, one per form type: 1099-NEC, 1099-MISC)
//     → B (Payee, one per reportable recipient) → C (End of Payer)
//   → K (End of Transmission) → F (End of Transmission summary),
// modeled on IRS Publication 1220 (the FIRE electronic filing layout).
//
// GUIDANCE ONLY — NOT IRS-CERTIFIED. Field positions follow the documented
// spec in IRS_FIRE_FORMAT.md; the CPA must validate against the current-year
// Pub 1220 before any real filing. Do not present this file as IRS-certified.
//
// Amounts: 12-character, zero-padded, whole cents (no decimal point), so
// $1,234.56 renders as "000000123456". All text is uppercased, truncated to
// its field width, and blank-padded. Records that do not reach 750 characters
// are a hard error (a short record means a broken layout).

import { REPORTING_THRESHOLD_CENTS, resolveFormType } from "./tax1099.js";

export const FIRE_RECORD_LENGTH = 750;
const LINE_ENDING = "\r\n";

// Amount codes per form type (FIRE "Amount Codes" on the A record):
// NEC reports Box 1 (Nonemployee compensation); MISC reports Box 1 (Rents).
const FORM_TYPE_FIRE_CODES = Object.freeze({
  "1099-NEC": Object.freeze({ typeOfReturn: "NE", amountCode: "1" }),
  "1099-MISC": Object.freeze({ typeOfReturn: "A ", amountCode: "1" }),
});

const FIRE_TIN_INDICATORS = Object.freeze({ ein: "1", ssn: "2", itin: "3", unknown: " " });

const padRight = (value, width) => String(value ?? "").toUpperCase().slice(0, width).padEnd(width, " ");
const padLeftZero = (value, width) => String(value ?? "").replace(/\D/g, "").slice(-width).padStart(width, "0");
const amount12 = (cents) => String(Math.round(Number(cents) || 0)).padStart(12, "0").slice(-12);
const digits9 = (value) => String(value ?? "").replace(/\D/g, "").slice(0, 9).padStart(9, "0");

function endRecord() {
  return "###";
}

function assertRecord(record, label) {
  if (record.length !== FIRE_RECORD_LENGTH) {
    throw new Error(`FIRE ${label} record must be ${FIRE_RECORD_LENGTH} chars, got ${record.length}.`);
  }
  return record;
}

// Positions (1-indexed) — see IRS_FIRE_FORMAT.md for the full field table.
function buildTRecord({ taxYear, transmitter }) {
  let record =
    "T" +                                  // 1        Record type
    padRight(taxYear, 4) +                  // 2-5      Tax year
    digits9(transmitter.tin) +              // 6-14     Transmitter TIN (9 digits)
    "     " +                               // 15-19    Reserved
    padRight(transmitter.name, 40) +        // 20-59    Transmitter name
    padRight(transmitter.address, 40) +     // 60-99    Transmitter address
    padRight(transmitter.city, 40) +        // 100-139  City
    padRight(transmitter.state, 2) +        // 140-141  State
    padRight(transmitter.zip, 9) +          // 142-150  ZIP
    " ".repeat(FIRE_RECORD_LENGTH - 150 - 3) +
    endRecord();                            // 748-750  End-of-record
  return assertRecord(record, "T");
}

function buildARecord({ taxYear, payer, formType }) {
  const codes = FORM_TYPE_FIRE_CODES[formType];
  const nameControl = String(payer.name ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4).padEnd(4, " ");
  let record =
    "A" +                                   // 1        Record type
    padRight(taxYear, 4) +                  // 2-5      Tax year
    digits9(payer.tin) +                    // 6-14     Payer TIN
    nameControl +                           // 15-18    Payer name control
    codes.typeOfReturn +                    // 19-20    Type of return ('NE' / 'A ')
    padRight(payer.name, 40) +              // 21-60    Payer name
    padRight(payer.address, 40) +            // 61-100   Payer address
    padRight(payer.city, 40) +              // 101-140  City
    padRight(payer.state, 2) +              // 141-142  State
    padRight(payer.zip, 9) +                // 143-151  ZIP
    "       " +                             // 152-158  Reserved
    padRight(codes.amountCode, 8) +         // 159-166  Amount codes ('1' = Box 1)
    " ".repeat(FIRE_RECORD_LENGTH - 166 - 3) +
    endRecord();                            // 748-750  End-of-record
  return assertRecord(record, "A");
}

function buildBRecord({ taxYear, payee, formType }) {
  const tinIndicator = FIRE_TIN_INDICATORS[payee.tinType] ?? " ";
  let record =
    "B" +                                   // 1        Record type
    padRight(taxYear, 4) +                  // 2-5      Tax year
    digits9(payee.tin) +                    // 6-14     Payee TIN (full value — export only)
    padRight(payee.nameControl, 4) +        // 15-18    Payee name control
    tinIndicator +                          // 19       Type of TIN (1=EIN 2=SSN 3=ITIN)
    padRight(payee.name, 40) +              // 20-59    Payee name line 1
    padRight(payee.address, 40) +           // 60-99    Mailing address
    padRight(payee.city, 40) +              // 100-139  City
    padRight(payee.state, 2) +              // 140-141  State
    padRight(payee.zip, 9) +                // 142-150  ZIP
    "          " +                           // 151-160  Reserved
    amount12(payee.amountCents) +            // 161-172  Payment Amount 1 (Box 1)
    "000000000000".repeat(15) +              // 173-352  Amounts 2-16 (zeros — Box 1 only)
    " ".repeat(42) +                         // 353-394  Reserved
    padRight("", 2) +                        // 395-396  State code (blank — no combined filing)
    "  " +                                   // 397-398  Reserved
    "000000000000" +                         // 399-410  State withholding (none tracked)
    "000000000000" +                         // 411-422  Local withholding (none tracked)
    " ".repeat(20) +                         // 423-442  State income (blank)
    " ".repeat(280) +                        // 443-722  Reserved
    " " +                                    // 723      Corrected return indicator (blank)
    " ".repeat(24) +                         // 724-747  Reserved
    endRecord();                            // 748-750  End-of-record
  return assertRecord(record, `B (${formType})`);
}

function buildCRecord({ taxYear, payer, bCount, amount1Total }) {
  let record =
    "C" +                                   // 1        Record type
    padRight(taxYear, 4) +                  // 2-5      Tax year
    digits9(payer.tin) +                    // 6-14     Payer TIN
    String(bCount).padStart(5, "0").slice(-5) + // 15-19  Number of B records
    amount12(amount1Total) +                 // 20-31    Total Payment Amount 1
    "000000000000".repeat(15) +              // 32-211   Totals Amounts 2-16 (zeros)
    " ".repeat(FIRE_RECORD_LENGTH - 211 - 3) +
    endRecord();                            // 748-750  End-of-record
  return assertRecord(record, "C");
}

function buildKRecord({ taxYear, payerCount, bCount, amount1Total }) {
  let record =
    "K" +                                   // 1        Record type
    padRight(taxYear, 4) +                  // 2-5      Tax year
    String(payerCount).padStart(5, "0").slice(-5) + // 6-10   Number of payers (A records)
    String(bCount).padStart(5, "0").slice(-5) +     // 11-15  Total payees (B records)
    amount12(amount1Total) +                 // 16-27    Grand total Payment Amount 1
    " ".repeat(FIRE_RECORD_LENGTH - 27 - 3) +
    endRecord();                            // 748-750  End-of-record
  return assertRecord(record, "K");
}

function buildFRecord({ aCount, bCount }) {
  let record =
    "F" +                                   // 1        Record type
    String(aCount).padStart(9, "0").slice(-9) + // 2-10   Number of A records
    "00000" +                               // 11-15    Zero
    String(bCount).padStart(10, "0").slice(-10) + // 16-25  Total B records
    " ".repeat(11) +                         // 26-36    Reserved
    "0".repeat(FIRE_RECORD_LENGTH - 36);
  return assertRecord(record, "F");
}

function payeeNameControl(name) {
  return String(name ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4).padEnd(4, " ");
}

/**
 * Build the FIRE-modeled export for one tax year.
 * payer: { tin, name, address, city, state, zip } — FULL payer TIN (export only).
 * recipients: reportable rows, each { tin (full, export only), tinType, displayName,
 *   addressLine1, city, state, zip, totalCents, formType }.
 * Returns { filename, content } — content is CRLF-joined 750-char records.
 * Recipients without a full TIN on file are excluded and listed in `skipped`.
 */
export function build1099FireExport({ taxYear, payer, recipients = [] }) {
  const year = Number(taxYear);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error("Tax year is required (e.g. 2026).");

  const skipped = [];
  const withTin = [];
  for (const recipient of recipients) {
    if (!recipient.reportable) continue;
    if (!recipient.tin || String(recipient.tin).replace(/\D/g, "").length !== 9) {
      skipped.push({ recipientId: recipient.recipientId, displayName: recipient.displayName, reason: "No full TIN on file — collect the W-9 TIN before this recipient can be exported." });
      continue;
    }
    withTin.push(recipient);
  }

  const groups = new Map();
  for (const recipient of withTin) {
    const formType = recipient.formType || resolveFormType(recipient.kind);
    if (!groups.has(formType)) groups.set(formType, []);
    groups.get(formType).push(recipient);
  }

  const records = [];
  records.push(buildTRecord({
    taxYear: year,
    transmitter: {
      tin: payer.tin,
      name: payer.name,
      address: payer.address,
      city: payer.city,
      state: payer.state,
      zip: payer.zip,
    },
  }));

  let totalB = 0;
  let totalAmount1 = 0;
  const aCount = groups.size;

  // One A record per form type (NEC payers are a separate "payer" group from
  // MISC payers in the FIRE sequence, per the documented spec).
  for (const [formType, payees] of groups) {
    records.push(buildARecord({ taxYear: year, payer, formType }));
    let amount1 = 0;
    for (const payee of payees) {
      records.push(buildBRecord({
        taxYear: year,
        formType,
        payee: {
          tin: payee.tin,
          tinType: payee.tinType,
          nameControl: payeeNameControl(payee.displayName),
          name: payee.displayName,
          address: payee.addressLine1,
          city: payee.city,
          state: payee.state,
          zip: payee.zip,
          amountCents: payee.totalCents,
        },
      }));
      amount1 += Number(payee.totalCents || 0);
      totalB += 1;
    }
    records.push(buildCRecord({ taxYear: year, payer, bCount: payees.length, amount1Total: amount1 }));
    totalAmount1 += amount1;
  }

  records.push(buildKRecord({ taxYear: year, payerCount: aCount, bCount: totalB, amount1Total: totalAmount1 }));
  records.push(buildFRecord({ aCount, bCount: totalB }));

  return Object.freeze({
    filename: `FORGE-1099-${year}.txt`,
    content: records.join(LINE_ENDING) + LINE_ENDING,
    recordCount: records.length,
    bRecordCount: totalB,
    skipped: Object.freeze(skipped),
    belowThresholdNote: `Recipients under the $${(REPORTING_THRESHOLD_CENTS / 100).toLocaleString("en-US")} IRS threshold are excluded from the export file (they appear flagged in the year summary).`,
  });
}

/**
 * Human-readable CSV companion — what Brandy and the CPA eyeball before filing.
 * TINs are MASKED here (full values live only in the FIRE file).
 */
export function build1099SummaryCsv({ taxYear, rows = [] }) {
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const lines = [[
    "Tax year", "Recipient", "Kind", "Form", "Box", "Entity type",
    "TIN (masked)", "Total paid", "Payments", "Reportable", "Exclusion reason", "Filing status",
  ]];
  for (const row of rows) {
    lines.push([
      taxYear, row.displayName, row.kind, row.formType, row.formBox, row.entityType,
      row.tinMasked, (Number(row.totalCents || 0) / 100).toFixed(2), row.paymentCount,
      row.reportable ? "Yes" : "No", row.exclusionReason || "", row.filingStatus,
    ]);
  }
  return { filename: `FORGE-1099-summary-${taxYear}.csv`, content: lines.map((line) => line.map(quote).join(",")).join("\n") + "\n" };
}
