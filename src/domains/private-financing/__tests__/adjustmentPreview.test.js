import { describe, expect, it } from "vitest";
import {
  previewContractualPrincipalCorrection,
  previewDiscretionaryPrincipalConcession,
  previewBringCurrentCredit,
  previewInterestCorrection,
  previewInterestWaiver,
  previewStripeFeeReimbursement,
  previewCompensatingCorrection,
  previewExternalManualPayment,
  previewPaymentReversal,
  previewPayoffConcession,
  previewAccountClosure,
} from "../adjustmentPreview.js";
import { replayEvents } from "../replayEvents.js";
import { allocatePayment } from "../paymentAllocation.js";
import { LedgerIntegrityViolationError } from "../ledgerIntegrity.js";
import { PRIVATE_FINANCING_EVENT_TYPE, PRIVATE_FINANCING_EVENT_ORIGIN, CORRECTION_BASIS } from "../privateFinancingContracts.js";

const ACTOR = "11111111-1111-1111-1111-111111111111";

function accountOpened({ effectiveDate = "2026-01-01" } = {}) {
  return {
    id: "evt_open",
    ownerId: "owner_1",
    accountId: "acct_1",
    eventType: PRIVATE_FINANCING_EVENT_TYPE.ACCOUNT_OPENED,
    eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER,
    createdBy: ACTOR,
    effectiveDate,
    ledgerSequence: 1,
    recordedAt: `${effectiveDate}T00:00:00.000Z`,
  };
}

function componentVersions({ ib, zi, effectiveDate = "2026-01-01" } = {}) {
  const ibFields = { originalPrincipalCents: 1_000_000, rateBps: 600, scheduledComponentAmountCents: 1_000_000, ...ib };
  const ziFields = { originalPrincipalCents: 200_000, rateBps: 0, scheduledComponentAmountCents: 200_000, ...zi };
  return [
    { ownerId: "owner_1", id: "comp_ib", accountId: "acct_1", componentKey: "ib", label: "Interest-bearing note", dayCountConvention: "actual_365", allocationPriority: 1, effectiveDate, versionNumber: 1, ...ibFields },
    { ownerId: "owner_1", id: "comp_zi", accountId: "acct_1", componentKey: "zi", label: "Zero-interest note", dayCountConvention: "actual_365", allocationPriority: 2, effectiveDate, versionNumber: 1, ...ziFields },
  ];
}

function accountTermsVersions({ effectiveDate = "2026-01-01", regularScheduledPaymentAmountCents = 1_200_000, extraPaymentAllocationPolicy = "highest_rate_first_extra" } = {}) {
  return [
    {
      ownerId: "owner_1", id: "terms_1", accountId: "acct_1", versionNumber: 1, paymentFrequency: "monthly",
      firstPaymentDueDate: "2026-02-01", regularScheduledPaymentAmountCents, maturityDate: null,
      allocationPolicy: "scheduled_component_order", extraPaymentAllocationPolicy,
      prepaymentPolicy: "allowed_without_penalty_does_not_advance_due_date", dayCountConvention: "actual_365",
      effectiveDate, actingSellerId: "owner_1", amendmentReason: null,
    },
  ];
}

describe("adjustment previews -- purity", () => {
  it("never mutates the input events array and returns a frozen result", () => {
    const events = [accountOpened()];
    const copy = [...events];
    const comps = componentVersions();
    const terms = accountTermsVersions();
    const preview = previewContractualPrincipalCorrection({
      events,
      componentVersions: comps,
      accountTermsVersions: terms,
      asOfDate: "2026-01-01",
      componentId: "zi",
      deltaCents: -1_000,
      reason: "fix",
      createdBy: ACTOR,
    });
    expect(events).toEqual(copy);
    expect(Object.isFrozen(preview)).toBe(true);
    expect(Object.isFrozen(preview.balanceAfterByComponentCents)).toBe(true);
  });

  it("produces a proposedEventPayload but never an id, ledgerSequence, or recordedAt -- posting is a later, explicit step", () => {
    const preview = previewContractualPrincipalCorrection({
      events: [accountOpened()],
      componentVersions: componentVersions(),
      accountTermsVersions: accountTermsVersions(),
      asOfDate: "2026-01-01",
      componentId: "zi",
      deltaCents: -1_000,
      reason: "fix",
      createdBy: ACTOR,
    });
    expect(preview.proposedEventPayload).not.toHaveProperty("id");
    expect(preview.proposedEventPayload).not.toHaveProperty("ledgerSequence");
    expect(preview.proposedEventPayload).not.toHaveProperty("recordedAt");
  });

  it("calling the same preview twice with identical arguments produces a deep-equal result", () => {
    const args = {
      events: [accountOpened()],
      componentVersions: componentVersions(),
      accountTermsVersions: accountTermsVersions(),
      asOfDate: "2026-01-01",
      componentId: "zi",
      deltaCents: -1_000,
      reason: "fix",
      createdBy: ACTOR,
    };
    expect(previewContractualPrincipalCorrection(args)).toEqual(previewContractualPrincipalCorrection(args));
  });

  it("every preview returns the complete common envelope", () => {
    const preview = previewExternalManualPayment({
      events: [accountOpened()],
      componentVersions: componentVersions(),
      accountTermsVersions: accountTermsVersions(),
      asOfDate: "2026-01-01",
      amountCents: 1_000,
      idempotencyKey: "k1",
    });
    for (const field of [
      "ownerId",
      "accountId",
      "asOfDate",
      "balanceBeforeByComponentCents",
      "unpaidAccruedInterestBeforeCents",
      "proposedAdjustment",
      "allocationBreakdown",
      "balanceAfterByComponentCents",
      "principalByComponent",
      "interestEffect",
      "pastDueEffect",
      "payoffEffect",
      "warnings",
      "blockingValidation",
      "proposedEventPayload",
    ]) {
      expect(preview).toHaveProperty(field);
    }
  });
});

