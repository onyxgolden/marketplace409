// Pure translation boundary between the private_financing_* database row shape (snake_case, as returned
// by Supabase) and the JS event/component/terms-contract shapes replayEvents.js/privateFinancingContracts.js
// /financingTermsContracts.js already require (camelCase). This is data-shape mapping, not calculation --
// no balance, interest, or allocation value is computed or altered here. It exists so the API read-model
// layer can feed real persisted rows into the SAME replay engine SF-1 already proved correct, instead of
// any route reimplementing (and risking silently diverging from) that logic.
//
// V1 TERMS GENERALIZATION: components and account terms are now supplied as FULL VERSION HISTORIES
// (componentRows/termsRows, every version, not just the current one) -- replayEvents.js resolves which
// version is active as of each date it processes. Per-component monetary fields on events are now jsonb
// maps keyed by componentKey (interest_paid_by_component_cents, principal_paid_by_component_cents,
// principal_remaining_by_component_cents, delta_cents_by_component_cents) rather than two fixed named
// columns -- see the v1_terms_generalization migration for the exact column additions.
//
// Sign/range semantics per field per event type are deliberately NOT duplicated here --
// privateFinancingContracts.js is the sole authority on those rules, and replayEvents.js already
// re-validates every mapped event through it before folding. This module's own, narrower responsibility is
// numeric SAFETY: every *_cents/rate_bps/ledger_sequence field is a Postgres bigint/integer, which can in
// principle carry a value outside the range a JS number can represent exactly (Number.isSafeInteger) --
// this module refuses to silently truncate or corrupt such a value, failing loudly instead. No date or
// number parsing happens anywhere in this file, so nothing here is locale-dependent.

export class PersistedRowMappingError extends Error {
  constructor(fieldName, reason) {
    super(`${fieldName}: ${reason}`);
    this.name = "PersistedRowMappingError";
    this.fieldName = fieldName;
  }
}

// Nullable by design -- most *_cents columns are legitimately null depending on event_type (see the
// migration's own per-event-type CHECK constraint). null/undefined pass through unchanged; only an
// actually-present value is range-checked.
function assertSafeIntegerField(value, fieldName) {
  if (value === null || value === undefined) return value;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new PersistedRowMappingError(fieldName, `must be an integer, got ${JSON.stringify(value)}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new PersistedRowMappingError(
      fieldName,
      `value ${value} is outside JavaScript's safe integer range (Number.MAX_SAFE_INTEGER) -- refusing to silently lose precision`,
    );
  }
  return value;
}

function assertSafeCentsMap(map, fieldName) {
  if (map === null || map === undefined) return {};
  if (typeof map !== "object" || Array.isArray(map)) {
    throw new PersistedRowMappingError(fieldName, `must be a jsonb object keyed by componentKey, got ${JSON.stringify(map)}`);
  }
  for (const [key, value] of Object.entries(map)) assertSafeIntegerField(value, `${fieldName}.${key}`);
  return { ...map };
}

const NUMERIC_COMPONENT_FIELDS = ["original_principal_cents", "rate_bps", "scheduled_component_amount_cents", "allocation_priority"];
const NUMERIC_TERMS_FIELDS = ["regular_scheduled_payment_amount_cents"];
const NUMERIC_EVENT_FIELDS = ["ledger_sequence", "amount_cents", "delta_cents", "corrected_component_principal_remaining_cents_after"];

function assertSafeNumericRow(row, fields) {
  for (const field of fields) assertSafeIntegerField(row[field], field);
}

export function mapComponentRow(row) {
  assertSafeNumericRow(row, NUMERIC_COMPONENT_FIELDS);
  return {
    ownerId: row.owner_id,
    id: row.id,
    accountId: row.account_id,
    componentKey: row.component_key,
    label: row.label,
    originalPrincipalCents: row.original_principal_cents,
    rateBps: row.rate_bps,
    dayCountConvention: row.day_count_convention,
    scheduledComponentAmountCents: row.scheduled_component_amount_cents,
    allocationPriority: row.allocation_priority,
    effectiveDate: row.effective_date,
    versionNumber: row.version_number,
  };
}

