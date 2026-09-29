// Pure builders for private-financing (personal loan) payment-received notifications.
// No I/O, no model calls: given a succeeded borrower payment, these produce the deterministic
// delivery ids, provider idempotency keys, and email subject/body for the two receipts —
// one to the owner-notification recipient (brandykaymorgan@gmail.com per Jason's 2026-09-29
// instruction) and one to the borrower. The queue/application layer decides *whether* to send
// (enabled flag, owner allowlist, quiet hours); this module only decides *what* a send says.
import { formatCentsAsUsd } from "./paymentDueReminders.js";

export const RECEIPT_RECIPIENT_TYPE = Object.freeze({
  OWNER: "owner",
  BORROWER: "borrower",
});

const VALID_RECIPIENT_TYPES = new Set(Object.values(RECEIPT_RECIPIENT_TYPE));

// Stable dedup key at the receipt grain (owner, payment, recipient). The deliveries table's
// unique constraint on (owner_id, payment_id, recipient_type) makes re-insertion of the same
// key a no-op, so webhook redeliveries, reconciliations, and overlapping cron runs can never
// double-notify.
export function buildReceiptDeliveryId({ ownerId, paymentId, recipientType }) {
  if (!ownerId || !paymentId || !VALID_RECIPIENT_TYPES.has(recipientType))
    throw new Error("ownerId, paymentId, and a valid recipientType are required.");
  return `pf_receipt_${ownerId}_${paymentId}_${recipientType}`;
}

// Stable provider idempotency key: byte-identical across every attempt of the same logical
// delivery, so the email provider itself collapses a double-send into one actual delivery.
export function buildReceiptProviderIdempotencyKey(deliveryId) {
  if (!deliveryId) throw new Error("A delivery id is required.");
  return `pf-receipt-${deliveryId}`;
}

function humanizeProduct(product) {
  return String(product || "").replace(/_/g, " ").trim() || "loan";
}

function formatReceivedDate(occurredAt) {
  if (!occurredAt) return "recently";
  const date = new Date(occurredAt);
  if (Number.isNaN(date.getTime())) return "recently";
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function requireReceiptFacts(facts = {}) {
  const amountCents = facts.amountCents;
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0)
    throw new Error("A positive integer amountCents is required.");
  return {
    borrowerName: (facts.borrowerName || "").trim() || "The borrower",
    amountCents,
    product: humanizeProduct(facts.product),
    occurredAt: facts.occurredAt || null,
    isAutopay: facts.isAutopay === true,
  };
}

// Owner receipt: tells Brandy a borrower payment landed. Names the source (portal vs autopay)
// because the money-movement timing differs — an autopay collection is expected, a manual
// portal payment is borrower-initiated.
export function buildOwnerReceiptEmail(facts = {}) {
  const { borrowerName, amountCents, product, occurredAt, isAutopay } = requireReceiptFacts(facts);
  const amount = formatCentsAsUsd(amountCents);
  const when = formatReceivedDate(occurredAt);
  const source = isAutopay ? "automatic payment" : "portal payment";
  return {
    subject: `Personal loan payment received: ${amount} from ${borrowerName}`,
    bodyText:
      `${borrowerName} made a ${source} of ${amount} on their ${product} on ${when}.\n\n` +
      `The payment succeeded in Stripe and has been posted to the loan ledger.`,
  };
}

// Borrower receipt: confirms to the borrower that their money arrived and was applied.
export function buildBorrowerReceiptEmail(facts = {}) {
  const { borrowerName, amountCents, product, occurredAt } = requireReceiptFacts(facts);
  const amount = formatCentsAsUsd(amountCents);
  const when = formatReceivedDate(occurredAt);
  return {
    subject: `Payment received: ${amount} applied to your ${product}`,
    bodyText:
      `Hi ${borrowerName},\n\n` +
      `We received your payment of ${amount} on ${when} and applied it to your ${product}.\n\n` +
      `Thank you — no further action is needed for this payment.`,
  };
}

export function buildReceiptEmail({ recipientType, facts }) {
  if (recipientType === RECEIPT_RECIPIENT_TYPE.OWNER) return buildOwnerReceiptEmail(facts);
  if (recipientType === RECEIPT_RECIPIENT_TYPE.BORROWER) return buildBorrowerReceiptEmail(facts);
  throw new Error(`Unknown receipt recipient type: ${recipientType}.`);
}
