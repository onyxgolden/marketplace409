// Versioned, runtime-validated contracts for the Private Financing immutable ledger (SF-1 Checkpoint B),
// mirroring the exact fail-closed pattern established in
// src/domains/guided-workflow/guidedWorkflowContracts.js: an unknown or malformed shape is rejected here,
// not passed through and discovered later as a runtime crash or, worse, a silently wrong ledger row.
//
// V1 TERMS GENERALIZATION (this revision): components are no longer two fixed named buckets
// (interest_bearing/zero_interest). Every account has an ORDERED COLLECTION of one or more financing
// components, each with its own stable componentId, seller-facing label, fixed rate (including zero), and
// scheduled amount. South Main happens to have two components; that is a fact about South Main's contract,
// never a structural limit the engine imposes. See financingTermsContracts.js for the versioned
// account-level schedule/allocation/prepayment terms this revision also introduces.
//
// EVENT TAXONOMY -- why 8 event types, not the 12 concepts originally listed:
//
// "payment received", "payment allocation", and "external/manual payment" collapse into ONE event type,
// PAYMENT_POSTED. In the compute-on-read architecture this repo already committed to (SF-0 Decision 2:
// no posted accrual events, allocation always derived deterministically), a payment's allocation is never
// a separate fact decided later -- it is always the same deterministic function of the payment amount and
// the account's state at that moment (paymentAllocation.js). Storing "payment received" and "payment
// allocation" as two events would let them drift apart with no way to tell which one is wrong. Likewise,
// "external/manual payment" is not a different FACT, only a different PROVENANCE of the same fact -- that
// distinction belongs on eventOrigin (see below), not on a duplicate event type.
//
// "seller credit" and "bring-current/reporting credit" collapse into PRINCIPAL_CORRECTION with
// correctionBasis: 'discretionary_concession'. Both are, mechanically, a non-cash reduction of a
// component's principal balance -- they differ only in WHY, which correctionBasis records explicitly
// (discretionary_concession vs contractual_administrative for an ordinary data/administrative fix).
// Two event types with an identical mechanical effect, differing only by a "why" that fits in one enum
// field, is exactly the kind of proliferation the owner asked to avoid where a smaller taxonomy is safer.
//
// "interest correction" and "waiver" collapse into INTEREST_CORRECTION with the same correctionBasis
// axis, for the same reason.
//
// "payment reversal" and "compensating correction" stay SEPARATE, deliberately, because they have
// different validation shapes: PAYMENT_REVERSAL always reverses a PAYMENT_POSTED event specifically (real
// cash arrived and is being undone -- a bounced payment, a chargeback), while COMPENSATING_CORRECTION
// reverses any of the non-cash adjustment events (undoing an errant PRINCIPAL_CORRECTION,
// INTEREST_CORRECTION, or PAYOFF_CONCESSION). Keeping them separate lets validateReversalReference (see
// ledgerIntegrity.js) enforce "a payment reversal can only target a payment" and "a compensating
// correction can only target a non-payment adjustment" as a real, testable rule instead of a convention.
//
// ACCOUNT_OPENED and ACCOUNT_CLOSED remain their own event types (genesis and terminal bookends of the
// ledger stream) exactly as originally proposed -- there was no safe merge available for either.
// ACCOUNT_OPENED no longer embeds openingComponents (this revision) -- components are a fully separate,
// externally versioned entity now (they always were real DB rows; this revision stops ALSO duplicating
// them inline inside the opening event).
//
// Final taxonomy: account_opened, payment_posted, payment_reversal, principal_correction,
// interest_correction, compensating_correction, payoff_concession, account_closed.

export const PRIVATE_FINANCING_SCHEMA_VERSION = "2.0";

export class MalformedPrivateFinancingContractError extends Error {
  constructor(contractName, reason) {
    super(`Malformed ${contractName}: ${reason}`);
    this.name = "MalformedPrivateFinancingContractError";
    this.contractName = contractName;
    this.reason = reason;
  }
}

