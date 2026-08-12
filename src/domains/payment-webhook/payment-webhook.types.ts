export const PAYMENT_WEBHOOK_STATUSES = ["received", "processing", "processed", "ignored", "failed"] as const;
export type PaymentWebhookStatus = typeof PAYMENT_WEBHOOK_STATUSES[number];
export type PaymentWebhookEvent = Readonly<{ id: string; provider: string; providerEventId: string; eventType: string;
  objectId: string | null; status: PaymentWebhookStatus; receivedAt: string; processedAt: string | null;
  failureMessage: string | null; payloadHash: string }>;
function required(value: string, field: string) { if (typeof value !== "string" || value.trim() === "") throw new Error(`Payment webhook event requires ${field}.`); return value.trim(); }
function time(value: string | null, field: string) { if (value === null) return null; const normalized = required(value, field);
  if (Number.isNaN(Date.parse(normalized))) throw new Error(`Payment webhook event ${field} must be a valid timestamp.`); return normalized; }
export function createPaymentWebhookEvent(value: PaymentWebhookEvent): PaymentWebhookEvent {
  if (!PAYMENT_WEBHOOK_STATUSES.includes(value.status)) throw new Error("Payment webhook event requires a supported status.");
  if (value.status === "processed" && value.processedAt === null) throw new Error("Processed webhook events require processedAt.");
  return Object.freeze({ ...value, id: required(value.id, "an id"), provider: required(value.provider, "a provider"),
    providerEventId: required(value.providerEventId, "a provider event id"), eventType: required(value.eventType, "an event type"),
    objectId: value.objectId?.trim() || null, receivedAt: time(value.receivedAt, "receivedAt") as string,
    processedAt: time(value.processedAt, "processedAt"), failureMessage: value.failureMessage?.trim() || null,
    payloadHash: required(value.payloadHash, "a payload hash") });
}
