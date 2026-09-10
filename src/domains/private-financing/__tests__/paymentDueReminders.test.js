import { describe, expect, it } from "vitest";
import { computeAccrual } from "../interestAccrual.js";
import { allocatePayment } from "../paymentAllocation.js";
import { roundToNearestCent } from "../currencyMath.js";
import {
  computeReminderCandidate,
  evaluateInstallmentStillOwed,
  buildReminderEmail,
  addDaysISODate,
  formatCentsAsUsd,
  buildPortalUrl,
  buildDeliveryRowId,
  buildProviderIdempotencyKey,
  REMINDER_TYPE,
} from "../paymentDueReminders.js";

// Snake_case DB-row-shaped fixture builders -- computeReminderCandidate feeds rows through
// mapEventRowsForReplay (persistedRowMapping.js), which expects exactly this shape (the same shape
// Supabase itself returns), not the camelCase shape replayEvents.js/replayEvents.test.js build
// directly. Payment allocation is computed via the SAME computeAccrual/allocatePayment primitives
// replayEvents.js uses internally (identical discipline to replayEvents.test.js's own
// smallAccountFixture), so every fixture's stored allocation is guaranteed to match what replay
// will independently recompute and cross-check.
const OWNER = "owner_1";
const ACCOUNT = "acct_1";
const CREATED_BY = "11111111-1111-1111-1111-111111111111";
const SCHEDULED = "scheduled_component_order";

let seq = 0;
function nextSeq() {
  seq += 1;
  return seq;
}

function accountOpenedRow({ effectiveDate }) {
  return {
    id: "evt_open",
    owner_id: OWNER,
    account_id: ACCOUNT,
    event_type: "account_opened",
    event_origin: "interactive_user",
    created_by: CREATED_BY,
    effective_date: effectiveDate,
    ledger_sequence: nextSeq(),
    recorded_at: `${effectiveDate}T00:00:00.000Z`,
  };
}

function componentRow({ componentKey, originalPrincipalCents, rateBps, scheduledComponentAmountCents, effectiveDate, allocationPriority, versionNumber = 1 }) {
  return {
    owner_id: OWNER,
    id: `comp_${componentKey}_v${versionNumber}`,
    account_id: ACCOUNT,
    component_key: componentKey,
    label: componentKey,
    original_principal_cents: originalPrincipalCents,
    rate_bps: rateBps,
    day_count_convention: "actual_365",
    scheduled_component_amount_cents: scheduledComponentAmountCents,
    allocation_priority: allocationPriority,
    effective_date: effectiveDate,
    version_number: versionNumber,
  };
}

function termsRow({
  effectiveDate,
  versionNumber = 1,
  extraPaymentAllocationPolicy = "highest_rate_first_extra",
  prepaymentPolicy = "allowed_without_penalty_does_not_advance_due_date",
  paymentFrequency = "monthly",
  regularScheduledPaymentAmountCents,
  firstPaymentDueDate,
}) {
  return {
    owner_id: OWNER,
    id: `terms_v${versionNumber}`,
    account_id: ACCOUNT,
    version_number: versionNumber,
    payment_frequency: paymentFrequency,
    first_payment_due_date: firstPaymentDueDate,
    regular_scheduled_payment_amount_cents: regularScheduledPaymentAmountCents,
    maturity_date: null,
    allocation_policy: SCHEDULED,
    extra_payment_allocation_policy: extraPaymentAllocationPolicy,
    prepayment_policy: prepaymentPolicy,
    day_count_convention: "actual_365",
    effective_date: effectiveDate,
    acting_seller_id: OWNER,
    amendment_reason: versionNumber > 1 ? "test amendment" : null,
  };
}

function paymentPostedRow({ id, effectiveDate, amountCents, allocation, principalRemainingByComponentCents }) {
  return {
    id,
    owner_id: OWNER,
    account_id: ACCOUNT,
    event_type: "payment_posted",
    event_origin: "interactive_user",
    created_by: CREATED_BY,
    idempotency_key: null,
    effective_date: effectiveDate,
    ledger_sequence: nextSeq(),
    recorded_at: `${effectiveDate}T00:00:00.000Z`,
    amount_cents: amountCents,
    interest_paid_by_component_cents: allocation.interestPaidByComponentCents,
    principal_paid_by_component_cents: allocation.principalPaidByComponentCents,
    unallocated_cents: allocation.unallocatedCents,
    principal_remaining_by_component_cents: principalRemainingByComponentCents,
  };
}

