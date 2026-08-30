import { describe, expect, it } from "vitest";
import {
  ADJUSTMENT_ACTION_TYPES,
  HIGH_IMPACT_ACTION_TYPES,
  computeAdjustmentPreview,
  isKnownAdjustmentActionType,
} from "../adjustmentActionRegistry.js";
import { PRIVATE_FINANCING_EVENT_TYPE, PRIVATE_FINANCING_EVENT_ORIGIN } from "../privateFinancingContracts.js";

const ACTOR = "11111111-1111-1111-1111-111111111111";

function accountOpened() {
  return {
    id: "evt_open", ownerId: "owner_1", accountId: "acct_1", eventType: PRIVATE_FINANCING_EVENT_TYPE.ACCOUNT_OPENED,
    eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER, createdBy: ACTOR, effectiveDate: "2026-01-01",
    ledgerSequence: 1, recordedAt: "2026-01-01T00:00:00.000Z",
  };
}

function componentVersions() {
  return [
    { ownerId: "owner_1", id: "comp_ib", accountId: "acct_1", componentKey: "ib", label: "Interest-bearing note", originalPrincipalCents: 1_000_000, rateBps: 600, dayCountConvention: "actual_365", scheduledComponentAmountCents: 500_000, allocationPriority: 1, effectiveDate: "2026-01-01", versionNumber: 1 },
    { ownerId: "owner_1", id: "comp_zi", accountId: "acct_1", componentKey: "zi", label: "Zero-interest note", originalPrincipalCents: 200_000, rateBps: 0, dayCountConvention: "actual_365", scheduledComponentAmountCents: 200_000, allocationPriority: 2, effectiveDate: "2026-01-01", versionNumber: 1 },
  ];
}

function accountTermsVersions() {
  return [
    { ownerId: "owner_1", id: "terms_1", accountId: "acct_1", versionNumber: 1, paymentFrequency: "monthly", firstPaymentDueDate: "2026-02-01", regularScheduledPaymentAmountCents: 700_000, maturityDate: null, allocationPolicy: "scheduled_component_order", extraPaymentAllocationPolicy: "highest_rate_first_extra", prepaymentPolicy: "allowed_without_penalty_does_not_advance_due_date", dayCountConvention: "actual_365", effectiveDate: "2026-01-01", actingSellerId: "owner_1", amendmentReason: null },
  ];
}

describe("isKnownAdjustmentActionType", () => {
  it("recognizes every one of the nine registered action types", () => {
    for (const actionType of Object.values(ADJUSTMENT_ACTION_TYPES)) {
      expect(isKnownAdjustmentActionType(actionType)).toBe(true);
    }
  });

  it("rejects an unknown action type", () => {
    expect(isKnownAdjustmentActionType("not_a_real_action")).toBe(false);
    expect(isKnownAdjustmentActionType("")).toBe(false);
    expect(isKnownAdjustmentActionType(undefined)).toBe(false);
  });

  it("does not recognize external-payment recording or policy changes -- those stay SF-2E", () => {
    expect(isKnownAdjustmentActionType("external_manual_payment")).toBe(false);
    expect(isKnownAdjustmentActionType("payment_acceptance_policy_change")).toBe(false);
  });

  it("does not recognize a discounted payoff offer -- deferred per instruction", () => {
    expect(isKnownAdjustmentActionType("payoff_concession")).toBe(false);
    expect(isKnownAdjustmentActionType("payoff_offer")).toBe(false);
  });
});

describe("HIGH_IMPACT_ACTION_TYPES", () => {
  it("flags concessions, waivers, corrections-of-corrections, reversals, and closure as high-impact", () => {
    expect(HIGH_IMPACT_ACTION_TYPES.has(ADJUSTMENT_ACTION_TYPES.DISCRETIONARY_PRINCIPAL_CONCESSION)).toBe(true);
    expect(HIGH_IMPACT_ACTION_TYPES.has(ADJUSTMENT_ACTION_TYPES.PAYMENT_REVERSAL)).toBe(true);
    expect(HIGH_IMPACT_ACTION_TYPES.has(ADJUSTMENT_ACTION_TYPES.ACCOUNT_CLOSURE)).toBe(true);
  });

  it("does not flag the two purely contractual/administrative corrections as high-impact", () => {
    expect(HIGH_IMPACT_ACTION_TYPES.has(ADJUSTMENT_ACTION_TYPES.CONTRACTUAL_PRINCIPAL_CORRECTION)).toBe(false);
    expect(HIGH_IMPACT_ACTION_TYPES.has(ADJUSTMENT_ACTION_TYPES.INTEREST_CORRECTION)).toBe(false);
  });
});

describe("computeAdjustmentPreview", () => {
  it("dispatches to the correct pure preview function for a known action type", () => {
    const preview = computeAdjustmentPreview(ADJUSTMENT_ACTION_TYPES.CONTRACTUAL_PRINCIPAL_CORRECTION, {
      events: [accountOpened()], componentVersions: componentVersions(), accountTermsVersions: accountTermsVersions(), asOfDate: "2026-01-02",
      inputs: { componentId: "zi", deltaCents: -1_000, reason: "typo fix" },
      createdBy: ACTOR,
    });
    expect(preview.proposedEventPayload.eventType).toBe("principal_correction");
    expect(preview.proposedEventPayload.correctionBasis).toBe("contractual_administrative");
  });

  it("throws for an unknown action type -- fails closed, never silently no-ops", () => {
    expect(() =>
      computeAdjustmentPreview("not_a_real_action", { events: [accountOpened()], componentVersions: componentVersions(), accountTermsVersions: accountTermsVersions(), asOfDate: "2026-01-02", inputs: {}, createdBy: ACTOR }),
    ).toThrow(/Unknown adjustment action type/);
  });

  it("account_closure dispatches correctly with its own distinct input shape (closureReason, not reason/deltaCents)", () => {
    const preview = computeAdjustmentPreview(ADJUSTMENT_ACTION_TYPES.ACCOUNT_CLOSURE, {
      events: [accountOpened()], componentVersions: componentVersions(), accountTermsVersions: accountTermsVersions(), asOfDate: "2026-01-01", inputs: { closureReason: "written_off" }, createdBy: ACTOR,
    });
    expect(preview.proposedAdjustment.kind).toBe("account_closure");
  });
});
