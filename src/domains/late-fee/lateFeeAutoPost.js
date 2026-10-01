// Late-fee auto-post policy, eligibility, and calculation — pure functions.
// No database access, no ambient "now": the caller injects asOfDate. The
// cron route wires these to rent_charges; unit tests cover every branch.
//
// Design notes:
// - Auto-post applies to rent/proration charges from FORGE-collected
//   schedules only. It NEVER compounds: an existing late_fee charge is not
//   eligible for another automatic fee.
// - Idempotency key: `latefee:auto:<chargeId>` — one automatic fee per rent
//   charge, enforced by the (owner_id, source_key) unique constraint.
// - A voided auto-posted fee is treated as forgiven and is not re-posted.

export const LATE_FEE_SOURCE_KEY_PREFIX = "latefee:auto:";
// Automatic posting is fenced to rent/proration: ad-hoc charge types are
// payable voluntarily but must never receive automatic fees, and late fees
// never compound on other late fees.
export const LATE_FEE_ELIGIBLE_CHARGE_TYPES = Object.freeze(["rent", "proration"]);
export const LATE_FEE_ELIGIBLE_STATUSES = Object.freeze(["due", "partially_paid", "overdue"]);

export function lateFeeSourceKey(chargeId) {
  if (typeof chargeId !== "string" || !chargeId.trim()) throw new Error("Charge id is required.");
  return `${LATE_FEE_SOURCE_KEY_PREFIX}${chargeId.trim()}`;
}

