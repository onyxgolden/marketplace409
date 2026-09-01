// A discounted payoff offer is modeled entirely separately from ledger history -- it is a standalone,
// stateful entity with its own lifecycle (pending -> accepted/expired/withdrawn/cancelled -> paid), never
// itself a private_financing_events row and never itself capable of moving money. Creating or accepting
// an offer never changes a loan balance -- only a qualifying cleared payment PLUS the compensating
// payoff_concession event (posted later, separately, once funds actually clear) produce a real financial
// effect. This file only models the offer and its allowed state transitions.

export const PAYOFF_OFFER_STATUS = Object.freeze({
  PENDING: "pending",
  ACCEPTED: "accepted",
  EXPIRED: "expired",
  WITHDRAWN: "withdrawn",
  PAID: "paid",
  CANCELLED: "cancelled",
});

export class MalformedPayoffOfferError extends Error {
  constructor(reason) {
    super(`Malformed PayoffOffer: ${reason}`);
    this.name = "MalformedPayoffOfferError";
    this.reason = reason;
  }
}

function fail(reason) {
  throw new MalformedPayoffOfferError(reason);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Terminal states accept no further transition -- once paid, expired, withdrawn, or cancelled, an offer
// is done; a NEW offer (and a new quote) is required for any further attempt, never a mutation back to
// pending. accepted allows a later cancellation (e.g. funds ultimately never cleared) in addition to paid.
const ALLOWED_TRANSITIONS = Object.freeze({
  [PAYOFF_OFFER_STATUS.PENDING]: new Set([PAYOFF_OFFER_STATUS.ACCEPTED, PAYOFF_OFFER_STATUS.EXPIRED, PAYOFF_OFFER_STATUS.WITHDRAWN, PAYOFF_OFFER_STATUS.CANCELLED]),
  [PAYOFF_OFFER_STATUS.ACCEPTED]: new Set([PAYOFF_OFFER_STATUS.PAID, PAYOFF_OFFER_STATUS.CANCELLED]),
  [PAYOFF_OFFER_STATUS.EXPIRED]: new Set(),
  [PAYOFF_OFFER_STATUS.WITHDRAWN]: new Set(),
  [PAYOFF_OFFER_STATUS.PAID]: new Set(),
  [PAYOFF_OFFER_STATUS.CANCELLED]: new Set(),
});

export function assertValidPayoffOfferTransition(fromStatus, toStatus) {
  const allowed = ALLOWED_TRANSITIONS[fromStatus];
  if (!allowed) fail(`unknown status "${fromStatus}"`);
  if (!allowed.has(toStatus)) fail(`cannot transition a payoff offer from "${fromStatus}" to "${toStatus}"`);
}

// quoteSnapshot freezes the exact financial terms of the quote this offer is built on, at the moment the
// offer is created -- this IS the "immutable link to the quote/terms accepted": even if a live quote
// object elsewhere is later recalculated, this snapshot can never drift, because nothing here ever
// re-reads the original quote.
function validateQuoteSnapshot(snapshot) {
  if (!isPlainObject(snapshot)) fail("quoteSnapshot must be an object");
  for (const field of ["calculatedPayoffCents", "offeredPayoffCents", "sellerConcessionCents", "accruedInterestCents"]) {
    if (!Number.isInteger(snapshot[field]) || snapshot[field] < 0) fail(`quoteSnapshot.${field} must be a non-negative integer`);
  }
  // V1 Terms Generalization: principal is a {[componentId]: cents} map now (one or more components),
  // never two fixed named fields.
  if (!isPlainObject(snapshot.principalByComponentCents)) fail("quoteSnapshot.principalByComponentCents must be an object keyed by componentId");
  for (const [componentId, cents] of Object.entries(snapshot.principalByComponentCents)) {
    if (!Number.isInteger(cents) || cents < 0) fail(`quoteSnapshot.principalByComponentCents.${componentId} must be a non-negative integer`);
  }
  if (!isNonEmptyString(snapshot.calculatedThroughDate)) fail("quoteSnapshot.calculatedThroughDate must be a non-empty string");
  return Object.freeze({ ...snapshot, principalByComponentCents: Object.freeze({ ...snapshot.principalByComponentCents }) });
}

export function validatePayoffOffer(offer) {
  if (!isPlainObject(offer)) fail("must be an object");
  if (!isNonEmptyString(offer.id)) fail("id must be a non-empty string");
  if (!isNonEmptyString(offer.ownerId)) fail("ownerId must be a non-empty string");
  if (!isNonEmptyString(offer.accountId)) fail("accountId must be a non-empty string");
  if (!isNonEmptyString(offer.quoteId)) fail("quoteId must be a non-empty string");
  const quoteSnapshot = validateQuoteSnapshot(offer.quoteSnapshot);
  if (!Object.values(PAYOFF_OFFER_STATUS).includes(offer.status)) {
    fail(`status must be one of ${Object.values(PAYOFF_OFFER_STATUS).join(", ")}`);
  }
  if (!isNonEmptyString(offer.issuedAt)) fail("issuedAt must be a non-empty string");
  if (!isNonEmptyString(offer.expiresAt) || offer.expiresAt <= offer.issuedAt) fail("expiresAt must be a non-empty string strictly after issuedAt");
  // The human who authorized this offer on the seller's behalf -- an offer was never "made" by the
  // system itself; someone with authority to grant a concession approved it.
  if (!isNonEmptyString(offer.sellerActingUserId)) fail("sellerActingUserId must be a non-empty string");

  if (offer.status === PAYOFF_OFFER_STATUS.ACCEPTED || offer.status === PAYOFF_OFFER_STATUS.PAID) {
    if (!isPlainObject(offer.borrowerAcceptanceEvidence)) {
      fail("borrowerAcceptanceEvidence is required once status is accepted or paid");
    }
    if (!isNonEmptyString(offer.borrowerAcceptanceEvidence.acceptedAt) || !isNonEmptyString(offer.borrowerAcceptanceEvidence.method)) {
      fail("borrowerAcceptanceEvidence must include acceptedAt and method");
    }
  } else if (offer.borrowerAcceptanceEvidence != null) {
    fail("borrowerAcceptanceEvidence must be null before the offer has been accepted");
  }

  if (!isNonEmptyString(offer.createdAt)) fail("createdAt must be a non-empty string");

  return Object.freeze({
    id: offer.id,
    ownerId: offer.ownerId,
    accountId: offer.accountId,
    quoteId: offer.quoteId,
    quoteSnapshot,
    status: offer.status,
    issuedAt: offer.issuedAt,
    expiresAt: offer.expiresAt,
    sellerActingUserId: offer.sellerActingUserId,
    borrowerAcceptanceEvidence: offer.borrowerAcceptanceEvidence ? Object.freeze({ ...offer.borrowerAcceptanceEvidence }) : null,
    createdAt: offer.createdAt,
  });
}

// Convenience constructor: builds the initial PENDING offer directly from a computePayoffQuote() result,
// snapshotting exactly the fields that matter financially. Still pure -- no event, no mutation, no I/O.
export function buildPayoffOfferFromQuote(quote, { id, sellerActingUserId, issuedAt, expiresAt }) {
  return validatePayoffOffer({
    id,
    ownerId: quote.ownerId,
    accountId: quote.accountId,
    quoteId: quote.quoteId,
    quoteSnapshot: {
      calculatedPayoffCents: quote.calculatedPayoffCents,
      offeredPayoffCents: quote.offeredPayoffCents,
      sellerConcessionCents: quote.sellerConcessionCents,
      accruedInterestCents: quote.accruedInterestCents,
      principalByComponentCents: quote.principalByComponentCents,
      calculatedThroughDate: quote.calculatedThroughDate,
    },
    status: PAYOFF_OFFER_STATUS.PENDING,
    issuedAt,
    expiresAt,
    sellerActingUserId,
    borrowerAcceptanceEvidence: null,
    createdAt: issuedAt,
  });
}

export function isPayoffOfferExpired(offer, todayDate) {
  return todayDate > offer.expiresAt;
}