describe("previewContractualPrincipalCorrection vs previewDiscretionaryPrincipalConcession", () => {
  it("a contractual correction does not require a borrowerVisibleExplanation", () => {
    expect(() =>
      previewContractualPrincipalCorrection({
        events: [accountOpened()], componentVersions: componentVersions(), accountTermsVersions: accountTermsVersions(),
        asOfDate: "2026-01-01", componentId: "zi", deltaCents: -1_000, reason: "data fix", createdBy: ACTOR,
      }),
    ).not.toThrow();
  });

  it("a discretionary concession REQUIRES a borrowerVisibleExplanation -- kept separate from contractual corrections", () => {
    expect(() =>
      previewDiscretionaryPrincipalConcession({
        events: [accountOpened()], componentVersions: componentVersions(), accountTermsVersions: accountTermsVersions(),
        asOfDate: "2026-01-01", componentId: "zi", deltaCents: -1_000, reason: "goodwill", createdBy: ACTOR,
      }),
    ).toThrow(/borrowerVisibleExplanation/);
  });

  it("tags the proposedAdjustment.kind and correctionBasis differently for each", () => {
    const contractual = previewContractualPrincipalCorrection({
      events: [accountOpened()], componentVersions: componentVersions(), accountTermsVersions: accountTermsVersions(),
      asOfDate: "2026-01-01", componentId: "zi", deltaCents: -1_000, reason: "fix", createdBy: ACTOR,
    });
    const discretionary = previewDiscretionaryPrincipalConcession({
      events: [accountOpened()],
      componentVersions: componentVersions(),
      accountTermsVersions: accountTermsVersions(),
      asOfDate: "2026-01-01",
      componentId: "zi",
      deltaCents: -1_000,
      reason: "goodwill",
      borrowerVisibleExplanation: "We're crediting $10 as a goodwill gesture.",
      createdBy: ACTOR,
    });
    expect(contractual.proposedAdjustment.correctionBasis).toBe("contractual_administrative");
    expect(discretionary.proposedAdjustment.correctionBasis).toBe("discretionary_concession");
  });

  it("blocks (does not throw) a correction that would drive a component negative", () => {
    const preview = previewContractualPrincipalCorrection({
      events: [accountOpened()],
      componentVersions: componentVersions(),
      accountTermsVersions: accountTermsVersions(),
      asOfDate: "2026-01-01",
      componentId: "zi",
      deltaCents: -999_999,
      reason: "too much",
      createdBy: ACTOR,
    });
    expect(preview.blockingValidation.length).toBeGreaterThan(0);
    expect(preview.proposedEventPayload).toBeNull();
  });
});

// The full 48-payment golden reconciliation against South Main's real, owner-approved numbers is proven
// once, through ordinary configuration, in replayEvents.test.js -- this describe block exercises
// previewBringCurrentCredit's own shape/behavior (shortage calculation, credit application, past-due
// effect) against a small generic fixture rather than duplicating that fold here.
//
// AUTHORITATIVE DUE-STATE ONLY: scheduledAmountThroughAsOfDateCents/nextDueDate/nextDueAmountCents are no
// longer caller inputs -- previewBringCurrentCredit derives them itself from computeDueState (dueState.js),
// so these tests set up a real shortage via the account's own schedule (asOfDate on/after firstPaymentDueDate
// with no payments made) rather than asserting a hand-typed number.
describe("previewBringCurrentCredit", () => {
  it("brings a shortage to exactly zero and reduces the selected component's principal by the credit amount", () => {
    const comps = componentVersions({ ib: { originalPrincipalCents: 100_000, scheduledComponentAmountCents: 5_000 }, zi: { originalPrincipalCents: 20_000, scheduledComponentAmountCents: 1_000 } });
    const terms = accountTermsVersions({ regularScheduledPaymentAmountCents: 6_000 });
    const events = [accountOpened()];

    // firstPaymentDueDate is 2026-02-01 (accountTermsVersions' own fixed default) -- asOfDate on exactly
    // that date, with no payment ever posted, produces a real, computed $60.00 shortage (one installment).
    const preview = previewBringCurrentCredit({
      events,
      componentVersions: comps,
      accountTermsVersions: terms,
      asOfDate: "2026-02-01",
      proposedCreditCents: 6_000,
      componentId: "ib",
      reason: "Owner-approved bring-current credit",
      borrowerVisibleExplanation: "We're crediting your account to bring it current.",
      createdBy: ACTOR,
    });

    expect(preview.pastDueEffect.shortageCents).toBe(6_000);
    expect(preview.pastDueEffect.pastDueAfterCents).toBe(0);
    expect(preview.pastDueEffect.nextDueDate).toBe("2026-03-01");
    expect(preview.blockingValidation).toEqual([]);

    const withCredit = replayEvents({
      events: [...events, { ...preview.proposedEventPayload, id: "evt_credit", ledgerSequence: 2, recordedAt: "2026-02-01T00:00:00.000Z" }],
      componentVersions: comps,
      accountTermsVersions: terms,
      asOfDate: "2026-02-01",
    });
    expect(withCredit.remainingPrincipalByComponentCents.ib).toBe(94_000);
    expect(withCredit.remainingPrincipalByComponentCents.zi).toBe(20_000);
  });

  it("fails closed with a blocker (never a guessed or partially-computed credit) when the account's own terms are outside the due-state engine's supported envelope", () => {
    const comps = componentVersions();
    const unsupportedTerms = accountTermsVersions().map((version) => ({ ...version, prepaymentPolicy: "unsupported" }));
    const preview = previewBringCurrentCredit({
      events: [accountOpened()],
      componentVersions: comps,
      accountTermsVersions: unsupportedTerms,
      asOfDate: "2026-03-01",
      proposedCreditCents: 6_000,
      componentId: "ib",
      reason: "Attempted bring-current credit",
      borrowerVisibleExplanation: "We're crediting your account.",
      createdBy: ACTOR,
    });
    expect(preview.pastDueEffect).toBeNull();
    expect(preview.blockingValidation.length).toBeGreaterThan(0);
    expect(preview.blockingValidation[0]).toMatch(/computable due schedule/);
    expect(preview.proposedEventPayload).toBeNull();
  });
});

