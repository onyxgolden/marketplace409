// External-payment preview adapter.
//
// Reuses adjustmentPreview.js's proven allocation/replay engine, while forcing the truthful
// manual_external provenance and binding the seller's method/reference metadata into the preview that
// will later be signed. No balance or allocation arithmetic is duplicated here.

import { previewExternalManualPayment } from "./adjustmentPreview.js";
import { PRIVATE_FINANCING_EVENT_ORIGIN } from "./privateFinancingContracts.js";
import { EXTERNAL_PAYMENT_METHOD } from "./externalPaymentRpcParams.js";

function requireNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string.`);
  }
  return value.trim();
}

export function previewSellerConfirmedExternalPayment({
  events,
  componentVersions,
  accountTermsVersions,
  asOfDate,
  amountCents,
  paymentMethod,
  sourceReference,
  reason = "Seller confirmed external payment receipt",
  borrowerVisibleExplanation = null,
  acknowledgeOverpayment = false,
  selectedExtraComponentId = null,
}) {
  if (!Object.values(EXTERNAL_PAYMENT_METHOD).includes(paymentMethod)) {
    throw new TypeError(`paymentMethod must be one of ${Object.values(EXTERNAL_PAYMENT_METHOD).join(", ")}.`);
  }
  const normalizedSourceReference = requireNonEmptyString(sourceReference, "sourceReference");
  const normalizedReason = requireNonEmptyString(reason, "reason");

  const base = previewExternalManualPayment({
    events,
    componentVersions,
    accountTermsVersions,
    asOfDate,
    amountCents,
    eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.MANUAL_EXTERNAL,
    idempotencyKey: `manual_external:${paymentMethod}:${normalizedSourceReference}`,
    reason: normalizedReason,
    acknowledgeOverpayment,
    selectedExtraComponentId,
  });

  const proposedEventPayload = base.proposedEventPayload
    ? Object.freeze({
        ...base.proposedEventPayload,
        eventOrigin: PRIVATE_FINANCING_EVENT_ORIGIN.MANUAL_EXTERNAL,
        paymentMethod,
        sourceReference: normalizedSourceReference,
        borrowerVisibleExplanation:
          typeof borrowerVisibleExplanation === "string" && borrowerVisibleExplanation.trim().length > 0
            ? borrowerVisibleExplanation.trim()
            : null,
      })
    : null;

  return Object.freeze({
    ...base,
    proposedAdjustment: Object.freeze({
      ...base.proposedAdjustment,
      kind: "seller_confirmed_external_payment",
      paymentMethod,
      sourceReference: normalizedSourceReference,
    }),
    proposedEventPayload,
  });
}
