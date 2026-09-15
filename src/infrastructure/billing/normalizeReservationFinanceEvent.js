// Reservation finance uses strict signed envelopes. Metadata is never an identity source.
const TYPES = new Set([
  "refund.created", "refund.updated", "refund.failed", "charge.refunded",
  "charge.succeeded", "charge.updated", "charge.dispute.created",
  "charge.dispute.updated", "charge.dispute.closed", "balance.available",
  "payout.created", "payout.updated", "payout.paid", "payout.failed",
]);

export function reservationProviderId(value) {
  return typeof value === "string" && /^[a-z]+_[A-Za-z0-9_]+$/.test(value) ? value : null;
}

export function normalizeReservationFinanceEvent(event) {
  const object = event?.data?.object;
  const family = event?.type?.startsWith("charge.dispute.") ? "dispute" : event?.type?.split(".")[0];
  const prefix = { refund: "re_", charge: "ch_", dispute: "dp_", payout: "po_" }[family];
  if (!reservationProviderId(event?.id) || !reservationProviderId(event?.account)
      || event?.livemode !== false || !TYPES.has(event?.type)
      || !Number.isSafeInteger(event?.created) || event.created <= 0
      || !object || typeof object !== "object"
      || object.object !== family
      || (event.type !== "balance.available" && !reservationProviderId(object.id))
      || (prefix && !object.id?.startsWith(prefix))
      || (object.livemode !== undefined && object.livemode !== false)) {
    throw new Error("Unsupported reservation finance envelope.");
  }
  return Object.freeze({
    eventId: event.id, connectedAccountId: event.account, mode: "test",
    eventType: event.type, objectId: object.id || null,
    occurredAt: new Date(event.created * 1000).toISOString(),
    paymentIntentId: reservationProviderId(typeof object.payment_intent === "object" ? object.payment_intent?.id : object.payment_intent),
    chargeId: event.type.startsWith("charge.") && !event.type.startsWith("charge.dispute.")
      ? object.id : reservationProviderId(typeof object.charge === "object" ? object.charge?.id : object.charge),
  });
}