function principalCorrectionRow({ id, effectiveDate, componentId, deltaCents, correctedAfter, reason = "Test fixture principal correction." }) {
  return {
    id,
    owner_id: OWNER,
    account_id: ACCOUNT,
    event_type: "principal_correction",
    event_origin: "interactive_user",
    created_by: CREATED_BY,
    effective_date: effectiveDate,
    ledger_sequence: nextSeq(),
    recorded_at: `${effectiveDate}T00:00:00.000Z`,
    reason,
    component_id: componentId,
    correction_basis: "discretionary_concession",
    delta_cents: deltaCents,
    corrected_component_principal_remaining_cents_after: correctedAfter,
  };
}

function paymentReversalRow({ id, effectiveDate, reversesEventId, amountCents, allocation, principalRemainingByComponentCents, reason = "Test fixture reversal." }) {
  return {
    id,
    owner_id: OWNER,
    account_id: ACCOUNT,
    event_type: "payment_reversal",
    event_origin: "interactive_user",
    created_by: CREATED_BY,
    reverses_event_id: reversesEventId,
    reason,
    effective_date: effectiveDate,
    ledger_sequence: nextSeq(),
    recorded_at: `${effectiveDate}T00:00:00.000Z`,
    amount_cents: amountCents,
    interest_paid_by_component_cents: allocation.interestPaidByComponentCents,
    principal_paid_by_component_cents: allocation.principalPaidByComponentCents,
    unallocated_cents: allocation.unallocatedCents,
    principal_remaining_by_component_cents: principalRemainingByComponentCents,
  };
}

// A single zero-interest component (rateBps: 0) so every payment allocates 100% to principal with
// zero accrued interest -- keeps every scenario's arithmetic hand-verifiable while still routing
// through the real computeAccrual/allocatePayment primitives (accrual is genuinely 0 at 0bps, not
// hand-waved to 0).
function singleComponentAccount({ originalPrincipalCents = 1_000_000, regularPaymentCents = 100_000, firstPaymentDueDate = "2026-02-01", openedDate = "2026-01-01", extraTermsVersions = [], prepaymentPolicy, paymentFrequency }) {
  seq = 0;
  const opened = accountOpenedRow({ effectiveDate: openedDate });
  const componentVersions = [componentRow({ componentKey: "c1", originalPrincipalCents, rateBps: 0, scheduledComponentAmountCents: regularPaymentCents, effectiveDate: openedDate, allocationPriority: 1 })];
  const accountTermsVersions = [
    termsRow({ effectiveDate: openedDate, versionNumber: 1, regularScheduledPaymentAmountCents: regularPaymentCents, firstPaymentDueDate, prepaymentPolicy, paymentFrequency }),
    ...extraTermsVersions,
  ];
  return { opened, componentVersions, accountTermsVersions, originalPrincipalCents, regularPaymentCents };
}

function payFullInstallment({ id, effectiveDate, remainingBefore, amountCents }) {
  const accrual = computeAccrual({ principalRemainingCents: remainingBefore, rateBps: 0, fromDate: effectiveDate, toDate: effectiveDate });
  const accruedInterestCents = roundToNearestCent(accrual);
  const result = allocatePayment({
    components: [{ componentId: "c1", remainingPrincipalCents: remainingBefore, scheduledComponentAmountCents: amountCents, rateBps: 0, allocationPriority: 1 }],
    accruedInterestCentsByComponent: { c1: accruedInterestCents },
    paymentAmountCents: amountCents,
    allocationPolicy: SCHEDULED,
    extraPaymentAllocationPolicy: "highest_rate_first_extra",
  });
  return paymentPostedRow({
    id,
    effectiveDate,
    amountCents,
    allocation: result,
    principalRemainingByComponentCents: { c1: remainingBefore - (result.principalPaidByComponentCents.c1 || 0) },
  });
}