function addDaysISODate(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error("Valid ISO date (YYYY-MM-DD) is required.");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function toPolicy({ graceDays, calculationType, fixedAmountCents, percentageBasisPoints, maximumAmountCents }) {
  const grace = Number(graceDays);
  if (!Number.isInteger(grace) || grace < 0 || grace > 31) return null;
  if (calculationType === "fixed") {
    const fixed = Number(fixedAmountCents);
    if (!Number.isSafeInteger(fixed) || fixed <= 0) return null;
    return { graceDays: grace, calculationType: "fixed", fixedAmountCents: fixed,
      maximumAmountCents: validCap(maximumAmountCents) };
  }
  if (calculationType === "percentage") {
    const basisPoints = Number(percentageBasisPoints);
    if (!Number.isInteger(basisPoints) || basisPoints <= 0) return null;
    return { graceDays: grace, calculationType: "percentage", percentageBasisPoints: basisPoints,
      maximumAmountCents: validCap(maximumAmountCents) };
  }
  return null;
}

function validCap(value) {
  if (value === null || value === undefined || value === "") return null;
  const cap = Number(value);
  return Number.isSafeInteger(cap) && cap > 0 ? cap : null;
}

// Portfolio-level settings row (rental_billing_settings, snake_case) → policy,
// or null when auto-post is off or the configuration is incomplete/invalid.
// Toggle off means "no post, ever" — the cron must not fall back to anything.
export function normalizeLateFeeSettings(row) {
  if (!row || row.late_fee_auto_post !== true) return null;
  return toPolicy({
    graceDays: row.late_fee_grace_days,
    calculationType: row.late_fee_calculation_type,
    fixedAmountCents: row.late_fee_fixed_amount_cents,
    percentageBasisPoints: row.late_fee_percentage_basis_points,
    maximumAmountCents: row.late_fee_maximum_amount_cents,
  });
}

// Merges a tenant-level override onto the portfolio policy. Returns:
// - { exempt: true } when the tenant is exempt — no fee, no further checks.
// - the effective policy with override fields winning per-field.
// - null when there is no usable policy at all.
export function resolveLateFeePolicy({ settings, override }) {
  const base = normalizeLateFeeSettings(settings);
  if (!override) return base;
  if (override.exempt === true) return { exempt: true };
  const hasOverrideField = override.grace_days != null || override.calculation_type != null
    || override.fixed_amount_cents != null || override.percentage_basis_points != null
    || override.maximum_amount_cents != null;
  if (!hasOverrideField) return base;
  if (!base) return null;
  const merged = toPolicy({
    graceDays: override.grace_days ?? base.graceDays,
    calculationType: override.calculation_type ?? base.calculationType,
    fixedAmountCents: override.calculation_type != null
      ? override.fixed_amount_cents
      : (override.fixed_amount_cents ?? base.fixedAmountCents),
    percentageBasisPoints: override.calculation_type != null
      ? override.percentage_basis_points
      : (override.percentage_basis_points ?? base.percentageBasisPoints),
    maximumAmountCents: override.maximum_amount_cents ?? base.maximumAmountCents,
  });
  return merged;
}

// A charge is past grace when due_date + grace_days < asOfDate — the same
// boundary the manual assess_rental_late_fee RPC enforces
// (due_date + grace_days >= current_date → not eligible).
export function isChargeLateFeeEligible({ charge, policy, asOfDate }) {
  if (!policy || policy.exempt === true) return false;
  if (!charge || typeof charge.dueDate !== "string") return false;
  if (!LATE_FEE_ELIGIBLE_CHARGE_TYPES.includes(charge.chargeType)) return false;
  if (!LATE_FEE_ELIGIBLE_STATUSES.includes(charge.status)) return false;
  const unpaidCents = Number(charge.amountCents) - Number(charge.paidAmountCents || 0);
  if (!Number.isSafeInteger(unpaidCents) || unpaidCents <= 0) return false;
  return addDaysISODate(charge.dueDate, policy.graceDays) < asOfDate;
}

// Percentage is assessed on the UNPAID balance (ceil, mirroring the manual
// RPC) and both calculation types honor the optional cap.
export function computeLateFeeCents({ unpaidCents, policy }) {
  if (!policy || policy.exempt === true) return 0;
  const unpaid = Number(unpaidCents);
  if (!Number.isSafeInteger(unpaid) || unpaid <= 0) return 0;
  let fee;
  if (policy.calculationType === "fixed") {
    fee = policy.fixedAmountCents;
  } else if (policy.calculationType === "percentage") {
    fee = Math.ceil((unpaid * policy.percentageBasisPoints) / 10000);
  } else {
    return 0;
  }
  if (policy.maximumAmountCents != null) fee = Math.min(fee, policy.maximumAmountCents);
  return fee > 0 ? fee : 0;
}

// Builds the rent_charges row for the automatic fee. due_date is the posting
// day (the day grace expired is in the notes for the paper trail).
export function buildLateFeeChargeRow({ ownerId, charge, policy, asOfDate, now }) {
  if (typeof ownerId !== "string" || !ownerId.trim()) throw new Error("Owner id is required.");
  if (!isChargeLateFeeEligible({ charge, policy, asOfDate })) {
    throw new Error("Charge is not eligible for an automatic late fee.");
  }
  const unpaidCents = Number(charge.amountCents) - Number(charge.paidAmountCents || 0);
  const feeCents = computeLateFeeCents({ unpaidCents, policy });
  if (feeCents <= 0) throw new Error("Late fee computed to zero.");
  const graceExpiry = addDaysISODate(charge.dueDate, policy.graceDays);
  const basis = policy.calculationType === "fixed"
    ? `fixed ${policy.fixedAmountCents}¢`
    : `${(policy.percentageBasisPoints / 100).toFixed(2)}% of ${unpaidCents}¢ unpaid`;
  const timestamp = now || new Date().toISOString();
  return Object.freeze({
    owner_id: ownerId.trim(),
    id: `rent_charge_latefee_${charge.id}_${asOfDate.replaceAll("-", "")}`,
    lease_id: charge.leaseId,
    schedule_id: charge.scheduleId || null,
    period: asOfDate.slice(0, 7),
    due_date: asOfDate,
    amount_cents: feeCents,
    paid_amount_cents: 0,
    currency_code: charge.currencyCode || "USD",
    status: "due",
    source_key: lateFeeSourceKey(charge.id),
    charge_type: "late_fee",
    related_charge_id: charge.id,
    notes: `Automatic late fee: ${policy.graceDays}-day grace on charge due ${charge.dueDate} expired ${graceExpiry}; ${basis}${policy.maximumAmountCents != null ? `, capped at ${policy.maximumAmountCents}¢` : ""}.`,
    created_at: timestamp,
    updated_at: timestamp,
  });
}