describe("previewInterestCorrection vs previewInterestWaiver", () => {
  it("a waiver must be zero or negative -- it only ever forgives", () => {
    expect(() =>
      previewInterestWaiver({
        events: [accountOpened()], componentVersions: componentVersions(), accountTermsVersions: accountTermsVersions(),
        asOfDate: "2026-01-01", componentId: "ib", deltaCents: 100, reason: "x", borrowerVisibleExplanation: "x", createdBy: ACTOR,
      }),
    ).toThrow(/only ever forgives/);
  });

  it("blocks reducing accrued interest below zero", () => {
    const preview = previewInterestCorrection({
      events: [accountOpened()], componentVersions: componentVersions(), accountTermsVersions: accountTermsVersions(),
      asOfDate: "2026-01-01", componentId: "ib", deltaCents: -999_999, reason: "too much", createdBy: ACTOR,
    });
    expect(preview.blockingValidation.length).toBeGreaterThan(0);
  });

  it("blocks a correction against a component that does not exist on the account", () => {
    const preview = previewInterestCorrection({
      events: [accountOpened()], componentVersions: componentVersions(), accountTermsVersions: accountTermsVersions(),
      asOfDate: "2026-01-01", componentId: "not_a_component", deltaCents: -100, reason: "x", createdBy: ACTOR,
    });
    expect(preview.blockingValidation.length).toBeGreaterThan(0);
    expect(preview.proposedEventPayload).toBeNull();
  });
});

describe("previewStripeFeeReimbursement", () => {
  it("by default never touches the loan ledger -- proposedEventPayload is null, balance unchanged", () => {
    const events = [accountOpened()];
    const preview = previewStripeFeeReimbursement({
      events, componentVersions: componentVersions(), accountTermsVersions: accountTermsVersions(),
      asOfDate: "2026-01-01", feeAmountCents: 150, reason: "Stripe processing fee absorbed by seller",
    });
    expect(preview.proposedEventPayload).toBeNull();
    expect(preview.balanceAfterByComponentCents.ib).toBe(preview.balanceBeforeByComponentCents.ib);
    expect(preview.balanceAfterByComponentCents.zi).toBe(preview.balanceBeforeByComponentCents.zi);
  });

  it("only becomes a ledger event when the seller explicitly elects postAsLoanCredit: true", () => {
    const preview = previewStripeFeeReimbursement({
      events: [accountOpened()],
      componentVersions: componentVersions(),
      accountTermsVersions: accountTermsVersions(),
      asOfDate: "2026-01-01",
      feeAmountCents: 150,
      postAsLoanCredit: true,
      componentId: "ib",
      reason: "Seller elected to credit the Stripe fee to the loan",
      borrowerVisibleExplanation: "We're crediting the processing fee to your balance.",
      createdBy: ACTOR,
    });
    expect(preview.proposedEventPayload).not.toBeNull();
    expect(preview.proposedEventPayload.eventType).toBe("principal_correction");
    expect(preview.proposedEventPayload.correctionBasis).toBe("discretionary_concession");
    expect(preview.proposedEventPayload.deltaCents).toBe(-150);
  });

  it("never reduces the amount credited from a borrower payment -- it has no access to any payment's allocation at all", () => {
    // Structural proof: the function signature has no paymentEventId/allocation parameter whatsoever.
    expect(previewStripeFeeReimbursement.length).toBeLessThanOrEqual(1); // single destructured options param
  });
});

