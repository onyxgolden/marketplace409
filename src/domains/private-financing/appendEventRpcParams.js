// Pure translation from an adjustment preview's proposedEventPayload (the camelCase JS event-contract
// shape adjustmentPreview.js already produces) into the exact positional p_* parameter names
// append_private_financing_event() expects. Deliberately omits p_created_by entirely -- the RPC itself
// forces created_by to the real authenticated user for interactive_user/manual_external origins and
// rejects a caller-supplied value for every other origin (see the migration's own attribution logic), so
// this mapper never sends one, and SF-2D never asks a caller for one either. Likewise never sends
// p_source_reference/p_payment_method/p_external_evidence_reference -- none of SF-2D's nine adjustment
// kinds are manual_external payments (that stays SF-2E scope).
//
// V1 TERMS GENERALIZATION: per-component monetary fields are now jsonb maps keyed by componentKey
// (p_interest_paid_by_component_cents, p_principal_paid_by_component_cents,
// p_principal_remaining_by_component_cents, p_delta_cents_by_component_cents) instead of two fixed named
// parameters -- see the v1_terms_generalization migration's expanded append_private_financing_event
// signature.

export function buildAppendEventRpcParams(proposedEventPayload, { ownerId, accountId, internalNote = null }) {
  const payload = proposedEventPayload;
  return {
    p_owner_id: ownerId,
    p_account_id: accountId,
    p_event_type: payload.eventType,
    // Always interactive_user for SF-2D -- a browser caller can never select any other origin, and this
    // mapper never reads eventOrigin from the caller's own request body, only from the preview's own
    // payload (which adjustmentPreview.js always sets to interactive_user for every SF-2D action kind).
    p_event_origin: payload.eventOrigin,
    p_effective_date: payload.effectiveDate,
    p_source_reference: null,
    p_idempotency_key: null,
    p_reverses_event_id: payload.reversesEventId ?? null,
    p_reason: payload.reason ?? null,
    p_internal_note: internalNote,
    p_borrower_visible_explanation: payload.borrowerVisibleExplanation ?? null,
    p_amount_cents: payload.amountCents ?? null,
    p_interest_paid_by_component_cents: payload.allocation?.interestPaidByComponentCents ?? null,
    p_principal_paid_by_component_cents: payload.allocation?.principalPaidByComponentCents ?? null,
    p_unallocated_cents: payload.allocation?.unallocatedCents ?? null,
    p_principal_remaining_by_component_cents: payload.principalRemainingByComponentCents ?? null,
    p_selected_extra_component_id: payload.selectedExtraComponentId ?? null,
    p_payment_method: null,
    p_external_evidence_reference: null,
    p_component_id: payload.componentId ?? null,
    p_correction_basis: payload.correctionBasis ?? null,
    p_delta_cents: payload.deltaCents ?? null,
    p_corrected_component_principal_remaining_cents_after: payload.correctedComponentPrincipalRemainingCentsAfter ?? null,
    p_delta_cents_by_component_cents: payload.deltaCentsByComponentCents ?? null,
    p_closure_reason: payload.closureReason ?? null,
    p_payoff_concession_event_id: payload.payoffConcessionEventId ?? null,
  };
}
