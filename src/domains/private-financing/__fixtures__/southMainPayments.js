// Real South Main loan terms and the real 48-payment history, extracted directly from the owner-supplied
// source workbook (the "uploaded workbook" the handoff refers to) -- specifically its "Paid" and
// "Date Paid" columns, which record what actually
// happened, not the workbook's own (known-flawed) amortization projection. Extracted programmatically,
// not transcribed by hand, and independently verified to sum to exactly $26,577.00 across exactly 48
// payments -- matching the handoff's "Owner-approved South Main opening facts" ("Recorded payments: 48",
// "Actual cash payments recorded: $26,577.00") exactly. This file is test fixture data only -- it is never
// imported by any non-test code, and importing it never touches Supabase or any live system.

export const SOUTH_MAIN_TERMS = Object.freeze({
  interestBearing: Object.freeze({
    originalPrincipalCents: 4_500_000, // $45,000.00
    rateBps: 300, // 3%
    regularPaymentCents: 43_452, // $434.52 -- the handoff's "3% portion" of the regular combined payment
  }),
  zeroInterest: Object.freeze({
    originalPrincipalCents: 1_000_000, // $10,000.00
    rateBps: 0,
    regularPaymentCents: 8_333, // $83.33 -- the handoff's "0% portion" of the regular combined payment
  }),
  regularCombinedPaymentCents: 51_785, // $517.85
  calculationStartDate: "2022-03-23",
});

// One entry per real recorded payment: { pmtNo, datePaid (ISO), amountPaidCents }. `datePaid` values are
// converted from the workbook's MM/DD/YYYY to ISO YYYY-MM-DD; amounts converted from dollars to integer
// cents. Order matches the workbook's own payment sequence (chronological).
export const SOUTH_MAIN_PAYMENTS = Object.freeze([
  { pmtNo: 1, datePaid: "2022-03-23", amountPaidCents: 60_000 },
  { pmtNo: 2, datePaid: "2022-04-23", amountPaidCents: 50_000 },
  { pmtNo: 3, datePaid: "2022-05-22", amountPaidCents: 60_000 },
  { pmtNo: 4, datePaid: "2022-06-19", amountPaidCents: 60_000 },
  { pmtNo: 5, datePaid: "2022-07-29", amountPaidCents: 50_000 },
  { pmtNo: 6, datePaid: "2022-08-26", amountPaidCents: 50_000 },
  { pmtNo: 7, datePaid: "2022-10-05", amountPaidCents: 50_000 },
  { pmtNo: 8, datePaid: "2022-11-12", amountPaidCents: 50_000 },
  { pmtNo: 9, datePaid: "2022-12-23", amountPaidCents: 52_700 },
  { pmtNo: 10, datePaid: "2023-01-28", amountPaidCents: 50_000 },
  { pmtNo: 11, datePaid: "2023-02-25", amountPaidCents: 50_000 },
  { pmtNo: 12, datePaid: "2023-03-30", amountPaidCents: 50_000 },
  { pmtNo: 13, datePaid: "2023-04-30", amountPaidCents: 50_000 },
  { pmtNo: 14, datePaid: "2023-06-03", amountPaidCents: 50_000 },
  { pmtNo: 15, datePaid: "2023-07-11", amountPaidCents: 60_000 },
  { pmtNo: 16, datePaid: "2023-08-18", amountPaidCents: 50_000 },
  { pmtNo: 17, datePaid: "2023-09-15", amountPaidCents: 50_000 },
  { pmtNo: 18, datePaid: "2023-10-07", amountPaidCents: 50_000 },
  { pmtNo: 19, datePaid: "2023-11-14", amountPaidCents: 50_000 },
  { pmtNo: 20, datePaid: "2023-12-14", amountPaidCents: 50_000 },
  { pmtNo: 21, datePaid: "2024-01-28", amountPaidCents: 50_000 },
  { pmtNo: 22, datePaid: "2024-02-20", amountPaidCents: 50_000 },
  { pmtNo: 23, datePaid: "2024-04-03", amountPaidCents: 50_000 },
  { pmtNo: 24, datePaid: "2024-05-24", amountPaidCents: 50_000 },
  { pmtNo: 25, datePaid: "2024-06-29", amountPaidCents: 50_000 },
  { pmtNo: 26, datePaid: "2024-07-19", amountPaidCents: 50_000 },
  { pmtNo: 27, datePaid: "2024-08-16", amountPaidCents: 50_000 },
  { pmtNo: 28, datePaid: "2024-09-30", amountPaidCents: 50_000 },
  { pmtNo: 29, datePaid: "2024-10-14", amountPaidCents: 50_000 },
  { pmtNo: 30, datePaid: "2024-11-30", amountPaidCents: 60_000 },
  { pmtNo: 31, datePaid: "2024-12-20", amountPaidCents: 60_000 },
  { pmtNo: 32, datePaid: "2025-02-01", amountPaidCents: 60_000 },
  { pmtNo: 33, datePaid: "2025-03-08", amountPaidCents: 60_000 },
  { pmtNo: 34, datePaid: "2025-03-08", amountPaidCents: 85_000 },
  { pmtNo: 35, datePaid: "2025-03-08", amountPaidCents: 60_000 },
  { pmtNo: 36, datePaid: "2025-03-08", amountPaidCents: 60_000 },
  { pmtNo: 37, datePaid: "2025-07-27", amountPaidCents: 60_000 },
  { pmtNo: 38, datePaid: "2025-09-08", amountPaidCents: 60_000 },
  { pmtNo: 39, datePaid: "2025-09-26", amountPaidCents: 60_000 },
  { pmtNo: 40, datePaid: "2025-11-17", amountPaidCents: 60_000 },
  { pmtNo: 41, datePaid: "2026-01-19", amountPaidCents: 60_000 },
  { pmtNo: 42, datePaid: "2026-01-23", amountPaidCents: 60_000 },
  { pmtNo: 43, datePaid: "2026-03-20", amountPaidCents: 60_000 },
  { pmtNo: 44, datePaid: "2026-04-20", amountPaidCents: 60_000 },
  { pmtNo: 45, datePaid: "2026-05-20", amountPaidCents: 60_000 },
  { pmtNo: 46, datePaid: "2026-06-12", amountPaidCents: 60_000 },
  { pmtNo: 47, datePaid: "2026-07-24", amountPaidCents: 60_000 },
  { pmtNo: 48, datePaid: "2026-08-23", amountPaidCents: 60_000 },
]);

export const SOUTH_MAIN_ACCEPTED_RECONCILIATION = Object.freeze({
  asOfDate: "2026-08-23",
  scheduledPaymentsCount: 54,
  scheduledAmountCents: 2_796_390, // $27,963.90
  actualCashCents: 2_657_700, // $26,577.00
  bringCurrentCreditCents: 138_690, // $1,386.90
  pastDueAfterCreditCents: 0,
  correctedPrincipalRemainingCents: 3_184_347, // $31,843.47
  interestPaidCents: 480_737, // $4,807.37
  cashAppliedToPrincipalCents: 2_176_963, // $21,769.63
  principalCreditedBySellerCents: 138_690, // $1,386.90
  totalPrincipalPaidOrCreditedCents: 2_315_653, // $23,156.53
  nextRegularPaymentCents: 51_785, // $517.85
  nextRegularPaymentDueDate: "2026-09-23",
});