export function mapAccountTermsRow(row) {
  assertSafeNumericRow(row, NUMERIC_TERMS_FIELDS);
  return {
    ownerId: row.owner_id,
    id: row.id,
    accountId: row.account_id,
    versionNumber: row.version_number,
    paymentFrequency: row.payment_frequency,
    firstPaymentDueDate: row.first_payment_due_date,
    regularScheduledPaymentAmountCents: row.regular_scheduled_payment_amount_cents,
    maturityDate: row.maturity_date,
    allocationPolicy: row.allocation_policy,
    extraPaymentAllocationPolicy: row.extra_payment_allocation_policy,
    prepaymentPolicy: row.prepayment_policy,
    dayCountConvention: row.day_count_convention,
    effectiveDate: row.effective_date,
    actingSellerId: row.acting_seller_id,
    amendmentReason: row.amendment_reason,
  };
}

function mapAllocation(row) {
  return {
    interestPaidByComponentCents: assertSafeCentsMap(row.interest_paid_by_component_cents, "interest_paid_by_component_cents"),
    principalPaidByComponentCents: assertSafeCentsMap(row.principal_paid_by_component_cents, "principal_paid_by_component_cents"),
    unallocatedCents: row.unallocated_cents,
  };
}

export function mapEventRow(row) {
  assertSafeNumericRow(row, NUMERIC_EVENT_FIELDS);
  assertSafeIntegerField(row.unallocated_cents, "unallocated_cents");

  const base = {
    id: row.id,
    ownerId: row.owner_id,
    accountId: row.account_id,
    eventType: row.event_type,
    eventOrigin: row.event_origin,
    createdBy: row.created_by,
    sourceReference: row.source_reference,
    idempotencyKey: row.idempotency_key,
    ledgerSequence: row.ledger_sequence,
    effectiveDate: row.effective_date,
    recordedAt: row.recorded_at,
    reversesEventId: row.reverses_event_id,
    reason: row.reason,
    internalNote: row.internal_note,
    borrowerVisibleExplanation: row.borrower_visible_explanation,
  };

  switch (row.event_type) {
    case "account_opened":
      break;
    case "payment_posted":
      base.amountCents = row.amount_cents;
      base.allocation = mapAllocation(row);
      base.principalRemainingByComponentCents = assertSafeCentsMap(row.principal_remaining_by_component_cents, "principal_remaining_by_component_cents");
      base.selectedExtraComponentId = row.selected_extra_component_id ?? null;
      break;
    case "payment_reversal":
      base.amountCents = row.amount_cents;
      base.allocation = mapAllocation(row);
      base.principalRemainingByComponentCents = assertSafeCentsMap(row.principal_remaining_by_component_cents, "principal_remaining_by_component_cents");
      break;
    case "principal_correction":
      base.componentId = row.component_id;
      base.correctionBasis = row.correction_basis;
      base.deltaCents = row.delta_cents;
      base.correctedComponentPrincipalRemainingCentsAfter = row.corrected_component_principal_remaining_cents_after;
      break;
    case "interest_correction":
      base.componentId = row.component_id;
      base.correctionBasis = row.correction_basis;
      base.deltaCents = row.delta_cents;
      break;
    case "compensating_correction":
      base.deltaCents = row.delta_cents;
      base.componentId = row.component_id ?? null;
      break;
    case "payoff_concession":
      base.deltaCentsByComponentCents = assertSafeCentsMap(row.delta_cents_by_component_cents, "delta_cents_by_component_cents");
      base.principalRemainingByComponentCents = assertSafeCentsMap(row.principal_remaining_by_component_cents, "principal_remaining_by_component_cents");
      break;
    case "account_closed":
      base.closureReason = row.closure_reason;
      base.payoffConcessionEventId = row.payoff_concession_event_id;
      break;
    default:
      break;
  }

  return base;
}

// Maps a full set of persisted rows (every event, every component VERSION, every account-terms VERSION --
// not just the current ones) into the shapes replayEvents.js requires. componentRows/termsRows should be
// the account's COMPLETE version history; replayEvents.js resolves which version applies at each date.
export function mapEventRowsForReplay(eventRows, componentRows, termsRows) {
  return {
    events: (eventRows ?? []).map(mapEventRow),
    componentVersions: (componentRows ?? []).map(mapComponentRow),
    accountTermsVersions: (termsRows ?? []).map(mapAccountTermsRow),
  };
}