describe("computeReminderCandidate", () => {
  it("is eligible with reminderType seven_days_before when the next due date is exactly 7 days out", () => {
    const { opened, componentVersions, accountTermsVersions } = singleComponentAccount({ firstPaymentDueDate: "2026-03-01" });
    const result = computeReminderCandidate({
      accountStatus: "active",
      eventRows: [opened],
      componentRows: componentVersions,
      termsRows: accountTermsVersions,
      asOfDate: "2026-02-22", // 2026-03-01 is exactly 7 days after 2026-02-22
    });
    expect(result.eligible).toBe(true);
    expect(result.reminderType).toBe(REMINDER_TYPE.SEVEN_DAYS_BEFORE);
    expect(result.dueDate).toBe("2026-03-01");
    expect(result.scheduledPaymentAmountCents).toBe(100_000);
    expect(result.principalRemainingCents).toBe(1_000_000);
  });

  it("is eligible with reminderType due_date when the next due date is today", () => {
    const { opened, componentVersions, accountTermsVersions } = singleComponentAccount({ firstPaymentDueDate: "2026-03-01" });
    const result = computeReminderCandidate({
      accountStatus: "active",
      eventRows: [opened],
      componentRows: componentVersions,
      termsRows: accountTermsVersions,
      asOfDate: "2026-03-01",
    });
    expect(result.eligible).toBe(true);
    expect(result.reminderType).toBe(REMINDER_TYPE.DUE_DATE);
    expect(result.dueDate).toBe("2026-03-01");
  });

  it("is not eligible when the next due date is neither today nor 7 days out", () => {
    const { opened, componentVersions, accountTermsVersions } = singleComponentAccount({ firstPaymentDueDate: "2026-03-01" });
    const result = computeReminderCandidate({
      accountStatus: "active",
      eventRows: [opened],
      componentRows: componentVersions,
      termsRows: accountTermsVersions,
      asOfDate: "2026-02-10", // 19 days out
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("not_due_soon");
  });

  it.each(["paid_off", "written_off", "cancelled"])("is not eligible for a %s account, regardless of due-date math", (status) => {
    const { opened, componentVersions, accountTermsVersions } = singleComponentAccount({ firstPaymentDueDate: "2026-03-01" });
    const result = computeReminderCandidate({ accountStatus: status, eventRows: [opened], componentRows: componentVersions, termsRows: accountTermsVersions, asOfDate: "2026-03-01" });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("account_not_active");
  });

  it("does not remind a due-today installment already fully satisfied by a payment posted the same day", () => {
    const { opened, componentVersions, accountTermsVersions } = singleComponentAccount({ firstPaymentDueDate: "2026-03-01" });
    const payment = payFullInstallment({ id: "evt_pay1", effectiveDate: "2026-03-01", remainingBefore: 1_000_000, amountCents: 100_000 });
    const result = computeReminderCandidate({
      accountStatus: "active",
      eventRows: [opened, payment],
      componentRows: componentVersions,
      termsRows: accountTermsVersions,
      asOfDate: "2026-03-01",
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("installment_already_satisfied");
  });

  it("fails closed (unavailable) rather than guessing when the payment frequency is outside V1 support", () => {
    const { opened, componentVersions, accountTermsVersions } = singleComponentAccount({ firstPaymentDueDate: "2026-03-01", paymentFrequency: "quarterly" });
    const result = computeReminderCandidate({ accountStatus: "active", eventRows: [opened], componentRows: componentVersions, termsRows: accountTermsVersions, asOfDate: "2026-03-01" });
    expect(result.eligible).toBe(false);
    expect(result.unavailable).toBe(true);
    expect(result.reason).toBe("due_state_unsupported");
  });

  it("fails closed (unavailable) rather than guessing when event data is malformed", () => {
    const { opened, componentVersions, accountTermsVersions } = singleComponentAccount({ firstPaymentDueDate: "2026-03-01" });
    const malformedPayment = { ...payFullInstallment({ id: "evt_bad", effectiveDate: "2026-03-01", remainingBefore: 1_000_000, amountCents: 100_000 }), principal_remaining_by_component_cents: "not-an-object" };
    const result = computeReminderCandidate({ accountStatus: "active", eventRows: [opened, malformedPayment], componentRows: componentVersions, termsRows: accountTermsVersions, asOfDate: "2026-03-01" });
    expect(result.eligible).toBe(false);
    expect(result.unavailable).toBe(true);
    expect(result.reason).toBe("replay_unavailable");
  });

  it("aggregates multiple components without double-counting principal remaining", () => {
    seq = 0;
    const opened = accountOpenedRow({ effectiveDate: "2026-01-01" });
    const componentVersions = [
      componentRow({ componentKey: "a", originalPrincipalCents: 600_000, rateBps: 0, scheduledComponentAmountCents: 60_000, effectiveDate: "2026-01-01", allocationPriority: 1 }),
      componentRow({ componentKey: "b", originalPrincipalCents: 400_000, rateBps: 0, scheduledComponentAmountCents: 40_000, effectiveDate: "2026-01-01", allocationPriority: 2 }),
    ];
    const accountTermsVersions = [termsRow({ effectiveDate: "2026-01-01", regularScheduledPaymentAmountCents: 100_000, firstPaymentDueDate: "2026-03-01" })];
    const result = computeReminderCandidate({ accountStatus: "active", eventRows: [opened], componentRows: componentVersions, termsRows: accountTermsVersions, asOfDate: "2026-03-01" });
    expect(result.eligible).toBe(true);
    expect(result.principalRemainingCents).toBe(1_000_000); // 600_000 + 400_000, not doubled or dropped
  });

  it("reflects a principal correction (credit) in the reminder's balance, not the pre-correction amount", () => {
    // A small credit (5_000) that does not, by itself, fully cover the upcoming 100_000 installment --
    // large enough to prove the balance moved, small enough that the installment is still genuinely due.
    const { opened, componentVersions, accountTermsVersions } = singleComponentAccount({ originalPrincipalCents: 1_000_000, firstPaymentDueDate: "2026-03-01" });
    const correction = principalCorrectionRow({ id: "evt_credit", effectiveDate: "2026-01-15", componentId: "c1", deltaCents: -5_000, correctedAfter: 995_000 });
    const result = computeReminderCandidate({ accountStatus: "active", eventRows: [opened, correction], componentRows: componentVersions, termsRows: accountTermsVersions, asOfDate: "2026-03-01" });
    expect(result.eligible).toBe(true);
    expect(result.principalRemainingCents).toBe(995_000);
  });

  it("reflects a payment reversal (bounced payment) restoring principal, not the post-payment amount", () => {
    const { opened, componentVersions, accountTermsVersions } = singleComponentAccount({ originalPrincipalCents: 1_000_000, firstPaymentDueDate: "2026-03-01" });
    const payment = payFullInstallment({ id: "evt_pay1", effectiveDate: "2026-01-15", remainingBefore: 1_000_000, amountCents: 100_000 });
    const reversal = paymentReversalRow({
      id: "evt_reversal",
      effectiveDate: "2026-01-20",
      reversesEventId: "evt_pay1",
      amountCents: 100_000,
      allocation: { interestPaidByComponentCents: payment.interest_paid_by_component_cents, principalPaidByComponentCents: payment.principal_paid_by_component_cents, unallocatedCents: payment.unallocated_cents },
      principalRemainingByComponentCents: { c1: 1_000_000 },
    });
    const result = computeReminderCandidate({ accountStatus: "active", eventRows: [opened, payment, reversal], componentRows: componentVersions, termsRows: accountTermsVersions, asOfDate: "2026-03-01" });
    expect(result.eligible).toBe(true);
    expect(result.principalRemainingCents).toBe(1_000_000); // fully restored, not left at the post-payment 900_000
  });

  it("respects a terms amendment that changes the next due date going forward", () => {
    // v1: due 2026-02-01. v2 (effective 2026-02-15, before v1's due date would otherwise recur):
    // due 2026-04-01. asOfDate values are chosen so each check's own 7-day reminder window falls
    // strictly before the OTHER version's effective date, so exactly one version governs each check.
    const amendedTerms = termsRow({ effectiveDate: "2026-02-15", versionNumber: 2, regularScheduledPaymentAmountCents: 100_000, firstPaymentDueDate: "2026-04-01" });
    const { opened, componentVersions, accountTermsVersions } = singleComponentAccount({ firstPaymentDueDate: "2026-02-01", extraTermsVersions: [amendedTerms] });
    // Before the amendment's effective date, the original schedule (due 2026-02-01) still governs.
    const before = computeReminderCandidate({ accountStatus: "active", eventRows: [opened], componentRows: componentVersions, termsRows: accountTermsVersions, asOfDate: "2026-01-25" });
    expect(before.eligible).toBe(true);
    expect(before.dueDate).toBe("2026-02-01");
    // As of the amended version's own effective date, the amendment governs -- due 2026-04-01.
    const after = computeReminderCandidate({ accountStatus: "active", eventRows: [opened], componentRows: componentVersions, termsRows: accountTermsVersions, asOfDate: "2026-03-25" });
    expect(after.eligible).toBe(true);
    expect(after.dueDate).toBe("2026-04-01");
  });

  it("does not remind a fully paid-off account even when the schedule's own cash-flow bookkeeping would otherwise still show an installment due", () => {
    // A single lump-sum payment that fully retires a 100_000 loan doesn't cash-flow-match a second
    // 100_000 "installment" the schedule would otherwise expect on 2026-03-01 -- true remaining
    // principal (0) must still win over that schedule-shortfall arithmetic.
    const { opened, componentVersions, accountTermsVersions } = singleComponentAccount({ originalPrincipalCents: 100_000, regularPaymentCents: 100_000, firstPaymentDueDate: "2026-02-01" });
    const payoff = payFullInstallment({ id: "evt_payoff", effectiveDate: "2026-02-01", remainingBefore: 100_000, amountCents: 100_000 });
    const result = computeReminderCandidate({ accountStatus: "active", eventRows: [opened, payoff], componentRows: componentVersions, termsRows: accountTermsVersions, asOfDate: "2026-03-01" });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("balance_paid_in_full");
  });
});

describe("evaluateInstallmentStillOwed", () => {
  it("is owed when the installment for the given due date has not been paid", () => {
    const { opened, componentVersions, accountTermsVersions } = singleComponentAccount({ firstPaymentDueDate: "2026-03-01" });
    const result = evaluateInstallmentStillOwed({ accountStatus: "active", eventRows: [opened], componentRows: componentVersions, termsRows: accountTermsVersions, asOfDate: "2026-02-26", dueDate: "2026-03-01" });
    expect(result.owed).toBe(true);
    expect(result.scheduledPaymentAmountCents).toBe(100_000);
    expect(result.principalRemainingCents).toBe(1_000_000);
  });

  it("is not owed once a payment posted between the original attempt and the retry satisfies that installment", () => {
    const { opened, componentVersions, accountTermsVersions } = singleComponentAccount({ firstPaymentDueDate: "2026-03-01" });
    const payment = payFullInstallment({ id: "evt_pay1", effectiveDate: "2026-02-27", remainingBefore: 1_000_000, amountCents: 100_000 });
    const result = evaluateInstallmentStillOwed({ accountStatus: "active", eventRows: [opened, payment], componentRows: componentVersions, termsRows: accountTermsVersions, asOfDate: "2026-02-28", dueDate: "2026-03-01" });
    expect(result.owed).toBe(false);
    expect(result.reason).toBe("installment_already_satisfied");
  });

  it.each(["paid_off", "written_off", "cancelled"])("is not owed for a %s account, regardless of the ledger", (status) => {
    const { opened, componentVersions, accountTermsVersions } = singleComponentAccount({ firstPaymentDueDate: "2026-03-01" });
    const result = evaluateInstallmentStillOwed({ accountStatus: status, eventRows: [opened], componentRows: componentVersions, termsRows: accountTermsVersions, asOfDate: "2026-02-28", dueDate: "2026-03-01" });
    expect(result.owed).toBe(false);
    expect(result.reason).toBe("account_not_active");
  });

  it("is not owed once the account's true balance has been paid off in full, even before the due date arrives", () => {
    const { opened, componentVersions, accountTermsVersions } = singleComponentAccount({ originalPrincipalCents: 100_000, regularPaymentCents: 100_000, firstPaymentDueDate: "2026-02-01" });
    const payoff = payFullInstallment({ id: "evt_payoff", effectiveDate: "2026-01-20", remainingBefore: 100_000, amountCents: 100_000 });
    const result = evaluateInstallmentStillOwed({ accountStatus: "active", eventRows: [opened, payoff], componentRows: componentVersions, termsRows: accountTermsVersions, asOfDate: "2026-01-25", dueDate: "2026-02-01" });
    expect(result.owed).toBe(false);
    expect(result.reason).toBe("balance_paid_in_full");
  });

  it("fails closed (unavailable) rather than guessing when replay data is malformed at retry time", () => {
    const { opened, componentVersions, accountTermsVersions } = singleComponentAccount({ firstPaymentDueDate: "2026-03-01" });
    const malformed = { ...payFullInstallment({ id: "evt_bad", effectiveDate: "2026-02-27", remainingBefore: 1_000_000, amountCents: 100_000 }), principal_remaining_by_component_cents: "not-an-object" };
    const result = evaluateInstallmentStillOwed({ accountStatus: "active", eventRows: [opened, malformed], componentRows: componentVersions, termsRows: accountTermsVersions, asOfDate: "2026-02-28", dueDate: "2026-03-01" });
    expect(result.owed).toBe(false);
    expect(result.unavailable).toBe(true);
    expect(result.reason).toBe("replay_unavailable");
  });
});

describe("buildDeliveryRowId / buildProviderIdempotencyKey", () => {
  it("are pure and deterministic -- identical inputs always produce identical keys, across an original attempt, a retry, or two genuinely concurrent invocations", () => {
    const args = { ownerId: "owner_1", accountId: "acct_1", borrowerId: "b1", dueDate: "2026-03-01", reminderType: REMINDER_TYPE.SEVEN_DAYS_BEFORE };
    expect(buildDeliveryRowId(args)).toBe(buildDeliveryRowId({ ...args }));
    expect(buildProviderIdempotencyKey(args)).toBe(buildProviderIdempotencyKey({ ...args }));
  });

  it("produces different keys for different logical deliveries", () => {
    const base = { ownerId: "owner_1", accountId: "acct_1", borrowerId: "b1", dueDate: "2026-03-01", reminderType: REMINDER_TYPE.SEVEN_DAYS_BEFORE };
    expect(buildDeliveryRowId(base)).not.toBe(buildDeliveryRowId({ ...base, reminderType: REMINDER_TYPE.DUE_DATE }));
    expect(buildProviderIdempotencyKey(base)).not.toBe(buildProviderIdempotencyKey({ ...base, dueDate: "2026-03-08" }));
  });

  it("keeps the DB row id and the provider-facing idempotency key in visibly distinct namespaces", () => {
    const args = { ownerId: "owner_1", accountId: "acct_1", borrowerId: "b1", dueDate: "2026-03-01", reminderType: REMINDER_TYPE.DUE_DATE };
    expect(buildDeliveryRowId(args)).not.toBe(buildProviderIdempotencyKey(args));
  });
});

describe("buildReminderEmail", () => {
  it("includes the balance line only when principalRemainingCents is a number", () => {
    const withBalance = buildReminderEmail({ borrowerFullName: "Alex Borrower", reminderType: REMINDER_TYPE.DUE_DATE, dueDate: "2026-03-01", scheduledPaymentAmountCents: 100_000, principalRemainingCents: 800_000, portalUrl: "https://example.test/portal" });
    expect(withBalance.bodyText).toContain("Current principal remaining: $8,000.00");

    const withoutBalance = buildReminderEmail({ borrowerFullName: "Alex Borrower", reminderType: REMINDER_TYPE.DUE_DATE, dueDate: "2026-03-01", scheduledPaymentAmountCents: 100_000, principalRemainingCents: undefined, portalUrl: "https://example.test/portal" });
    expect(withoutBalance.bodyText).not.toContain("principal remaining");
  });

  it("never contains late-fee, collection, or overdue language, for either reminder type", () => {
    for (const reminderType of [REMINDER_TYPE.DUE_DATE, REMINDER_TYPE.SEVEN_DAYS_BEFORE]) {
      const email = buildReminderEmail({ borrowerFullName: "Alex Borrower", reminderType, dueDate: "2026-03-01", scheduledPaymentAmountCents: 100_000, principalRemainingCents: 800_000, portalUrl: "https://example.test/portal" });
      expect(email.subject).not.toMatch(/late fee|late charge|past due|overdue|collection|delinquent/i);
      expect(email.bodyText).not.toMatch(/late fee|late charge|past due|overdue|collection|delinquent/i);
    }
  });

  it("includes the portal link and payment amount", () => {
    const email = buildReminderEmail({ borrowerFullName: "Alex Borrower", reminderType: REMINDER_TYPE.SEVEN_DAYS_BEFORE, dueDate: "2026-03-01", scheduledPaymentAmountCents: 51_785, principalRemainingCents: 800_000, portalUrl: "https://example.test/portal?email=alex%40example.test" });
    expect(email.bodyText).toContain("https://example.test/portal?email=alex%40example.test");
    expect(email.bodyText).toContain("$517.85");
    expect(email.bodyText).toContain("Alex Borrower");
  });
});

describe("addDaysISODate", () => {
  it("adds days across a month boundary", () => {
    expect(addDaysISODate("2026-02-22", 7)).toBe("2026-03-01");
  });
  it("adds days across a leap-year February", () => {
    expect(addDaysISODate("2028-02-25", 7)).toBe("2028-03-03");
  });
});

describe("formatCentsAsUsd", () => {
  it("formats whole and fractional dollar amounts", () => {
    expect(formatCentsAsUsd(100_000)).toBe("$1,000.00");
    expect(formatCentsAsUsd(51_785)).toBe("$517.85");
  });
});

describe("buildPortalUrl", () => {
  it("carries the recipient's own email as a query param", () => {
    expect(buildPortalUrl("https://example.test", "Alex@Example.test")).toBe("https://example.test/forge/private-financing/portal?email=Alex%40Example.test");
  });
});