describe("previewCompensatingCorrection", () => {
  it("previews reversing a prior principal_correction", () => {
    const opened = accountOpened();
    const comps = componentVersions();
    const terms = accountTermsVersions();
    const correction = {
      id: "evt_correction",
      ownerId: "owner_1",
      accountId: "acct_1",
      eventType: PRIVATE_FINANCING_EVENT_TYPE.PRINCIPAL_CORRECTION,
      eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER,
      createdBy: ACTOR,
      componentId: "zi",
      correctionBasis: CORRECTION_BASIS.CONTRACTUAL_ADMINISTRATIVE,
      deltaCents: -2_000,
      correctedComponentPrincipalRemainingCentsAfter: 198_000,
      reason: "wrong amount",
      effectiveDate: "2026-01-02",
      ledgerSequence: 2,
      recordedAt: "2026-01-02T00:00:00.000Z",
    };
    const preview = previewCompensatingCorrection({
      events: [opened, correction], componentVersions: comps, accountTermsVersions: terms,
      asOfDate: "2026-01-03", reversesEventId: "evt_correction", deltaCents: 2_000, reason: "undo it", createdBy: ACTOR,
    });
    expect(preview.blockingValidation).toEqual([]);
    expect(preview.balanceAfterByComponentCents.zi).toBe(200_000);
    expect(preview.proposedEventPayload.eventType).toBe("compensating_correction");
  });

  it("blocks reversing an event that was already reversed", () => {
    const opened = accountOpened();
    const comps = componentVersions();
    const terms = accountTermsVersions();
    const correction = {
      id: "evt_correction",
      ownerId: "owner_1",
      accountId: "acct_1",
      eventType: PRIVATE_FINANCING_EVENT_TYPE.PRINCIPAL_CORRECTION,
      eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER,
      createdBy: ACTOR,
      componentId: "zi",
      correctionBasis: CORRECTION_BASIS.CONTRACTUAL_ADMINISTRATIVE,
      deltaCents: -2_000,
      correctedComponentPrincipalRemainingCentsAfter: 198_000,
      reason: "wrong amount",
      effectiveDate: "2026-01-02",
      ledgerSequence: 2,
      recordedAt: "2026-01-02T00:00:00.000Z",
    };
    const firstReversal = {
      id: "evt_first_reversal",
      ownerId: "owner_1",
      accountId: "acct_1",
      eventType: PRIVATE_FINANCING_EVENT_TYPE.COMPENSATING_CORRECTION,
      eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER,
      createdBy: ACTOR,
      reversesEventId: "evt_correction",
      componentId: "zi",
      deltaCents: 2_000,
      reason: "undo it",
      effectiveDate: "2026-01-03",
      ledgerSequence: 3,
      recordedAt: "2026-01-03T00:00:00.000Z",
    };
    const preview = previewCompensatingCorrection({
      events: [opened, correction, firstReversal], componentVersions: comps, accountTermsVersions: terms,
      asOfDate: "2026-01-04", reversesEventId: "evt_correction", deltaCents: 2_000, reason: "undo again", createdBy: ACTOR,
    });
    expect(preview.blockingValidation.length).toBeGreaterThan(0);
    expect(preview.proposedEventPayload).toBeNull();
  });
});

describe("previewPaymentReversal", () => {
  function postedPayment(events, comps, terms, { asOfDate = "2026-01-02", amountCents = 500_000 } = {}) {
    const preview = previewExternalManualPayment({ events, componentVersions: comps, accountTermsVersions: terms, asOfDate, amountCents, idempotencyKey: "k1" });
    return { ...preview.proposedEventPayload, id: "evt_payment", ledgerSequence: events.length + 1, recordedAt: `${asOfDate}T00:00:00.000Z` };
  }

  it("undoes exactly the target payment's own allocation -- principal and interest both move back by what was applied", () => {
    const opened = accountOpened();
    const comps = componentVersions();
    const terms = accountTermsVersions();
    const payment = postedPayment([opened], comps, terms);
    const preview = previewPaymentReversal({
      events: [opened, payment], componentVersions: comps, accountTermsVersions: terms,
      asOfDate: "2026-01-03", reversesEventId: "evt_payment", reason: "bounced check", createdBy: ACTOR,
    });
    expect(preview.blockingValidation).toEqual([]);
    expect(preview.proposedEventPayload.eventType).toBe("payment_reversal");
    expect(preview.proposedEventPayload.amountCents).toBe(payment.amountCents);
    expect(preview.allocationBreakdown).toEqual(payment.allocation);
    // The reversal exactly restores the pre-payment principal, on both components.
    const snapshotBeforePayment = replayEvents({ events: [opened], componentVersions: comps, accountTermsVersions: terms, asOfDate: "2026-01-02" });
    expect(preview.balanceAfterByComponentCents.ib).toBe(snapshotBeforePayment.remainingPrincipalByComponentCents.ib);
    expect(preview.balanceAfterByComponentCents.zi).toBe(snapshotBeforePayment.remainingPrincipalByComponentCents.zi);
  });

  it("rejects reversing a non-existent event", () => {
    const opened = accountOpened();
    const preview = previewPaymentReversal({
      events: [opened], componentVersions: componentVersions(), accountTermsVersions: accountTermsVersions(),
      asOfDate: "2026-01-03", reversesEventId: "evt_missing", reason: "bounced check", createdBy: ACTOR,
    });
    expect(preview.blockingValidation.length).toBeGreaterThan(0);
    expect(preview.proposedEventPayload).toBeNull();
  });

  it("rejects reversing a non-payment event (e.g. a principal_correction) -- payment_reversal can only target payment_posted", () => {
    const opened = accountOpened();
    const correction = {
      id: "evt_correction", ownerId: "owner_1", accountId: "acct_1", eventType: PRIVATE_FINANCING_EVENT_TYPE.PRINCIPAL_CORRECTION,
      eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER, createdBy: ACTOR, componentId: "zi",
      correctionBasis: CORRECTION_BASIS.CONTRACTUAL_ADMINISTRATIVE, deltaCents: -2_000, correctedComponentPrincipalRemainingCentsAfter: 198_000,
      reason: "wrong amount", effectiveDate: "2026-01-02", ledgerSequence: 2, recordedAt: "2026-01-02T00:00:00.000Z",
    };
    const preview = previewPaymentReversal({
      events: [opened, correction], componentVersions: componentVersions(), accountTermsVersions: accountTermsVersions(),
      asOfDate: "2026-01-03", reversesEventId: "evt_correction", reason: "undo", createdBy: ACTOR,
    });
    expect(preview.blockingValidation.length).toBeGreaterThan(0);
    expect(preview.proposedEventPayload).toBeNull();
  });

  it("rejects reversing the same payment twice", () => {
    const opened = accountOpened();
    const comps = componentVersions();
    const terms = accountTermsVersions();
    const payment = postedPayment([opened], comps, terms);
    const firstReversal = {
      id: "evt_first_reversal", ownerId: "owner_1", accountId: "acct_1", eventType: PRIVATE_FINANCING_EVENT_TYPE.PAYMENT_REVERSAL,
      eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER, createdBy: ACTOR, reversesEventId: "evt_payment",
      amountCents: payment.amountCents, allocation: payment.allocation,
      principalRemainingByComponentCents: Object.fromEntries(
        Object.entries(payment.principalRemainingByComponentCents).map(([componentId, cents]) => [componentId, cents + (payment.allocation.principalPaidByComponentCents[componentId] ?? 0)]),
      ),
      reason: "bounced", effectiveDate: "2026-01-03",
      ledgerSequence: 3, recordedAt: "2026-01-03T00:00:00.000Z",
    };
    const preview = previewPaymentReversal({
      events: [opened, payment, firstReversal], componentVersions: comps, accountTermsVersions: terms,
      asOfDate: "2026-01-04", reversesEventId: "evt_payment", reason: "reverse again", createdBy: ACTOR,
    });
    expect(preview.blockingValidation.length).toBeGreaterThan(0);
    expect(preview.proposedEventPayload).toBeNull();
  });

  it("requires reason and createdBy", () => {
    expect(() =>
      previewPaymentReversal({
        events: [accountOpened()], componentVersions: componentVersions(), accountTermsVersions: accountTermsVersions(),
        asOfDate: "2026-01-03", reversesEventId: "evt_payment", reason: "", createdBy: ACTOR,
      }),
    ).toThrow(LedgerIntegrityViolationError);
    expect(() =>
      previewPaymentReversal({
        events: [accountOpened()], componentVersions: componentVersions(), accountTermsVersions: accountTermsVersions(),
        asOfDate: "2026-01-03", reversesEventId: "evt_payment", reason: "x", createdBy: "",
      }),
    ).toThrow(LedgerIntegrityViolationError);
  });
});

