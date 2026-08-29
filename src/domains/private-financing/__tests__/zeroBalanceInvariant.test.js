import { describe, expect, it } from "vitest";
import {
  validatePrivateFinancingEvent,
  PRIVATE_FINANCING_EVENT_TYPE,
  PRIVATE_FINANCING_EVENT_ORIGIN,
  PRIVATE_FINANCING_COMPONENT_TYPE,
  CORRECTION_BASIS,
} from "../privateFinancingContracts.js";
import { assertBalanceAfterMatchesDelta, LedgerIntegrityViolationError } from "../ledgerIntegrity.js";

// Regression tests for the corrected zero-balance invariant (owner clarification following Checkpoint B
// review). The prior Checkpoint B report described "payoff_concession is the only event allowed to zero
// a balance" -- inspection confirmed this was an imprecise description of the code, not an actual
// restriction: validateComponentBalanceSnapshot's requireBothZero flag only ADDS a requirement onto
// payoff_concession (it must reach exactly zero); it never withheld that ability from any other event
// type. Nothing here changes that validator's behavior -- these tests exist to pin it down explicitly so
// the corrected understanding never regresses back into an accidental restriction.
//
// Two required paths -- "a payment plus a payoff concession may jointly close the account" and "an
// overpayment must become an explicit unapplied amount, never disappear or go negative" -- are genuinely
// stateful (they require replaying more than one event against real prior balances) and are NOT
// re-tested here; they are covered in __tests__/replayEvents.test.js ("payment plus concession jointly
// close the account" and "overpayment produces an explicit, non-negative unappliedCents, never dropped").

function baseEvent(overrides = {}) {
  return {
    id: "evt_1",
    ownerId: "owner_1",
    accountId: "acct_1",
    eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER,
    createdBy: "11111111-1111-1111-1111-111111111111",
    effectiveDate: "2026-08-23",
    ledgerSequence: 1,
    recordedAt: "2026-08-23T12:00:00.000Z",
    ...overrides,
  };
}

describe("a normal cleared payment may pay the exact calculated payoff and reduce the account to exactly zero", () => {
  it("accepts a payment_posted event whose principalRemainingCentsAfter is exactly {0, 0}", () => {
    const result = validatePrivateFinancingEvent(
      baseEvent({
        eventType: PRIVATE_FINANCING_EVENT_TYPE.PAYMENT_POSTED,
        amountCents: 3_184_347,
        allocation: {
          interestPaidCents: 0,
          interestBearingPrincipalPaidCents: 2_184_347,
          zeroInterestPrincipalPaidCents: 1_000_000,
          unallocatedCents: 0,
        },
        principalRemainingCentsAfter: { interestBearing: 0, zeroInterest: 0 },
      }),
    );
    expect(result.principalRemainingCentsAfter).toEqual({ interestBearing: 0, zeroInterest: 0 });
  });
});

describe("a normal payment must never reduce principal or accrued interest below zero", () => {
  it("rejects a payment_posted event whose principalRemainingCentsAfter has a negative component", () => {
    expect(() =>
      validatePrivateFinancingEvent(
        baseEvent({
          eventType: PRIVATE_FINANCING_EVENT_TYPE.PAYMENT_POSTED,
          amountCents: 100,
          allocation: { interestPaidCents: 0, interestBearingPrincipalPaidCents: 100, zeroInterestPrincipalPaidCents: 0, unallocatedCents: 0 },
          principalRemainingCentsAfter: { interestBearing: -1, zeroInterest: 0 },
        }),
      ),
    ).toThrow(/non-negative integer/);
  });

  it("rejects a payment_reversal event whose principalRemainingCentsAfter has a negative component", () => {
    expect(() =>
      validatePrivateFinancingEvent(
        baseEvent({
          eventType: PRIVATE_FINANCING_EVENT_TYPE.PAYMENT_REVERSAL,
          reversesEventId: "evt_original",
          reason: "chargeback",
          amountCents: 100,
          allocation: { interestPaidCents: 0, interestBearingPrincipalPaidCents: 100, zeroInterestPrincipalPaidCents: 0, unallocatedCents: 0 },
          principalRemainingCentsAfter: { interestBearing: 0, zeroInterest: -1 },
        }),
      ),
    ).toThrow(/non-negative integer/);
  });
});

describe("a payoff concession may reduce a remaining legitimate balance to zero", () => {
  it("accepts a payoff_concession that forgives exactly the remaining balance on both components", () => {
    const result = validatePrivateFinancingEvent(
      baseEvent({
        eventType: PRIVATE_FINANCING_EVENT_TYPE.PAYOFF_CONCESSION,
        interestBearingDeltaCents: -5_000,
        zeroInterestDeltaCents: -1_200,
        principalRemainingCentsAfter: { interestBearing: 0, zeroInterest: 0 },
        reason: "Seller accepted less than the calculated payoff to close the account",
      }),
    );
    expect(result.principalRemainingCentsAfter).toEqual({ interestBearing: 0, zeroInterest: 0 });
  });
});

describe("account_closed records lifecycle status only -- it cannot manufacture a financial reduction", () => {
  it("account_closed's validated shape contains no monetary field of any kind", () => {
    const result = validatePrivateFinancingEvent(
      baseEvent({ eventType: PRIVATE_FINANCING_EVENT_TYPE.ACCOUNT_CLOSED, closureReason: "paid_in_full" }),
    );
    for (const forbiddenField of ["amountCents", "allocation", "deltaCents", "principalRemainingCentsAfter", "interestBearingDeltaCents", "zeroInterestDeltaCents"]) {
      expect(result).not.toHaveProperty(forbiddenField);
    }
  });
});

describe("interest/principal corrections may reach zero only when the delta exactly supports it", () => {
  it("accepts a principal_correction whose delta exactly zeroes the prior balance", () => {
    expect(() => assertBalanceAfterMatchesDelta(500, -500, 0, "principal_correction test")).not.toThrow();
  });

  it("rejects a claimed after-balance that the delta does not actually support", () => {
    expect(() => assertBalanceAfterMatchesDelta(500, -499, 0, "principal_correction test")).toThrow(
      /claimed after-balance .* does not match/,
    );
  });

  it("rejects a delta that would drive the balance negative, even if the caller claims a non-negative after-value", () => {
    expect(() => assertBalanceAfterMatchesDelta(500, -600, -100, "principal_correction test")).toThrow(/negative balance/);
  });

  it("throws LedgerIntegrityViolationError specifically", () => {
    expect(() => assertBalanceAfterMatchesDelta(0, -1, -1, "x")).toThrow(LedgerIntegrityViolationError);
  });

  it("a principal_correction event's own contract-level shape still requires a non-negative correctedComponentPrincipalRemainingCentsAfter", () => {
    const result = validatePrivateFinancingEvent(
      baseEvent({
        eventType: PRIVATE_FINANCING_EVENT_TYPE.PRINCIPAL_CORRECTION,
        componentType: PRIVATE_FINANCING_COMPONENT_TYPE.ZERO_INTEREST,
        correctionBasis: CORRECTION_BASIS.DISCRETIONARY_CONCESSION,
        deltaCents: -500,
        correctedComponentPrincipalRemainingCentsAfter: 0,
        reason: "Final zero-interest balance forgiven",
      }),
    );
    expect(result.correctedComponentPrincipalRemainingCentsAfter).toBe(0);
  });
});
