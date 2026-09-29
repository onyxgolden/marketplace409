// Queues a FORGE payment receipt for a rental tenant's succeeded Stripe payment.
// Called from the Stripe webhook route AFTER the payment projection succeeds —
// succeeded ONLY (Jason's 2026-09-29 rule: receipts go out only after Stripe
// confirms the payment, never when the tenant merely initiates one). NEVER
// throws: notification queueing must not break webhook processing — a failure
// is logged and the webhook still returns 200.
//
// One row per payment to the tenant's own email. Detection-time disposition
// mirrors the owner-notification precedent: the row is written as 'queued'
// when sending is enabled at detection time AND the owner and tenant are
// allowlisted (recipient-level rollout restriction — initial rollout: Eric
// Carrillo, 308 Paula), or terminally as 'skipped_disabled' when they are
// not. A disabled-at-detection event can never be delivered later. The
// deliveries table's unique constraint on (owner_id, payment_id) makes every
// queue insertion idempotent, so webhook redeliveries can never double-notify.
import {
  buildTenantReceiptDeliveryId,
  buildTenantReceiptProviderIdempotencyKey,
} from "@/domains/rental/tenantPaymentReceipts";
import {
  classifyStripePaymentEvent,
} from "@/domains/owner-notifications/ownerPaymentNotifications";
import {
  isOwnerNotificationAllowed,
  isTenantNotificationAllowed,
  resolveRentalNotificationConfig,
} from "@/domains/owner-notifications/ownerNotificationConfig";

// Pure row builder, shared with the cron route's reconciler. The reconciler
// exists so a lost webhook queue write (caught and swallowed here to protect
// webhook processing) still heals within one cron run. The row is the dedup
// record, not the email draft: tenant name, property label, and transaction
// reference are re-resolved by the sender at send time so the email always
// reflects current data.
export function buildTenantReceiptDeliveryRow({
  payment,
  tenantEmail,
  sendingEnabled,
  ownerAllowed,
  tenantAllowed,
}) {
  const deliverable =
    sendingEnabled && ownerAllowed && tenantAllowed && Boolean(tenantEmail);
  return {
    owner_id: payment.owner_id,
    id: buildTenantReceiptDeliveryId({
      ownerId: payment.owner_id,
      paymentId: payment.id,
    }),
    payment_id: payment.id,
    tenant_id: payment.tenant_id,
    lease_id: payment.lease_id,
    recipient_email: tenantEmail || "",
    amount_cents: payment.amount_cents,
    transaction_ref: payment.provider_payment_id || null,
    idempotency_key: buildTenantReceiptProviderIdempotencyKey(
      buildTenantReceiptDeliveryId({
        ownerId: payment.owner_id,
        paymentId: payment.id,
      }),
    ),
    status: deliverable ? "queued" : "skipped_disabled",
    failure_reason: deliverable
      ? null
      : !sendingEnabled
        ? "Sending disabled at detection time."
        : !ownerAllowed
          ? "Owner not allowlisted for notifications."
          : !tenantAllowed
            ? "Tenant not allowlisted for payment receipts."
            : "Tenant email unavailable.",
  };
}

export async function queueTenantPaymentReceiptForWebhookEvent(
  db,
  { paymentId, providerMode } = {},
  options = {},
) {
  try {
    // Not a succeeded rental tenant payment: no-op. This keeps
    // private-financing, reservation, settlement, payout, refund, and failed
    // events out on its own — the caller gates on succeeded too, defense in
    // depth.
    if (classifyStripePaymentEvent({ stripeEventType: "payment_intent.succeeded", paymentId }) !== "succeeded") {
      return { queued: false, reason: "not_notifiable" };
    }

    const config = resolveRentalNotificationConfig();
    const sendingEnabled = options.sendingEnabled ?? config.enabled;
    const effectiveConfig = {
      ...config,
      allowedOwnerIds: options.allowedOwnerIds ?? config.allowedOwnerIds,
      allowedTenantIds: options.allowedTenantIds ?? config.allowedTenantIds,
    };

    let paymentQuery = db
      .from("rental_payments")
      .select("owner_id, id, lease_id, tenant_id, amount_cents, status, provider_payment_id")
      .eq("id", paymentId)
      .eq("status", "succeeded");
    if (providerMode) paymentQuery = paymentQuery.eq("provider_mode", providerMode);
    const { data: payment, error: paymentError } = await paymentQuery.maybeSingle();
    if (paymentError) throw paymentError;
    if (!payment) return { queued: false, reason: "payment_not_found_or_not_succeeded" };

    if (!isOwnerNotificationAllowed(effectiveConfig, payment.owner_id)) {
      return { queued: false, reason: "owner_not_allowlisted" };
    }
    if (!isTenantNotificationAllowed(effectiveConfig, payment.tenant_id)) {
      return { queued: false, reason: "tenant_not_allowlisted" };
    }

    let tenantEmail = null;
    if (payment.tenant_id) {
      const { data: tenant, error: tenantError } = await db
        .from("rental_tenants")
        .select("email")
        .eq("owner_id", payment.owner_id)
        .eq("id", payment.tenant_id)
        .maybeSingle();
      if (tenantError) throw tenantError;
      tenantEmail = tenant?.email ?? null;
    }

    const row = buildTenantReceiptDeliveryRow({
      payment,
      tenantEmail,
      sendingEnabled,
      ownerAllowed: true,
      tenantAllowed: true,
    });

    const { error } = await db.from("rental_tenant_receipt_deliveries").upsert(row, {
      onConflict: "owner_id,payment_id",
      // First-write-wins: a webhook redelivery or a later reconciler pass can
      // never flip a terminal row ('sent', 'skipped_disabled',
      // 'skipped_not_allowlisted') back to 'queued'.
      ignoreDuplicates: true,
    });
    if (error) throw error;
    return { queued: row.status === "queued", receiptId: row.id, status: row.status };
  } catch (error) {
    console.error("Tenant payment receipt queue failed", {
      paymentId,
      name: error?.name || "Error",
    });
    return { queued: false, reason: "error" };
  }
}
