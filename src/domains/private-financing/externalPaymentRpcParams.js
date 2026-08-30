// Maps a seller-confirmed external-payment preview to append_private_financing_event().
//
// This is intentionally separate from appendEventRpcParams.js: SF-2D adjustments must never acquire
// payment provenance fields, while an SF-2E manual_external payment must always carry them. The caller
// supplies owner/account identity from authenticated server context; created_by is omitted because the
// SECURITY DEFINER RPC forces it to auth.uid().

export const EXTERNAL_PAYMENT_METHOD = Object.freeze({
  VENMO: "venmo",
  CASH_APP: "cash_app",
  ZELLE: "zelle",
  PAYPAL: "paypal",
  BANK_TRANSFER: "bank_transfer",
  CASH: "cash",
  CHECK: "check",
  MONEY_ORDER: "money_order",
  OTHER: "other",
});

function requireNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string.`);
  }
  return value.trim();
}

export function buildExternalPaymentRpcParams(
  proposedEventPayload,
  {
    ownerId,
    accountId,
    paymentMethod,
    sourceReference,
    externalEvidenceReference = null,
    internalNote = null,
  },
) {
  const payload = proposedEventPayload;
  if (!payload || payload.eventType !== "payment_posted" || payload.eventOrigin !== "manual_external") {
    throw new TypeError("External-payment posting requires a manual_external payment_posted preview payload.");
  }
  if (!Object.values(EXTERNAL_PAYMENT_METHOD).includes(paymentMethod)) {
    throw new TypeError(`paymentMethod must be one of ${Object.values(EXTERNAL_PAYMENT_METHOD).join(", ")}.`);
  }

  const normalizedSourceReference = requireNonEmptyString(sourceReference, "sourceReference");
  const normalizedEvidenceReference =
    externalEvidenceReference == null || externalEvidenceReference === ""
      ? null
      : requireNonEmptyString(externalEvidenceReference, "externalEvidenceReference");
  const normalizedInternalNote =
    internalNote == null || internalNote === "" ? null : requireNonEmptyString(internalNote, "internalNote");

  return {
    p_owner_id: requireNonEmptyString(ownerId, "ownerId"),
    p_account_id: requireNonEmptyString(accountId, "accountId"),
    p_event_type: "payment_posted",
    p_event_origin: "manual_external",
    p_effective_date: payload.effectiveDate,
    p_source_reference: normalizedSourceReference,
    p_idempotency_key: `manual_external:${paymentMethod}:${normalizedSourceReference}`,
    p_reverses_event_id: null,
    p_reason: payload.reason ?? null,
    p_internal_note: normalizedInternalNote,
    p_borrower_visible_explanation: payload.borrowerVisibleExplanation ?? null,
    p_amount_cents: payload.amountCents,
    p_interest_paid_by_component_cents: payload.allocation?.interestPaidByComponentCents ?? null,
    p_principal_paid_by_component_cents: payload.allocation?.principalPaidByComponentCents ?? null,
    p_unallocated_cents: payload.allocation?.unallocatedCents ?? null,
    p_principal_remaining_by_component_cents: payload.principalRemainingByComponentCents ?? null,
    p_selected_extra_component_id: payload.selectedExtraComponentId ?? null,
    p_payment_method: paymentMethod,
    p_external_evidence_reference: normalizedEvidenceReference,
    p_component_id: null,
    p_correction_basis: null,
    p_delta_cents: null,
    p_corrected_component_principal_remaining_cents_after: null,
    p_delta_cents_by_component_cents: null,
    p_closure_reason: null,
    p_payoff_concession_event_id: null,
  };
}