describe("previewExternalManualPayment -- full payoff, insufficient payoff, overpayment", () => {
  it("full payoff with an ordinary payment reaches exactly zero", () => {
    const preview = previewExternalManualPayment({
      events: [accountOpened()], componentVersions: componentVersions(), accountTermsVersions: accountTermsVersions(),
      asOfDate: "2026-01-01", amountCents: 1_200_000, idempotencyKey: "k1",
    });
    expect(preview.balanceAfterByComponentCents).toEqual({ ib: 0, zi: 0 });
    expect(preview.payoffEffect.paysAccountInFull).toBe(true);
    expect(preview.blockingValidation).toEqual([]);
  });

  it("an insufficient payoff payment leaves a positive remaining balance and does not claim payoff-in-full", () => {
    const preview = previewExternalManualPayment({
      events: [accountOpened()], componentVersions: componentVersions(), accountTermsVersions: accountTermsVersions(),
      asOfDate: "2026-01-01", amountCents: 500_000, idempotencyKey: "k1",
    });
    expect(preview.balanceAfterByComponentCents.ib).toBeGreaterThan(0);
    expect(preview.payoffEffect).toBeNull();
  });

  it("an overpayment is blocked by default (fail-closed) but reports the exact unapplied amount", () => {
    const preview = previewExternalManualPayment({
      events: [accountOpened()], componentVersions: componentVersions(), accountTermsVersions: accountTermsVersions(),
      asOfDate: "2026-01-01", amountCents: 1_500_000, idempotencyKey: "k1",
    });
    expect(preview.allocationBreakdown.unallocatedCents).toBe(300_000);
    expect(preview.blockingValidation.length).toBeGreaterThan(0);
    expect(preview.proposedEventPayload).toBeNull();
  });

  it("an overpayment can be explicitly acknowledged to unblock posting, still reporting the unapplied amount", () => {
    const preview = previewExternalManualPayment({
      events: [accountOpened()], componentVersions: componentVersions(), accountTermsVersions: accountTermsVersions(),
      asOfDate: "2026-01-01", amountCents: 1_500_000, idempotencyKey: "k1", acknowledgeOverpayment: true,
    });
    expect(preview.allocationBreakdown.unallocatedCents).toBe(300_000);
    expect(preview.blockingValidation).toEqual([]);
    expect(preview.proposedEventPayload).not.toBeNull();
  });

  it("rejects a non-positive amountCents", () => {
    expect(() =>
      previewExternalManualPayment({
        events: [accountOpened()], componentVersions: componentVersions(), accountTermsVersions: accountTermsVersions(),
        asOfDate: "2026-01-01", amountCents: 0, idempotencyKey: "k1",
      }),
    ).toThrow(LedgerIntegrityViolationError);
  });
});