function fail(contractName, reason) {
  throw new MalformedPrivateFinancingContractError(contractName, reason);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Date-only ISO strings (YYYY-MM-DD) are used everywhere effectiveDate/openedDate appear, deliberately --
// they compare correctly with plain string `<`/`>` (see ledgerOrdering.js) and Date.parse of this exact
// format is defined by spec to be UTC and locale-independent, unlike parsing "MM/DD/YYYY" or any other
// non-ISO format. This is part of what makes replay runtime- and locale-independent (Checkpoint B
// calculation invariant #5 -- see __tests__/calculationInvariants.test.js).
export function isValidISODateOnly(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

export const PRIVATE_FINANCING_EVENT_ORIGIN = Object.freeze({
  INTERACTIVE_USER: "interactive_user",
  STRIPE_WEBHOOK: "stripe_webhook",
  SYSTEM_IMPORT: "system_import",
  MANUAL_IMPORT: "manual_import",
  // A seller-confirmed record of a payment actually received through an off-platform channel (Venmo,
  // Cash App, Zelle, PayPal, bank transfer, cash, check, money order) -- deliberately distinct from
  // MANUAL_IMPORT: manual_import reconstructs historical records (e.g. South Main's 48-payment
  // backfill); manual_external records a NEWLY received payment going forward. Keeping them separate
  // improves auditing and duplicate detection -- a bulk historical import and a single new external
  // receipt are different real-world events even though both are "manually" entered by a human.
  MANUAL_EXTERNAL: "manual_external",
});

export const PRIVATE_FINANCING_EVENT_TYPE = Object.freeze({
  ACCOUNT_OPENED: "account_opened",
  PAYMENT_POSTED: "payment_posted",
  PAYMENT_REVERSAL: "payment_reversal",
  PRINCIPAL_CORRECTION: "principal_correction",
  INTEREST_CORRECTION: "interest_correction",
  COMPENSATING_CORRECTION: "compensating_correction",
  PAYOFF_CONCESSION: "payoff_concession",
  ACCOUNT_CLOSED: "account_closed",
});

// Distinguishes an ordinary administrative/contractual fix (a data-entry error, a misapplied historical
// entry) from a discretionary concession the seller chose to grant (goodwill, a bring-current credit, a
// reporting accommodation, an interest waiver). Never inferred -- always explicitly recorded.
export const CORRECTION_BASIS = Object.freeze({
  DISCRETIONARY_CONCESSION: "discretionary_concession",
  CONTRACTUAL_ADMINISTRATIVE: "contractual_administrative",
});

export const ACCOUNT_CLOSURE_REASON = Object.freeze({
  PAID_IN_FULL: "paid_in_full",
  PAYOFF_CONCESSION_APPLIED: "payoff_concession_applied",
  WRITTEN_OFF: "written_off",
  CANCELLED: "cancelled",
});

// -- V1 TERMS GENERALIZATION: closed support envelope -----------------------------------------------------
// Every enum below is deliberately closed to exactly what V1 can calculate correctly and has tests for.
// The schema may reserve additional values in a future migration; the ENGINE must reject (fail closed) any
// value it does not recognize here, never silently guess at unsupported behavior. See the governance
// handoff's "V1 supported-term matrix" for the full deferred list (variable rates, compounding, negative
// amortization, escrow, interest-only periods, graduated payments, legally calculated late fees,
// prepayment penalties, revolving credit, automatic balloon refinancing, credit reporting, document
// generation).

export const PRIVATE_FINANCING_DAY_COUNT_CONVENTION = Object.freeze({
  ACTUAL_365: "actual_365",
});

export const PRIVATE_FINANCING_PAYMENT_FREQUENCY = Object.freeze({
  MONTHLY: "monthly",
});

// A single V1 value, expressed as a stored enum (not a hard-coded assumption) so a future, fully-tested
// alternative can be added additively later without a schema change. Governs the REQUIRED phase only
// (accrued interest per component, then each component's own scheduledComponentAmountCents, in
// allocationPriority order) -- what happens to payment amount ABOVE that combined required total is a
// separate axis, extraPaymentAllocationPolicy, below.
export const PRIVATE_FINANCING_ALLOCATION_POLICY = Object.freeze({
  SCHEDULED_COMPONENT_ORDER: "scheduled_component_order",
});

// Real contracts vary in what happens to an EXTRA (above-required) payment amount, not in how required
// interest/principal gets allocated -- this is the axis section 3 of the terms-generalization checkpoint
// asks to make explicit and closed, rather than one hidden universal rule. South Main's own historical
// behavior ("anything above the combined regular payment reduces the interest-bearing component's
// principal, so interest stops accruing sooner") is expressed as HIGHEST_RATE_FIRST_EXTRA -- South Main's
// only rate>0 component trivially IS the highest-rate component, so this is ordinary configuration, not a
// special code branch.
export const PRIVATE_FINANCING_EXTRA_PAYMENT_ALLOCATION_POLICY = Object.freeze({
  HIGHEST_RATE_FIRST_EXTRA: "highest_rate_first_extra",
  PROPORTIONAL_EXTRA: "proportional_extra",
  SELECTED_COMPONENT_EXTRA: "selected_component_extra",
});

// Distinguishes at least these three; penalties are NOT implemented in V1 (an "unsupported" account simply
// cannot post extra/prepayment amounts under an automatically-calculated due-state assumption -- the due-
// state engine fails closed for that account rather than guessing). The due-date effect must be explicit,
// never assumed: extra principal does not automatically satisfy the next scheduled installment unless the
// policy says so.
export const PRIVATE_FINANCING_PREPAYMENT_POLICY = Object.freeze({
  ALLOWED_WITHOUT_PENALTY_DOES_NOT_ADVANCE_DUE_DATE: "allowed_without_penalty_does_not_advance_due_date",
  ALLOWED_WITHOUT_PENALTY_ADVANCES_DUE_DATE: "allowed_without_penalty_advances_due_date",
  UNSUPPORTED: "unsupported",
});

const REVERSAL_EVENT_TYPES = new Set([
  PRIVATE_FINANCING_EVENT_TYPE.PAYMENT_REVERSAL,
  PRIVATE_FINANCING_EVENT_TYPE.COMPENSATING_CORRECTION,
]);

const REASON_REQUIRED_EVENT_TYPES = new Set([
  PRIVATE_FINANCING_EVENT_TYPE.PAYMENT_REVERSAL,
  PRIVATE_FINANCING_EVENT_TYPE.PRINCIPAL_CORRECTION,
  PRIVATE_FINANCING_EVENT_TYPE.INTEREST_CORRECTION,
  PRIVATE_FINANCING_EVENT_TYPE.COMPENSATING_CORRECTION,
  PRIVATE_FINANCING_EVENT_TYPE.PAYOFF_CONCESSION,
]);

// A generic {[componentId]: cents} map -- the shape every per-component monetary field now uses instead of
// two fixed named keys. `allowNegative` supports payoff_concession's deltas (each entry <= 0);
// `requireAllZero` supports payoff_concession's principalRemainingByComponentCents (every entry must land
// at exactly 0 -- the entire point of that event).
function validateComponentCentsMap(map, contractName, fieldLabel, { allowNegative = false, requireAllZero = false } = {}) {
  if (!isPlainObject(map)) fail(contractName, `${fieldLabel} must be an object keyed by componentId`);
  const keys = Object.keys(map);
  if (keys.length === 0) fail(contractName, `${fieldLabel} must have at least one componentId entry`);
  const result = {};
  for (const key of keys) {
    if (!isNonEmptyString(key)) fail(contractName, `${fieldLabel} keys must be non-empty componentId strings`);
    const value = map[key];
    if (!Number.isInteger(value)) fail(contractName, `${fieldLabel}.${key} must be an integer number of cents`);
    if (requireAllZero) {
      if (value !== 0) fail(contractName, `${fieldLabel}.${key} must be exactly 0`);
    } else if (allowNegative) {
      if (value > 0) fail(contractName, `${fieldLabel}.${key} must be zero or negative`);
    } else if (value < 0) {
      fail(contractName, `${fieldLabel}.${key} must be a non-negative integer number of cents`);
    }
    result[key] = value;
  }
  return Object.freeze(result);
}

function sumComponentCentsMap(map) {
  return Object.values(map).reduce((sum, value) => sum + Math.abs(value), 0);
}

// Interest/principal-paid maps are allowed to be EMPTY objects, unlike every other component-cents map,
// because a component that received nothing this payment simply has no entry -- only unallocatedCents
// plus at least one component receiving something overall is required, enforced by the sum check below.
function validateComponentCentsMapAllowEmpty(map, contractName, fieldLabel) {
  if (!isPlainObject(map)) fail(contractName, `${fieldLabel} must be an object keyed by componentId`);
  const result = {};
  for (const key of Object.keys(map)) {
    if (!isNonEmptyString(key)) fail(contractName, `${fieldLabel} keys must be non-empty componentId strings`);
    const value = map[key];
    if (!Number.isInteger(value) || value < 0) fail(contractName, `${fieldLabel}.${key} must be a non-negative integer number of cents`);
    result[key] = value;
  }
  return Object.freeze(result);
}

function validateAllocationShape(allocation, amountCents, contractName) {
  const interestPaidByComponentCents = validateComponentCentsMapAllowEmpty(
    allocation.interestPaidByComponentCents ?? {},
    contractName,
    "allocation.interestPaidByComponentCents",
  );
  const principalPaidByComponentCents = validateComponentCentsMapAllowEmpty(
    allocation.principalPaidByComponentCents ?? {},
    contractName,
    "allocation.principalPaidByComponentCents",
  );
  if (!Number.isInteger(allocation.unallocatedCents) || allocation.unallocatedCents < 0) {
    fail(contractName, "allocation.unallocatedCents must be a non-negative integer number of cents");
  }
  const sum = sumComponentCentsMap(interestPaidByComponentCents) + sumComponentCentsMap(principalPaidByComponentCents) + allocation.unallocatedCents;
  if (sum !== amountCents) {
    fail(contractName, `allocation fields must sum exactly to amountCents (${amountCents}), got ${sum} -- no event may manufacture or lose money`);
  }
  return Object.freeze({ interestPaidByComponentCents, principalPaidByComponentCents, unallocatedCents: allocation.unallocatedCents });
}

// requireAllZero is ADDITIVE, not exclusive: it puts an extra REQUIREMENT on payoff_concession (every
// component must land at exactly 0 -- that's the entire point of the event), it does not take away any
// OTHER event type's ability to also reach all-zero on its own terms.
function validatePrincipalRemainingByComponent(snapshot, contractName, { requireAllZero = false } = {}) {
  return validateComponentCentsMap(snapshot, contractName, "principalRemainingByComponentCents", { requireAllZero });
}

function validateAccountOpenedFields() {
  // account_opened is now a pure lifecycle/genesis marker -- it carries no terms of its own. Components
  // and account terms are separate, externally versioned entities (see financingTermsContracts.js and the
  // v1_terms_generalization migration); replayEvents.js resolves them by effective date, never from a
  // payload embedded in this event.
  return {};
}

function validatePaymentPostedFields(event, contractName) {
  if (!Number.isInteger(event.amountCents) || event.amountCents <= 0) {
    fail(contractName, "payment_posted requires a positive integer amountCents");
  }
  if (event.selectedExtraComponentId !== undefined && event.selectedExtraComponentId !== null && !isNonEmptyString(event.selectedExtraComponentId)) {
    fail(contractName, "selectedExtraComponentId must be a non-empty string or null when present");
  }
  return {
    amountCents: event.amountCents,
    allocation: validateAllocationShape(event.allocation, event.amountCents, contractName),
    principalRemainingByComponentCents: validatePrincipalRemainingByComponent(event.principalRemainingByComponentCents, contractName),
    selectedExtraComponentId: event.selectedExtraComponentId ?? null,
  };
}

function validatePaymentReversalFields(event, contractName) {
  if (!Number.isInteger(event.amountCents) || event.amountCents <= 0) {
    fail(contractName, "payment_reversal requires a positive integer amountCents");
  }
  return {
    amountCents: event.amountCents,
    allocation: validateAllocationShape(event.allocation, event.amountCents, contractName),
    principalRemainingByComponentCents: validatePrincipalRemainingByComponent(event.principalRemainingByComponentCents, contractName),
  };
}

function validatePrincipalCorrectionFields(event, contractName) {
  if (!isNonEmptyString(event.componentId)) fail(contractName, "principal_correction requires a non-empty componentId");
  if (!Object.values(CORRECTION_BASIS).includes(event.correctionBasis)) {
    fail(contractName, `principal_correction requires correctionBasis to be one of ${Object.values(CORRECTION_BASIS).join(", ")}`);
  }
  if (!Number.isInteger(event.deltaCents) || event.deltaCents === 0) {
    fail(contractName, "principal_correction requires a non-zero integer deltaCents");
  }
  if (!Number.isInteger(event.correctedComponentPrincipalRemainingCentsAfter) || event.correctedComponentPrincipalRemainingCentsAfter < 0) {
    fail(contractName, "principal_correction requires a non-negative integer correctedComponentPrincipalRemainingCentsAfter");
  }
  return {
    componentId: event.componentId,
    correctionBasis: event.correctionBasis,
    deltaCents: event.deltaCents,
    correctedComponentPrincipalRemainingCentsAfter: event.correctedComponentPrincipalRemainingCentsAfter,
  };
}

function validateInterestCorrectionFields(event, contractName) {
  // Interest now accrues independently per component (each may carry its own rate) -- a correction must
  // name WHICH component's accrued-interest bucket it adjusts, unlike the single-bucket South-Main-shaped
  // model this replaces.
  if (!isNonEmptyString(event.componentId)) fail(contractName, "interest_correction requires a non-empty componentId");
  if (!Object.values(CORRECTION_BASIS).includes(event.correctionBasis)) {
    fail(contractName, `interest_correction requires correctionBasis to be one of ${Object.values(CORRECTION_BASIS).join(", ")}`);
  }
  if (!Number.isInteger(event.deltaCents) || event.deltaCents === 0) {
    fail(contractName, "interest_correction requires a non-zero integer deltaCents");
  }
  return { componentId: event.componentId, correctionBasis: event.correctionBasis, deltaCents: event.deltaCents };
}

function validateCompensatingCorrectionFields(event, contractName) {
  if (!Number.isInteger(event.deltaCents) || event.deltaCents === 0) {
    fail(contractName, "compensating_correction requires a non-zero integer deltaCents");
  }
  if (event.componentId != null && !isNonEmptyString(event.componentId)) {
    fail(contractName, "compensating_correction.componentId must be null or a non-empty string");
  }
  return { deltaCents: event.deltaCents, componentId: event.componentId ?? null };
}

function validatePayoffConcessionFields(event, contractName) {
  const deltaCentsByComponent = validateComponentCentsMap(event.deltaCentsByComponentCents, contractName, "deltaCentsByComponentCents", { allowNegative: true });
  if (Object.values(deltaCentsByComponent).every((value) => value === 0)) {
    fail(contractName, "payoff_concession must forgive a non-zero amount on at least one component");
  }
  return {
    deltaCentsByComponentCents: deltaCentsByComponent,
    principalRemainingByComponentCents: validatePrincipalRemainingByComponent(event.principalRemainingByComponentCents, contractName, { requireAllZero: true }),
  };
}

// account_closed carries no monetary field at all (no amountCents, no allocation, no deltaCents, no
// principalRemainingByComponentCents) -- structurally, by omission, it cannot manufacture a financial
// reduction. It only ever records a lifecycle fact (that replay had already independently produced a
// zero balance by the time this event was posted); replayEvents.js re-verifies that independently rather
// than trusting the event's mere presence (see replayEvents.js's ACCOUNT_CLOSED case).
function validateAccountClosedFields(event, contractName) {
  if (!Object.values(ACCOUNT_CLOSURE_REASON).includes(event.closureReason)) {
    fail(contractName, `account_closed requires closureReason to be one of ${Object.values(ACCOUNT_CLOSURE_REASON).join(", ")}`);
  }
  if (event.closureReason === ACCOUNT_CLOSURE_REASON.PAYOFF_CONCESSION_APPLIED) {
    if (!isNonEmptyString(event.payoffConcessionEventId)) {
      fail(contractName, "account_closed requires payoffConcessionEventId when closureReason is payoff_concession_applied");
    }
  } else if (event.payoffConcessionEventId != null) {
    fail(contractName, "payoffConcessionEventId must be null unless closureReason is payoff_concession_applied");
  }
  return { closureReason: event.closureReason, payoffConcessionEventId: event.payoffConcessionEventId ?? null };
}

const EVENT_TYPE_FIELD_VALIDATORS = {
  [PRIVATE_FINANCING_EVENT_TYPE.ACCOUNT_OPENED]: validateAccountOpenedFields,
  [PRIVATE_FINANCING_EVENT_TYPE.PAYMENT_POSTED]: validatePaymentPostedFields,
  [PRIVATE_FINANCING_EVENT_TYPE.PAYMENT_REVERSAL]: validatePaymentReversalFields,
  [PRIVATE_FINANCING_EVENT_TYPE.PRINCIPAL_CORRECTION]: validatePrincipalCorrectionFields,
  [PRIVATE_FINANCING_EVENT_TYPE.INTEREST_CORRECTION]: validateInterestCorrectionFields,
  [PRIVATE_FINANCING_EVENT_TYPE.COMPENSATING_CORRECTION]: validateCompensatingCorrectionFields,
  [PRIVATE_FINANCING_EVENT_TYPE.PAYOFF_CONCESSION]: validatePayoffConcessionFields,
  [PRIVATE_FINANCING_EVENT_TYPE.ACCOUNT_CLOSED]: validateAccountClosedFields,
};

// The single entry point for validating a private_financing_events row (or the JS object about to become
// one). Enforces the full attribution model from the SF-1 plan (Decision 3), the immutability boundary
// (no updatedBy/updatedAt), and every event type's own required fields -- returning a frozen, whitelisted
// object on success. Cross-event invariants (reversal targeting, idempotency, ordering) are NOT this
// function's job -- see ledgerIntegrity.js and ledgerOrdering.js, which need more than one event's shape.
// Component EXISTENCE (does this componentId actually belong to this account as of this date) is also not
// this function's job -- shape validation has no access to the account's component list; that check
// happens in replayEvents.js, which does.
export function validatePrivateFinancingEvent(event) {
  const contractName = "PrivateFinancingEvent";
  if (!isPlainObject(event)) fail(contractName, "must be an object");

  // private_financing_events carries no updated_by/updated_at semantics -- it is never updated. Accepting
  // these fields and silently dropping them would let a caller believe the event can be mutated when it
  // structurally cannot; reject instead of ignoring.
  if (event.updatedBy !== undefined || event.updatedAt !== undefined) {
    fail(contractName, "private_financing_events is immutable -- do not set updatedBy/updatedAt on an event");
  }

  if (!isNonEmptyString(event.id)) fail(contractName, "id must be a non-empty string");
  if (!isNonEmptyString(event.ownerId)) fail(contractName, "ownerId must be a non-empty string");
  if (!isNonEmptyString(event.accountId)) fail(contractName, "accountId must be a non-empty string");
  if (!Object.values(PRIVATE_FINANCING_EVENT_TYPE).includes(event.eventType)) {
    fail(contractName, `eventType must be one of ${Object.values(PRIVATE_FINANCING_EVENT_TYPE).join(", ")}`);
  }
  if (!Object.values(PRIVATE_FINANCING_EVENT_ORIGIN).includes(event.eventOrigin)) {
    fail(contractName, `eventOrigin must be one of ${Object.values(PRIVATE_FINANCING_EVENT_ORIGIN).join(", ")}`);
  }

  // Truthful attribution (SF-1 plan, Decision 3): interactive events record the real authenticated human;
  // every other origin must never impersonate one -- real or fabricated.
  // manual_external is genuinely a real, authenticated, interactive seller action ("Seller verifies the
  // money arrived... Seller explicitly posts it") -- unlike manual_import (a bulk historical
  // reconstruction, where no single human "did" any one row) -- so it requires createdBy exactly like
  // interactive_user does. It ALSO requires an idempotencyKey/sourceReference, unlike interactive_user,
  // because recording something that happened elsewhere (a Venmo/Cash App/Zelle transfer) is genuinely
  // prone to accidental re-entry in a way a single live UI form submission is not. It is the one origin
  // that is both attributable to a human AND duplicate-protected.
  if (
    event.eventOrigin === PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER ||
    event.eventOrigin === PRIVATE_FINANCING_EVENT_ORIGIN.MANUAL_EXTERNAL
  ) {
    if (!isNonEmptyString(event.createdBy)) fail(contractName, `createdBy is required when eventOrigin is ${event.eventOrigin}`);
  } else if (event.createdBy != null) {
    fail(contractName, "createdBy must be null for this eventOrigin -- a webhook or system event was not performed by a human");
  }

  if (
    (event.eventOrigin === PRIVATE_FINANCING_EVENT_ORIGIN.STRIPE_WEBHOOK || event.eventOrigin === PRIVATE_FINANCING_EVENT_ORIGIN.MANUAL_EXTERNAL) &&
    !isNonEmptyString(event.sourceReference)
  ) {
    fail(contractName, `sourceReference is required when eventOrigin is ${event.eventOrigin} (the external transaction/reference number)`);
  }
  if (
    [
      PRIVATE_FINANCING_EVENT_ORIGIN.MANUAL_IMPORT,
      PRIVATE_FINANCING_EVENT_ORIGIN.SYSTEM_IMPORT,
      PRIVATE_FINANCING_EVENT_ORIGIN.MANUAL_EXTERNAL,
    ].includes(event.eventOrigin) &&
    !isNonEmptyString(event.idempotencyKey)
  ) {
    fail(contractName, `idempotencyKey is required when eventOrigin is ${event.eventOrigin}`);
  }
  if (event.eventOrigin === PRIVATE_FINANCING_EVENT_ORIGIN.INTERACTIVE_USER) {
    if (event.sourceReference != null) fail(contractName, "sourceReference must be null when eventOrigin is interactive_user");
    if (event.idempotencyKey != null) fail(contractName, "idempotencyKey must be null when eventOrigin is interactive_user");
  }

  // ledgerSequence: a monotonic, persisted, once-assigned integer -- the ONLY insertion-order-derived
  // value ordering is ever allowed to read (see ledgerOrdering.js). recordedAt is audit/display only.
  if (!Number.isInteger(event.ledgerSequence) || event.ledgerSequence < 0) {
    fail(contractName, "ledgerSequence must be a non-negative integer");
  }
  if (!isValidISODateOnly(event.effectiveDate)) fail(contractName, "effectiveDate must be a valid ISO date string (YYYY-MM-DD)");
  if (!isNonEmptyString(event.recordedAt) || Number.isNaN(Date.parse(event.recordedAt))) {
    fail(contractName, "recordedAt must be a valid ISO datetime string");
  }

  if (REVERSAL_EVENT_TYPES.has(event.eventType)) {
    if (!isNonEmptyString(event.reversesEventId)) fail(contractName, `${event.eventType} requires reversesEventId`);
  } else if (event.reversesEventId != null) {
    fail(contractName, `${event.eventType} must not set reversesEventId`);
  }

  if (REASON_REQUIRED_EVENT_TYPES.has(event.eventType) && !isNonEmptyString(event.reason)) {
    fail(contractName, `${event.eventType} requires a non-empty reason -- no adjustment may silently rewrite payment history`);
  }
  if (event.reason !== undefined && event.reason !== null && typeof event.reason !== "string") {
    fail(contractName, "reason must be a string or null when present");
  }
  if (event.internalNote !== undefined && event.internalNote !== null && typeof event.internalNote !== "string") {
    fail(contractName, "internalNote must be a string or null when present");
  }
  if (
    event.borrowerVisibleExplanation !== undefined &&
    event.borrowerVisibleExplanation !== null &&
    typeof event.borrowerVisibleExplanation !== "string"
  ) {
    fail(contractName, "borrowerVisibleExplanation must be a string or null when present");
  }

  const typeSpecific = EVENT_TYPE_FIELD_VALIDATORS[event.eventType](event, contractName);

  return Object.freeze({
    id: event.id,
    ownerId: event.ownerId,
    accountId: event.accountId,
    eventType: event.eventType,
    eventOrigin: event.eventOrigin,
    createdBy: event.createdBy ?? null,
    sourceReference: event.sourceReference ?? null,
    idempotencyKey: event.idempotencyKey ?? null,
    effectiveDate: event.effectiveDate,
    ledgerSequence: event.ledgerSequence,
    recordedAt: event.recordedAt,
    reversesEventId: event.reversesEventId ?? null,
    reason: event.reason ?? null,
    internalNote: event.internalNote ?? null,
    borrowerVisibleExplanation: event.borrowerVisibleExplanation ?? null,
    ...typeSpecific,
  });
}

// PrivateFinancingAccount / PrivateFinancingComponent -- mutable rows (ordinary created_by/updated_by
// semantics apply, unlike the immutable event above), mirroring the migration's DDL field for field in
// camelCase. These exist so the eventual RPC/API layer never has to hand-validate a raw row.

export function validatePrivateFinancingAccount(account) {
  const contractName = "PrivateFinancingAccount";
  if (!isPlainObject(account)) fail(contractName, "must be an object");
  if (!isNonEmptyString(account.ownerId)) fail(contractName, "ownerId must be a non-empty string");
  if (!isNonEmptyString(account.id)) fail(contractName, "id must be a non-empty string");
  if (!["seller_financing", "personal_loan"].includes(account.product)) {
    fail(contractName, "product must be one of seller_financing, personal_loan");
  }
  if (account.propertyId !== undefined && account.propertyId !== null && !isNonEmptyString(account.propertyId)) {
    fail(contractName, "propertyId must be a non-empty string or null when present");
  }
  const statuses = ["active", "paid_off", "written_off", "cancelled"];
  if (!statuses.includes(account.status)) fail(contractName, `status must be one of ${statuses.join(", ")}`);
  if (!isValidISODateOnly(account.openedDate)) fail(contractName, "openedDate must be a valid ISO date string");
  if (!Number.isInteger(account.originationPrincipalCents) || account.originationPrincipalCents <= 0) {
    fail(contractName, "originationPrincipalCents must be a positive integer");
  }
  if (!["disabled", "enabled"].includes(account.lateFeePolicy)) fail(contractName, "lateFeePolicy must be disabled or enabled");
  if (account.interestDayCountConvention !== PRIVATE_FINANCING_DAY_COUNT_CONVENTION.ACTUAL_365) {
    fail(contractName, `interestDayCountConvention must be ${PRIVATE_FINANCING_DAY_COUNT_CONVENTION.ACTUAL_365}`);
  }
  if (!Number.isInteger(account.platformFeeCents) || account.platformFeeCents < 0 || account.platformFeeCents > 1000) {
    fail(contractName, "platformFeeCents must be an integer between 0 and 1000");
  }
  if (!["lender", "borrower"].includes(account.feePayer)) fail(contractName, "feePayer must be lender or borrower");
  if (account.createdBy !== undefined && account.createdBy !== null && !isNonEmptyString(account.createdBy)) {
    fail(contractName, "createdBy must be a non-empty string or null when present");
  }
  if (account.updatedBy !== undefined && account.updatedBy !== null && !isNonEmptyString(account.updatedBy)) {
    fail(contractName, "updatedBy must be a non-empty string or null when present");
  }
  return Object.freeze({
    ownerId: account.ownerId,
    id: account.id,
    product: account.product,
    propertyId: account.propertyId ?? null,
    status: account.status,
    openedDate: account.openedDate,
    originationPrincipalCents: account.originationPrincipalCents,
    lateFeePolicy: account.lateFeePolicy,
    interestDayCountConvention: account.interestDayCountConvention,
    platformFeeCents: account.platformFeeCents,
    feePayer: account.feePayer,
    createdBy: account.createdBy ?? null,
    updatedBy: account.updatedBy ?? null,
  });
}

// A single financing component -- one entry in the account's ordered collection (at least one; V1 imposes
// no maximum). componentId is a stable identity chosen at creation and never reused; label is the only
// seller-facing text. rateBps may be 0 (a zero-rate component is one possible component, never required).
// version_number/prior_version_id/effective_date follow the exact same insert-only, trigger-enforced
// ordering pattern the migration already established (see the migration's own
// enforce_private_financing_component_version_ordering trigger, unchanged by this revision).
export function validatePrivateFinancingComponent(component) {
  const contractName = "PrivateFinancingComponent";
  if (!isPlainObject(component)) fail(contractName, "must be an object");
  if (!isNonEmptyString(component.ownerId)) fail(contractName, "ownerId must be a non-empty string");
  if (!isNonEmptyString(component.id)) fail(contractName, "id must be a non-empty string");
  if (!isNonEmptyString(component.accountId)) fail(contractName, "accountId must be a non-empty string");
  if (!isNonEmptyString(component.componentKey)) fail(contractName, "componentKey must be a non-empty string (the component's stable identity)");
  if (!isNonEmptyString(component.label)) fail(contractName, "label must be a non-empty string (the seller-facing name for this component)");
  if (!Number.isInteger(component.originalPrincipalCents) || component.originalPrincipalCents <= 0) {
    fail(contractName, "originalPrincipalCents must be a positive integer");
  }
  if (!Number.isInteger(component.rateBps) || component.rateBps < 0) fail(contractName, "rateBps must be a non-negative integer");
  if (component.dayCountConvention !== PRIVATE_FINANCING_DAY_COUNT_CONVENTION.ACTUAL_365) {
    fail(contractName, `dayCountConvention must be ${PRIVATE_FINANCING_DAY_COUNT_CONVENTION.ACTUAL_365}`);
  }
  if (!Number.isInteger(component.scheduledComponentAmountCents) || component.scheduledComponentAmountCents < 0) {
    fail(contractName, "scheduledComponentAmountCents must be a non-negative integer");
  }
  if (!Number.isInteger(component.allocationPriority)) fail(contractName, "allocationPriority must be an integer");
  if (!isValidISODateOnly(component.effectiveDate)) fail(contractName, "effectiveDate must be a valid ISO date string");
  if (!Number.isInteger(component.versionNumber) || component.versionNumber < 1) fail(contractName, "versionNumber must be a positive integer");
  return Object.freeze({
    ownerId: component.ownerId,
    id: component.id,
    accountId: component.accountId,
    componentKey: component.componentKey,
    label: component.label,
    originalPrincipalCents: component.originalPrincipalCents,
    rateBps: component.rateBps,
    dayCountConvention: component.dayCountConvention,
    scheduledComponentAmountCents: component.scheduledComponentAmountCents,
    allocationPriority: component.allocationPriority,
    effectiveDate: component.effectiveDate,
    versionNumber: component.versionNumber,
  });
}
