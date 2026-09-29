// Pure builders for rental tenant payment receipts.
// No I/O, no model calls: given a succeeded tenant Stripe payment, these produce the
// deterministic delivery id, provider idempotency key, and email subject/body for the
// receipt the tenant receives. The queue/application layer decides *whether* to send
// (enabled flag, owner + tenant allowlists, quiet hours); this module only decides
// *what* a send says.
//
// Initial rollout (Jason's 2026-09-29 instruction): Eric Carrillo, 308 Paula.
import { formatCentsAsUsd } from "../owner-notifications/ownerPaymentNotifications.js";

function formatReceivedDate(occurredAt) {
  if (!occurredAt) return "recently";
  const date = new Date(occurredAt);
  if (Number.isNaN(date.getTime())) return "recently";
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

// Stable dedup key at the receipt grain (owner, payment). The deliveries table's unique
// constraint on (owner_id, payment_id) makes re-insertion a no-op, so webhook
// redeliveries, reconciliations, and overlapping cron runs can never double-notify.
export function buildTenantReceiptDeliveryId({ ownerId, paymentId }) {
  if (!ownerId || !paymentId) throw new Error("ownerId and paymentId are required.");
  return `rtr_${ownerId}_${paymentId}`;
}

// Stable provider idempotency key: byte-identical across every attempt of the same
// logical delivery, so the email provider itself collapses a double-send into one.
export function buildTenantReceiptProviderIdempotencyKey(deliveryId) {
  if (!deliveryId) throw new Error("A delivery id is required.");
  return `rental-tenant-receipt-${deliveryId}`;
}

function requireReceiptFacts(facts = {}) {
  const amountCents = facts.amountCents;
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0)
    throw new Error("A positive integer amountCents is required.");
  return {
    tenantName: (facts.tenantName || "").trim() || "there",
    amountCents,
    propertyLabel: (facts.propertyLabel || "").trim() || null,
    occurredAt: facts.occurredAt || null,
    transactionRef: (facts.transactionRef || "").trim() || null,
  };
}

// Tenant receipt: confirms to the tenant that their rent payment landed and was applied.
// Carries what Jason required: amount, payment date, property, transaction reference.
export function buildTenantReceiptEmail(facts = {}) {
  const { tenantName, amountCents, propertyLabel, occurredAt, transactionRef } =
    requireReceiptFacts(facts);
  const amount = formatCentsAsUsd(amountCents);
  const when = formatReceivedDate(occurredAt);
  const propertySuffix = propertyLabel ? ` — ${propertyLabel}` : "";
  const propertyClause = propertyLabel ? ` for ${propertyLabel}` : "";
  const referenceClause = transactionRef
    ? `\n\nTransaction reference: ${transactionRef}`
    : "";
  return {
    subject: `Payment received: ${amount}${propertySuffix}`,
    bodyText:
      `Hi ${tenantName},\n\n` +
      `We received your rent payment of ${amount} on ${when}${propertyClause}.` +
      referenceClause +
      `\n\nThank you — no further action is needed for this payment.`,
  };
}