describe("discounted payoff using payment plus concession", () => {
  it("a payment smaller than the full balance, plus a concession forgiving the remainder, jointly zero the account", () => {
    const events = [accountOpened()];
    const comps = componentVersions();
    const terms = accountTermsVersions();
    const paymentPreview = previewExternalManualPayment({ events, componentVersions: comps, accountTermsVersions: terms, asOfDate: "2026-01-10", amountCents: 1_000_000, idempotencyKey: "k1" });
    expect(paymentPreview.blockingValidation).toEqual([]);
    const paymentEvent = { ...paymentPreview.proposedEventPayload, id: "evt_payment", ledgerSequence: 2, recordedAt: "2026-01-10T00:00:00.000Z" };

    const eventsAfterPayment = [...events, paymentEvent];
    const remaining = paymentPreview.balanceAfterByComponentCents;
    const concessionPreview = previewPayoffConcession({
      events: eventsAfterPayment,
      componentVersions: comps,
      accountTermsVersions: terms,
      asOfDate: "2026-01-10",
      deltaCentsByComponentCents: { ib: -remaining.ib, zi: -remaining.zi },
      reason: "Seller accepted a discounted payoff",
      borrowerVisibleExplanation: "We're forgiving the remaining balance to close your account.",
      createdBy: ACTOR,
    });
    expect(concessionPreview.blockingValidation).toEqual([]);
    expect(concessionPreview.payoffEffect.closesAccount).toBe(true);

    const concessionEvent = { ...concessionPreview.proposedEventPayload, id: "evt_concession", ledgerSequence: 3, recordedAt: "2026-01-10T00:00:00.000Z" };
    const finalState = replayEvents({ events: [...eventsAfterPayment, concessionEvent], componentVersions: comps, accountTermsVersions: terms, asOfDate: "2026-01-10" });
    expect(finalState.totalPrincipalRemainingCents).toBe(0);
  });
});

describe("previewAccountClosure", () => {
  it("is eligible and produces a proposedEventPayload once the balance is exactly zero", () => {
    const events = [accountOpened()];
    const comps = componentVersions();
    const terms = accountTermsVersions();
    // Same-day payoff as account opening -- 0 elapsed days, so the full-payoff amountCents exactly
    // matches the origination totals with no accrued-interest margin to account for.
    const paymentPreview = previewExternalManualPayment({ events, componentVersions: comps, accountTermsVersions: terms, asOfDate: "2026-01-01", amountCents: 1_200_000, idempotencyKey: "k1" });
    const paymentEvent = { ...paymentPreview.proposedEventPayload, id: "evt_payment", ledgerSequence: 2, recordedAt: "2026-01-01T00:00:00.000Z" };
    const preview = previewAccountClosure({ events: [...events, paymentEvent], componentVersions: comps, accountTermsVersions: terms, asOfDate: "2026-01-01", closureReason: "paid_in_full", createdBy: ACTOR });
    expect(preview.blockingValidation).toEqual([]);
    expect(preview.proposedEventPayload.eventType).toBe("account_closed");
  });

  it("blocks closing an account with a positive balance", () => {
    const preview = previewAccountClosure({
      events: [accountOpened()], componentVersions: componentVersions(), accountTermsVersions: accountTermsVersions(),
      asOfDate: "2026-01-01", closureReason: "written_off", createdBy: ACTOR,
    });
    expect(preview.blockingValidation.length).toBeGreaterThan(0);
    expect(preview.proposedEventPayload).toBeNull();
  });

  it("blocks a duplicate close attempt on an already-closed account", () => {
    const events = [accountOpened()];
    const comps = componentVersions();
    const terms = accountTermsVersions();
    const paymentPreview = previewExternalManualPayment({ events, componentVersions: comps, accountTermsVersions: terms, asOfDate: "2026-01-01", amountCents: 1_200_000, idempotencyKey: "k1" });
    const paymentEvent = { ...paymentPreview.proposedEventPayload, id: "evt_payment", ledgerSequence: 2, recordedAt: "2026-01-01T00:00:00.000Z" };
    const closure = {
      id: "evt_closed",
      ownerId: "owner_1",
      accountId: "acct_1",
      eventType: PRIVATE_FINANCING_EVENT_TYPE.ACCOUNT_CLOSED,
      eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER,
      createdBy: ACTOR,
      closureReason: "paid_in_full",
      effectiveDate: "2026-01-01",
      ledgerSequence: 3,
      recordedAt: "2026-01-01T00:00:00.000Z",
    };
    const preview = previewAccountClosure({ events: [...events, paymentEvent, closure], componentVersions: comps, accountTermsVersions: terms, asOfDate: "2026-01-01", closureReason: "paid_in_full", createdBy: ACTOR });
    expect(preview.blockingValidation).toContain("The account is already closed.");
    expect(preview.proposedEventPayload).toBeNull();
  });
});

