// Shared idempotency predicate for both Stripe webhook routes (payment events and V2 account thin
// events). A webhook delivery is only skipped once it has reached a *terminal* outcome —
// 'processed' (the business update genuinely completed) or 'ignored' (deliberately not
// applicable, e.g. an unsupported event type or unknown account). A row stuck at 'received'
// (the business step started but never finished — a transient failure, a crash mid-request) must
// still be retried on the next delivery, or a real event could be silently, permanently lost.
export function isWebhookEventAlreadySettled(status) {
  return status === "processed" || status === "ignored";
}

// The server's own resolved mode is the only thing a webhook handler trusts for whether an event
// may proceed to a business mutation — an event's own claimed `livemode` must agree with it.
// Never inferred from an object id (Stripe ids give no reliable, checkable mode signal here).
export function webhookLivemodeMatchesServerMode(eventLivemode, serverMode) {
  if (typeof eventLivemode !== "boolean") return false;
  return eventLivemode === (serverMode === "live");
}
