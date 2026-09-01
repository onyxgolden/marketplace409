const MAX_TERM_MONTHS = 1_200;

export class InvalidAmortizationTermsError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidAmortizationTermsError";
  }
}

function assertWholeCents(value, label, { allowZero = false } = {}) {
  if (!Number.isInteger(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new InvalidAmortizationTermsError(`${label} must be ${allowZero ? "zero or " : ""}a positive whole-cent amount.`);
  }
}

function addMonthsClamped(isoDate, months) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

export function calculateRequiredMonthlyPaymentCents({ principalCents, annualRateBps, termMonths }) {
  assertWholeCents(principalCents, "Principal");
  if (!Number.isInteger(annualRateBps) || annualRateBps < 0) {
    throw new InvalidAmortizationTermsError("Annual rate must be zero or a positive whole basis-point amount.");
  }
  if (!Number.isInteger(termMonths) || termMonths <= 0 || termMonths > MAX_TERM_MONTHS) {
    throw new InvalidAmortizationTermsError("Term must be between 1 and 1,200 months.");
  }
  if (annualRateBps === 0) return Math.ceil(principalCents / termMonths);
  const monthlyRate = annualRateBps / 10_000 / 12;
  return Math.ceil(principalCents * monthlyRate / (1 - ((1 + monthlyRate) ** -termMonths)));
}

export function buildAmortizationSchedule({
  principalCents,
  annualRateBps,
  termMonths,
  startDate,
  recurringExtraCents = 0,
  oneTimeExtraCents = 0,
  oneTimeExtraMonth = 1,
}) {
  const requiredPaymentCents = calculateRequiredMonthlyPaymentCents({ principalCents, annualRateBps, termMonths });
  assertWholeCents(recurringExtraCents, "Recurring extra payment", { allowZero: true });
  assertWholeCents(oneTimeExtraCents, "One-time extra payment", { allowZero: true });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate || "")) {
    throw new InvalidAmortizationTermsError("A valid first-payment date is required.");
  }
  if (!Number.isInteger(oneTimeExtraMonth) || oneTimeExtraMonth <= 0 || oneTimeExtraMonth > MAX_TERM_MONTHS) {
    throw new InvalidAmortizationTermsError("One-time extra-payment month must be between 1 and 1,200.");
  }

  let balanceCents = principalCents;
  let totalInterestCents = 0;
  let totalPaidCents = 0;
  const monthlyRate = annualRateBps / 10_000 / 12;
  const rows = [];

  for (let month = 1; balanceCents > 0 && month <= MAX_TERM_MONTHS; month += 1) {
    const beginningBalanceCents = balanceCents;
    const interestCents = Math.round(beginningBalanceCents * monthlyRate);
    const scheduledPrincipalCapacity = Math.max(requiredPaymentCents - interestCents, 0);
    const scheduledPrincipalCents = Math.min(beginningBalanceCents, scheduledPrincipalCapacity);
    const remainingAfterScheduled = beginningBalanceCents - scheduledPrincipalCents;
    const requestedExtra = recurringExtraCents + (month === oneTimeExtraMonth ? oneTimeExtraCents : 0);
    const extraPrincipalCents = Math.min(remainingAfterScheduled, requestedExtra);
    const principalPaidCents = scheduledPrincipalCents + extraPrincipalCents;
    const paymentCents = interestCents + principalPaidCents;

    if (principalPaidCents <= 0) {
      throw new InvalidAmortizationTermsError("The calculated payment does not reduce principal.");
    }

    balanceCents -= principalPaidCents;
    totalInterestCents += interestCents;
    totalPaidCents += paymentCents;
    rows.push(Object.freeze({
      month,
      paymentDate: addMonthsClamped(startDate, month - 1),
      beginningBalanceCents,
      requiredPaymentCents: Math.min(requiredPaymentCents, interestCents + scheduledPrincipalCents),
      extraPrincipalCents,
      paymentCents,
      principalPaidCents,
      interestCents,
      endingBalanceCents: balanceCents,
    }));
  }

  if (balanceCents > 0) throw new InvalidAmortizationTermsError("Payoff exceeds the 100-year calculation limit.");
  return Object.freeze({
    requiredPaymentCents,
    payoffDate: rows.at(-1)?.paymentDate || startDate,
    paymentCount: rows.length,
    totalInterestCents,
    totalPaidCents,
    rows: Object.freeze(rows),
  });
}

export function compareAmortizationSchedules(baseline, accelerated) {
  return Object.freeze({
    interestSavedCents: Math.max(baseline.totalInterestCents - accelerated.totalInterestCents, 0),
    monthsSaved: Math.max(baseline.paymentCount - accelerated.paymentCount, 0),
  });
}

