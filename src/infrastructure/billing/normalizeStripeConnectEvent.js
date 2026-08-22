const SUPPORTED_EVENTS = new Set([
  "payment_intent.processing", "payment_intent.succeeded", "payment_intent.payment_failed",
  "charge.succeeded", "charge.failed", "charge.updated",
  "refund.updated", "refund.failed",
  "charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed",
  "balance.available", "payout.paid", "payout.failed",
  "payment_method.automatically_updated", "account.updated", "person.updated",
]);

const PLATFORM_PAYMENT_INTENT_EVENTS = new Set([
  "payment_intent.processing", "payment_intent.succeeded", "payment_intent.payment_failed",
]);

function required(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`Stripe Connect event requires ${name}.`);
  return value.trim();
}

function resolveConnectedAccountId(event, type, object) {
  if (typeof event?.account === "string" && event.account.trim() !== "") return event.account.trim();
  const destination = object?.transfer_data?.destination;
  if (PLATFORM_PAYMENT_INTENT_EVENTS.has(type) && typeof destination === "string" && destination.trim() !== "") {
    return destination.trim();
  }
  return required(undefined, "a connected account id");
}

export function normalizeStripeConnectEvent(event) {
  const type = required(event?.type, "an event type");
  const object = event?.data?.object;
  const connectedAccountId = resolveConnectedAccountId(event, type, object);
  return Object.freeze({
    providerEventId: required(event?.id, "an event id"),
    connectedAccountId,
    eventType: type,
    objectId: typeof object?.id === "string" ? object.id : null,
    paymentId: typeof object?.metadata?.forge_payment_id === "string" ? object.metadata.forge_payment_id : null,
    // A refund's own status — "succeeded" | "pending" | "failed" | "canceled" — is distinct from
    // the fact that a refund.updated event fired at all; Stripe sends this event on every
    // transition, not just completion. Callers must gate any rent reversal on this being
    // "succeeded", never on refundedAmountCents' mere presence.
    refundStatus: type === "refund.updated" && typeof object?.status === "string" ? object.status : null,
    refundedAmountCents: type === "refund.updated" && Number.isSafeInteger(object?.amount) ? object.amount : null,
    paymentIntentId: typeof object?.payment_intent === "string" ? object.payment_intent : null,
    balanceTransactionId: typeof object?.balance_transaction === "string" ? object.balance_transaction : null,
    paymentMethodId: typeof object?.payment_method === "string" ? object.payment_method : null,
    mandateId: typeof object?.mandate === "string" ? object.mandate : null,
    failureCode: typeof object?.last_payment_error?.code === "string" ? object.last_payment_error.code : null,
    failureMessage: typeof object?.last_payment_error?.message === "string" ? object.last_payment_error.message : null,
    occurredAt: Number.isSafeInteger(event?.created) ? new Date(event.created * 1000).toISOString() : new Date().toISOString(),
    supported: SUPPORTED_EVENTS.has(type),
    livemode: event?.livemode === true,
  });
}