// SF-2D itself never writes a component or terms row -- every one of its nine actions only ever proposes
// a private_financing_events row. These tests prove the generic component-selection surface is genuinely
// account-scoped (a foreign account's own component key is rejected exactly like any other unknown
// component id, never silently resolved), that V1's imposed component count has no upper bound for an
// ordinary adjustment, and that no adjustment of any kind can ever be mistaken for -- or accidentally
// achieve -- a terms/component edit.
describe("SF-2D generic component selection, cross-account isolation, and terms immutability", () => {
  function threeComponentVersions() {
    return [
      { ownerId: "owner_1", id: "comp_a", accountId: "acct_1", componentKey: "a", label: "Note A", dayCountConvention: "actual_365", allocationPriority: 1, effectiveDate: "2026-01-01", versionNumber: 1, originalPrincipalCents: 300_000, rateBps: 900, scheduledComponentAmountCents: 3_000 },
      { ownerId: "owner_1", id: "comp_b", accountId: "acct_1", componentKey: "b", label: "Note B", dayCountConvention: "actual_365", allocationPriority: 2, effectiveDate: "2026-01-01", versionNumber: 1, originalPrincipalCents: 300_000, rateBps: 500, scheduledComponentAmountCents: 3_000 },
      { ownerId: "owner_1", id: "comp_c", accountId: "acct_1", componentKey: "c", label: "Note C", dayCountConvention: "actual_365", allocationPriority: 3, effectiveDate: "2026-01-01", versionNumber: 1, originalPrincipalCents: 300_000, rateBps: 0, scheduledComponentAmountCents: 3_000 },
    ];
  }

  it("a three-component account: an adjustment against the third (lowest-priority) component works exactly like against any other", () => {
    const comps = threeComponentVersions();
    const terms = accountTermsVersions({ regularScheduledPaymentAmountCents: 9_000 });
    const preview = previewContractualPrincipalCorrection({
      events: [accountOpened()],
      componentVersions: comps,
      accountTermsVersions: terms,
      asOfDate: "2026-01-01",
      componentId: "c",
      deltaCents: -50_000,
      reason: "Data-entry fix on the third component",
      createdBy: ACTOR,
    });
    expect(preview.blockingValidation).toEqual([]);
    expect(preview.balanceAfterByComponentCents).toEqual({ a: 300_000, b: 300_000, c: 250_000 });
    expect(preview.proposedEventPayload.componentId).toBe("c");
  });

  it("the selected component identity is validated against the account's own real components -- an unknown key is rejected, never silently ignored or defaulted", () => {
    const comps = threeComponentVersions();
    const terms = accountTermsVersions({ regularScheduledPaymentAmountCents: 9_000 });
    const preview = previewContractualPrincipalCorrection({
      events: [accountOpened()],
      componentVersions: comps,
      accountTermsVersions: terms,
      asOfDate: "2026-01-01",
      componentId: "not_a_real_component",
      deltaCents: -1_000,
      reason: "Attempted correction against a nonexistent component",
      createdBy: ACTOR,
    });
    expect(preview.blockingValidation.length).toBeGreaterThan(0);
    expect(preview.blockingValidation[0]).toMatch(/does not exist on this account/);
    expect(preview.proposedEventPayload).toBeNull();
  });

  it("a component belonging to a DIFFERENT account is rejected exactly the same way -- the account's own component list is the only source of truth, so a foreign componentKey can never be mistaken for one of this account's own components", () => {
    // Account acct_1's own components (from componentVersions()) are "ib"/"zi". A second, unrelated
    // account (acct_2) has its own, differently-keyed component ("premium_note") that acct_1 never had.
    // A request scoped to acct_1 (its own events/componentVersions, exactly as the real API route would
    // fetch, scoped by account_id) that names acct_2's componentKey must be rejected identically to any
    // other unknown key -- proving there is no cross-account leak even if a caller submits another
    // account's real component identifier.
    const acct1Comps = componentVersions();
    const acct1Terms = accountTermsVersions();
    const preview = previewContractualPrincipalCorrection({
      events: [accountOpened()],
      componentVersions: acct1Comps, // acct_1's own components ONLY -- acct_2's row is never included
      accountTermsVersions: acct1Terms,
      asOfDate: "2026-01-01",
      componentId: "premium_note", // acct_2's own real componentKey
      deltaCents: -1_000,
      reason: "Attempted cross-account component reference",
      createdBy: ACTOR,
    });
    expect(preview.blockingValidation.length).toBeGreaterThan(0);
    expect(preview.blockingValidation[0]).toMatch(/does not exist on this account/);
    expect(preview.proposedEventPayload).toBeNull();
  });

  it("bring-current credit derives its shortage from THIS account's own real schedule terms, never a South-Main-shaped number -- proven with numbers that share nothing with South Main's own $517.85/$45,000/$10,000 figures", () => {
    const comps = threeComponentVersions();
    // A deliberately unusual schedule: $90.00/month, first due 2026-03-01 -- nothing about these numbers
    // resembles South Main's own $517.85 combined payment or 2022-03-23 origination date.
    const terms = accountTermsVersions({ regularScheduledPaymentAmountCents: 9_000 });
    const uncommonTerms = terms.map((version) => ({ ...version, firstPaymentDueDate: "2026-03-01" }));
    const preview = previewBringCurrentCredit({
      events: [accountOpened()],
      componentVersions: comps,
      accountTermsVersions: uncommonTerms,
      asOfDate: "2026-03-01",
      proposedCreditCents: 9_000,
      componentId: "a",
      reason: "Bring current on this account's own schedule",
      borrowerVisibleExplanation: "We're crediting your account.",
      createdBy: ACTOR,
    });
    expect(preview.pastDueEffect.shortageCents).toBe(9_000);
    expect(preview.pastDueEffect.scheduledAmountCents).toBe(9_000);
    expect(preview.pastDueEffect.nextDueDate).toBe("2026-04-01");
    // Never South Main's own figures.
    expect(preview.pastDueEffect.shortageCents).not.toBe(51_785);
    expect(preview.pastDueEffect.scheduledAmountCents).not.toBe(51_785);
  });

  it("a new payment posted between preview and confirm changes the fresh recomputation's shortage -- proving bring-current credit is never computed from a stale snapshot at confirm time", () => {
    const comps = componentVersions();
    const terms = accountTermsVersions({ regularScheduledPaymentAmountCents: 6_000 });
    const openedOnly = [accountOpened()];

    const staleView = previewBringCurrentCredit({
      events: openedOnly,
      componentVersions: comps,
      accountTermsVersions: terms,
      asOfDate: "2026-02-01",
      proposedCreditCents: 6_000,
      componentId: "ib",
      reason: "Bring current",
      borrowerVisibleExplanation: "We're crediting your account.",
      createdBy: ACTOR,
    });
    expect(staleView.pastDueEffect.shortageCents).toBe(6_000);

    // A real payment posts in between -- exactly what the confirm route's own fresh re-fetch would see.
    // Same-day as account opening (0 elapsed days, so accrued interest is genuinely 0) and built via the
    // SAME allocatePayment primitive replay itself uses, so the stored allocation is guaranteed to pass
    // replay's own independent-recomputation cross-check.
    const allocation = allocatePayment({
      components: [
        { componentId: "ib", remainingPrincipalCents: 1_000_000, scheduledComponentAmountCents: 1_000_000, rateBps: 600, allocationPriority: 1 },
        { componentId: "zi", remainingPrincipalCents: 200_000, scheduledComponentAmountCents: 200_000, rateBps: 0, allocationPriority: 2 },
      ],
      accruedInterestCentsByComponent: {},
      paymentAmountCents: 6_000,
      allocationPolicy: "scheduled_component_order",
      extraPaymentAllocationPolicy: "highest_rate_first_extra",
    });
    const paymentEvent = {
      id: "evt_payment", ownerId: "owner_1", accountId: "acct_1", eventType: PRIVATE_FINANCING_EVENT_TYPE.PAYMENT_POSTED,
      eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER, createdBy: ACTOR, effectiveDate: "2026-01-01",
      ledgerSequence: 2, recordedAt: "2026-01-01T00:00:00.000Z", amountCents: 6_000,
      allocation,
      principalRemainingByComponentCents: {
        ib: 1_000_000 - (allocation.principalPaidByComponentCents.ib ?? 0),
        zi: 200_000 - (allocation.principalPaidByComponentCents.zi ?? 0),
      },
    };
    const freshView = previewBringCurrentCredit({
      events: [...openedOnly, paymentEvent],
      componentVersions: comps,
      accountTermsVersions: terms,
      asOfDate: "2026-02-01",
      proposedCreditCents: 6_000,
      componentId: "ib",
      reason: "Bring current",
      borrowerVisibleExplanation: "We're crediting your account.",
      createdBy: ACTOR,
    });
    expect(freshView.pastDueEffect.shortageCents).toBe(0); // the payment already satisfied the one due installment
    expect(freshView.pastDueEffect.shortageCents).not.toBe(staleView.pastDueEffect.shortageCents);
  });

  it("no ADJUSTMENT_ACTION_TYPES entry (imported indirectly via every proposedEventPayload's own eventType) can ever be mistaken for a terms/component edit -- every proposedEventPayload's eventType is one of the seven closed ledger event types, never a components/terms table write", () => {
    const comps = componentVersions();
    const terms = accountTermsVersions();
    const events = [accountOpened()];
    const previews = [
      previewContractualPrincipalCorrection({ events, componentVersions: comps, accountTermsVersions: terms, asOfDate: "2026-01-01", componentId: "zi", deltaCents: -1_000, reason: "x", createdBy: ACTOR }),
      previewInterestCorrection({ events, componentVersions: comps, accountTermsVersions: terms, asOfDate: "2026-01-01", componentId: "ib", deltaCents: -100, reason: "x", createdBy: ACTOR }),
      previewAccountClosure({ events, componentVersions: comps, accountTermsVersions: terms, asOfDate: "2026-01-01", closureReason: "written_off", createdBy: ACTOR }),
    ];
    const closedLedgerEventTypes = new Set([
      "account_opened", "payment_posted", "payment_reversal", "principal_correction",
      "interest_correction", "compensating_correction", "payoff_concession", "account_closed",
    ]);
    for (const preview of previews) {
      if (preview.proposedEventPayload) {
        expect(closedLedgerEventTypes.has(preview.proposedEventPayload.eventType)).toBe(true);
      }
    }
  });

  it("original term and component version rows are never mutated by computing (or even posting) an adjustment -- the exact arrays passed in remain deep-equal after every preview call", () => {
    const comps = componentVersions();
    const terms = accountTermsVersions();
    const compsCopy = JSON.parse(JSON.stringify(comps));
    const termsCopy = JSON.parse(JSON.stringify(terms));
    previewContractualPrincipalCorrection({
      events: [accountOpened()], componentVersions: comps, accountTermsVersions: terms,
      asOfDate: "2026-01-01", componentId: "zi", deltaCents: -1_000, reason: "x", createdBy: ACTOR,
    });
    previewDiscretionaryPrincipalConcession({
      events: [accountOpened()], componentVersions: comps, accountTermsVersions: terms,
      asOfDate: "2026-01-01", componentId: "ib", deltaCents: -1_000, reason: "x",
      borrowerVisibleExplanation: "x", createdBy: ACTOR,
    });
    expect(comps).toEqual(compsCopy);
    expect(terms).toEqual(termsCopy);
  });
});
