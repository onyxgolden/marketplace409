// R7 domain: check printing — check runs over recorded R4 check payments.
//
// A check run batches recorded check payments (payment_method='check') for
// printing. Printing never moves money — the payment already posted its
// ledger events when R4 recorded it — so the run is header + snapshot items.
// Hard rule: voided payments must never print (enforced in the RPC and
// re-checked by the print route before rendering).

export const CHECK_RUN_ID_PREFIX = "rental_check_run_";

export function buildCheckRunId() {
  return `${CHECK_RUN_ID_PREFIX}${crypto.randomUUID().replaceAll("-", "")}`;
}

const isNonEmptyString = (value) =>
  typeof value === "string" && value.trim().length > 0;

const isValidDateString = (value) =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) && !Number.isNaN(new Date(`${value.trim()}T00:00:00Z`).getTime());

// ---------------------------------------------------------------------------
// Amount in words — the legal-amount line on a printed check.
// "One thousand two hundred thirty-four and 56/100".
// ---------------------------------------------------------------------------
const ONES = [
  "", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES = ["", "thousand", "million", "billion", "trillion"];

function threeDigitsToWords(n) {
  const parts = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds > 0) parts.push(`${ONES[hundreds]} hundred`);
  if (rest > 0) {
    if (rest < 20) {
      parts.push(ONES[rest]);
    } else {
      const tens = Math.floor(rest / 10);
      const ones = rest % 10;
      parts.push(ones > 0 ? `${TENS[tens]}-${ONES[ones]}` : TENS[tens]);
    }
  }
  return parts.join(" ");
}

function dollarsToWords(dollars) {
  if (dollars === 0) return "zero";
  const groups = [];
  let n = dollars;
  let scale = 0;
  while (n > 0) {
    const chunk = n % 1000;
    if (chunk > 0) {
      const words = threeDigitsToWords(chunk);
      groups.unshift(scale > 0 ? `${words} ${SCALES[scale]}` : words);
    }
    n = Math.floor(n / 1000);
    scale += 1;
    if (scale >= SCALES.length && n > 0) {
      throw new RangeError("Amount exceeds the supported word range.");
    }
  }
  return groups.join(" ");
}

/**
 * Whole-cent amount → check legal-amount line.
 * 123456 → "One thousand two hundred thirty-four and 56/100".
 */
export function amountCentsToWords(cents) {
  const total = Math.round(Number(cents));
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new RangeError("Check amounts must be non-negative whole cents.");
  }
  const dollars = Math.floor(total / 100);
  const cc = String(total % 100).padStart(2, "0");
  const words = dollarsToWords(dollars);
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} and ${cc}/100`;
}

// ---------------------------------------------------------------------------
// Check-run validation
// ---------------------------------------------------------------------------
/**
 * Validate a check-run submission.
 * input: { id?, runDate, bankAccountId, paymentIds: [text] }
 * context.payments: payment rows { id, payment_method, status, amount_cents,
 *   bank_account_id, check_number }.
 * Rules: at least one check; every payment must be an ACTIVE check payment
 * (voided payments never print); all checks drawn on the run's bank account.
 * Returns { valid, errors, value } with totalCents/checkCount.
 */
export function validateCheckRunInput(input, context = {}) {
  const errors = [];
  const paymentsById = new Map();
  for (const payment of context.payments || []) paymentsById.set(payment.id, payment);

  const id = isNonEmptyString(input?.id) ? input.id.trim() : buildCheckRunId();

  const runDate = isNonEmptyString(input?.runDate) ? input.runDate.trim() : "";
  if (!isValidDateString(runDate)) errors.push("Enter a valid run date (YYYY-MM-DD).");

  const bankAccountId = isNonEmptyString(input?.bankAccountId) ? input.bankAccountId.trim() : "";
  if (!bankAccountId) errors.push("Choose the bank account the checks are drawn on.");

  const rawIds = Array.isArray(input?.paymentIds) ? input.paymentIds : [];
  const paymentIds = [...new Set(rawIds.filter(isNonEmptyString).map((v) => v.trim()))];
  if (paymentIds.length === 0) {
    errors.push("Choose at least one check payment to print.");
  }

  const cleanPayments = [];
  for (const paymentId of paymentIds) {
    const payment = paymentsById.get(paymentId);
    if (!payment) {
      errors.push("A check payment on this run was not found.");
      continue;
    }
    if (payment.payment_method !== "check") {
      errors.push("Only check payments can be printed.");
      continue;
    }
    if (payment.status !== "active") {
      errors.push("Voided payments cannot be printed.");
      continue;
    }
    if (!isNonEmptyString(payment.check_number)) {
      errors.push("A check payment without a check number cannot be printed.");
      continue;
    }
    if (payment.bank_account_id !== bankAccountId) {
      errors.push("All checks in a run must be drawn on the same bank account.");
      continue;
    }
    const amountCents = Number(payment.amount_cents || 0);
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      errors.push("A check payment must have a positive amount.");
      continue;
    }
    cleanPayments.push({
      paymentId,
      amountCents,
      checkNumber: payment.check_number.trim(),
    });
  }

  if (errors.length > 0) return { valid: false, errors, value: null };
  const totalCents = cleanPayments.reduce((sum, p) => sum + p.amountCents, 0);
  return {
    valid: true,
    errors: [],
    value: {
      id,
      runDate,
      bankAccountId,
      payments: cleanPayments,
      checkCount: cleanPayments.length,
      totalCents,
    },
  };
}

/**
 * Live print-time guard: re-check every payment behind a run before
 * rendering. Returns the list of problems (empty = safe to print).
 * paymentsById: Map of payment id → { payment_method, status }.
 */
export function checkRunPrintProblems(items, paymentsById) {
  const problems = [];
  for (const item of items || []) {
    const payment = paymentsById?.get(item.vendor_payment_id || item.vendorPaymentId);
    if (!payment) {
      problems.push("A check on this run is no longer on record.");
      continue;
    }
    if (payment.status !== "active") {
      problems.push("A voided payment cannot be printed.");
      continue;
    }
    if (payment.payment_method !== "check") {
      problems.push("Only check payments can be printed.");
    }
  }
  return problems;
}

/** Serialize a check run row for the API. options.items: run item rows. */
export function serializeCheckRun(row, options = {}) {
  const checks = (options.items || []).map((item) => ({
    vendorPaymentId: item.vendor_payment_id,
    seq: Number(item.seq || 0),
    payeeName: item.payee_name || "",
    amountCents: Number(item.amount_cents || 0),
    amountWords: amountCentsToWords(Number(item.amount_cents || 0)),
    checkNumber: item.check_number || "",
    paymentDate: item.payment_date || null,
    memo: item.memo || "",
    bankAccountId: item.bank_account_id || null,
  }));
  return {
    id: row.id,
    runDate: row.run_date,
    bankAccountId: row.bank_account_id || null,
    checkCount: Number(row.check_count || 0),
    totalAmountCents: Number(row.total_amount_cents || 0),
    totalAmountWords: amountCentsToWords(Number(row.total_amount_cents || 0)),
    checks,
    createdAt: row.created_at || null,
  };
}
