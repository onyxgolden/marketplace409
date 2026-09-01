// Cross-event invariants for the Private Financing ledger -- checks that need more than one event's own
// shape (a single event's shape is privateFinancingContracts.js's job). Pure functions, no I/O, no DB:
// these are the exact rules a future SECURITY DEFINER RPC (SF-2, not built here) must enforce before ever
// appending a row, expressed here so they are testable in isolation from any database.

import { PRIVATE_FINANCING_EVENT_TYPE } from "./privateFinancingContracts.js";

export class LedgerIntegrityViolationError extends Error {
  constructor(reason) {
    super(reason);
    this.name = "LedgerIntegrityViolationError";
  }
}

function violate(reason) {
  throw new LedgerIntegrityViolationError(reason);
}

// A payment_reversal may only ever target a payment_posted event (real cash being undone -- a bounced
// payment, a chargeback, a refund). A compensating_correction may only ever target one of the non-cash
// adjustment event types (undoing an errant correction or concession). Keeping these disjoint means a
// reversal can never be pointed at the wrong kind of event by mistake.
const REVERSAL_TARGET_TYPES = Object.freeze({
  [PRIVATE_FINANCING_EVENT_TYPE.PAYMENT_REVERSAL]: new Set([PRIVATE_FINANCING_EVENT_TYPE.PAYMENT_POSTED]),
  [PRIVATE_FINANCING_EVENT_TYPE.COMPENSATING_CORRECTION]: new Set([
    PRIVATE_FINANCING_EVENT_TYPE.PRINCIPAL_CORRECTION,
    PRIVATE_FINANCING_EVENT_TYPE.INTEREST_CORRECTION,
    PRIVATE_FINANCING_EVENT_TYPE.PAYOFF_CONCESSION,
  ]),
});

// Validates that `reversal` legitimately reverses `target`, given `priorEvents` (the full prior event
// history for the account, NOT including `reversal` itself). Throws LedgerIntegrityViolationError on any
// violation; returns nothing on success. The caller is expected to have already run
// validatePrivateFinancingEvent on both events individually.
export function validateReversalReference(reversal, target, priorEvents) {
  const allowedTargetTypes = REVERSAL_TARGET_TYPES[reversal.eventType];
  if (!allowedTargetTypes) {
    violate(`"${reversal.eventType}" is not a reversal-type event and cannot carry a reversesEventId.`);
  }
  if (!target) {
    violate(`reversesEventId "${reversal.reversesEventId}" does not reference an existing event.`);
  }
  if (target.id !== reversal.reversesEventId) {
    violate("target event id does not match reversal.reversesEventId.");
  }
  if (!allowedTargetTypes.has(target.eventType)) {
    violate(`a ${reversal.eventType} cannot reverse a ${target.eventType} event.`);
  }
  // References must never cross owner, workspace, borrower, or financing-account boundaries.
  if (target.ownerId !== reversal.ownerId) {
    violate("a reversal cannot cross owner boundaries: the target event belongs to a different owner.");
  }
  if (target.accountId !== reversal.accountId) {
    violate("a reversal cannot cross financing-account boundaries: the target event belongs to a different account.");
  }
  // A reversal can never predate the event it reverses -- you cannot undo something before it happened.
  if (reversal.effectiveDate < target.effectiveDate) {
    violate("a reversal's effectiveDate cannot be earlier than the effectiveDate of the event it reverses.");
  }
  // Prevent reversing the same event twice.
  const alreadyReversed = priorEvents.some((event) => event.reversesEventId === target.id);
  if (alreadyReversed) {
    violate(`event "${target.id}" has already been reversed and cannot be reversed again.`);
  }
}

// A correction's claimed "after" balance is only trustworthy if it is EXACTLY priorBalanceCents +
// deltaCents -- and the result must never be negative. privateFinancingContracts.js cannot check this on
// its own (it only sees one event, never the account's prior state); this is the cross-event check that
// closes the gap, used by both replayEvents.js (recomputing history) and, later, the SF-2 write-path RPC
// (validating a proposed correction before ever appending it). This is also what makes "a correction may
// reach zero only when its delta exactly supports that result" a real, enforced rule rather than a
// convention: priorBalanceCents=500, deltaCents=-500 passes (reaches exactly 0); deltaCents=-501 is
// rejected here for producing a negative balance, and deltaCents=-499 would simply produce a nonzero
// claimedAfterCents mismatch if a caller tried to claim it reached 0 anyway.
export function assertBalanceAfterMatchesDelta(priorBalanceCents, deltaCents, claimedAfterCents, label) {
  const expectedAfterCents = priorBalanceCents + deltaCents;
  if (expectedAfterCents < 0) {
    violate(`${label}: applying deltaCents (${deltaCents}) to the prior balance (${priorBalanceCents}) would create a negative balance.`);
  }
  if (expectedAfterCents !== claimedAfterCents) {
    violate(
      `${label}: claimed after-balance (${claimedAfterCents}) does not match priorBalanceCents + deltaCents (${expectedAfterCents}) -- ` +
        "a correction's stored after-balance must be exactly supported by its own delta.",
    );
  }
}

// Duplicate financial events must fail closed. idempotencyKey is required for manual_import/system_import
// origins (enforced in privateFinancingContracts.js); this checks the candidate against every prior event
// on the SAME account only -- never across accounts or owners, since the same import batch could
// legitimately be replayed against a different account without collision. This is a distinct concept from
// payment_webhook_events (Stripe provider-event dedup, SF-0 Decision 5) -- that table gates whether a
// webhook is processed at all; this function gates whether a manual/system-imported ledger event is a
// duplicate of one already posted to this account's ledger.
export function assertIdempotencyKeyIsUnique(candidate, priorEventsForSameAccount) {
  if (candidate.idempotencyKey == null) return;
  const collision = priorEventsForSameAccount.find((event) => event.idempotencyKey === candidate.idempotencyKey);
  if (collision) {
    violate(
      `idempotencyKey "${candidate.idempotencyKey}" was already used by event "${collision.id}" on this account -- duplicate submission rejected.`,
    );
  }
}

// Payment lifecycle separation: a payment attempt only ever becomes a posted payment_posted ledger event
// once it has genuinely, finally succeeded. initiated/pending/failed/canceled/refunded/disputed attempts
// must never create or mutate a ledger event -- a refund or dispute against an ALREADY-POSTED payment is
// handled by a separate payment_reversal event referencing the original, never by un-posting or editing
// it. This defines the boundary a future Stripe-aware caller (SF-2 scope) must enforce before ever
// constructing a payment_posted event -- it does not implement Stripe itself.
export const PAYMENT_ATTEMPT_STATUS = Object.freeze({
  INITIATED: "initiated",
  PENDING: "pending",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  CANCELED: "canceled",
  REFUNDED: "refunded",
  DISPUTED: "disputed",
});

const POSTABLE_PAYMENT_ATTEMPT_STATUSES = new Set([PAYMENT_ATTEMPT_STATUS.SUCCEEDED]);

export function assertPaymentAttemptIsPostable(status) {
  if (!Object.values(PAYMENT_ATTEMPT_STATUS).includes(status)) {
    violate(`Unknown payment attempt status "${status}".`);
  }
  if (!POSTABLE_PAYMENT_ATTEMPT_STATUSES.has(status)) {
    violate(
      `Payment attempt status "${status}" cannot create a posted ledger event -- only ${[...POSTABLE_PAYMENT_ATTEMPT_STATUSES].join(", ")} may. ` +
        "A refund or dispute against an already-posted payment must be recorded as a separate payment_reversal event, never by un-posting this attempt.",
    );
  }
}
