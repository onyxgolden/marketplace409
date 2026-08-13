const SUPPORTED_EVENTS = new Set([
  "payment_intent.processing", "payment_intent.succeeded", "payment_intent.payment_failed",
  "charge.succeeded", "charge.failed", "charge.updated",
  "refund.updated", "refund.failed",
  "charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed",
  "balance.available", "payout.paid", "payout.failed",
  "payment_method.automatically_updated", "account.updated", "person.updated",
]);

function required(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`Stripe Connect event requires ${name}.`);
  return value.trim();
}

export function normalizeStripeConnectEvent(event) {
  const type = required(event?.type, "an event type");
  const connectedAccountId = required(event?.account, "a connected account id");
  const object = event?.data?.object;
  return Object.freeze({
    providerEventId: required(event?.id, "an event id"),
    connectedAccountId,
    eventType: type,
    objectId: typeof object?.id === "string" ? object.id : null,
    paymentId: typeof object?.metadata?.forge_payment_id === "string" ? object.metadata.forge_payment_id : null,
    refundedAmountCents: type === "refund.updated" && Number.isSafeInteger(object?.amount) ? object.amount : null,
    failureCode: typeof object?.last_payment_error?.code === "string" ? object.last_payment_error.code : null,
    failureMessage: typeof object?.last_payment_error?.message === "string" ? object.last_payment_error.message : null,
    occurredAt: Number.isSafeInteger(event?.created) ? new Date(event.created * 1000).toISOString() : new Date().toISOString(),
    supported: SUPPORTED_EVENTS.has(type),
    livemode: event?.livemode === true,
  });
}
