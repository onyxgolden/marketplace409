// Queues a Brandy owner notification for a rental Stripe payment webhook
// event. Called from the Stripe webhook route AFTER the payment projection
// succeeds. NEVER throws: notification queueing must not break webhook
// processing — a failure is logged and the webhook still returns 200.
//
// Detection-time disposition: the row is written as 'queued' when sending is
// enabled at detection time, or terminally as 'skipped_disabled' when it is
// not. A disabled-at-detection event can never be delivered later — not even
// if the flag flips on before the next cron run. The cron route makes the
// same disposition for its own detections; the shared builder keeps the two
// paths identical.

import {
  buildNotificationId,
  buildOwnerNotificationEmail,
  classifyStripePaymentEvent,
  resolvePaymentNotificationEvent,
} from "@/domains/owner-notifications/ownerPaymentNotifications";
import { resolveOwnerNotificationConfig, isOwnerNotificationAllowed } from "@/domains/owner-notifications/ownerNotificationConfig";

// Pure row builder for terminal payment notifications (succeeded/failed),
// shared with the cron route's durable reconciler. The reconciler exists so
// a lost webhook queue write (caught and swallowed here to protect webhook
// processing) still heals within one cron run.
export function buildTerminalPaymentNotificationRow({
  payment,
  tenantName,
  eventType,
  isAutopay,
  stripeEventType,
  occurredAt,
  sendingEnabled,
}) {
  return {
    owner_id: payment.owner_id,
    id: buildNotificationId({
      ownerId: payment.owner_id,
      eventType,
      subjectId: payment.id,
    }),
    event_type: eventType,
    payment_id: payment.id,
    charge_id: payment.charge_id,
    lease_id: payment.lease_id,
    tenant_id: payment.tenant_id,
    payload: {
      tenant_name: tenantName,
      amount_cents: payment.amount_cents,
      stripe_event_type: stripeEventType,
      is_autopay: isAutopay,
      failure_code: payment.failure_code,
      occurred_at: occurredAt,
    },
    // Detection-time disposition: a row detected while sending is disabled is
    // terminal 'skipped_disabled' — it can never become deliverable later.
    status: sendingEnabled ? "queued" : "skipped_disabled",
  };
}

export function buildTerminalNotificationFacts(payload = {}) {
  return {
    tenantName: payload.tenant_name,
    amountCents: payload.amount_cents,
    failureCode: payload.failure_code,
    isAutopay: payload.is_autopay,
  };
}

export async function queueOwnerPaymentNotificationForWebhookEvent(
  db,
  normalized,
  providerMode,
  options = {},
) {
  const config = resolveOwnerNotificationConfig();
  const sendingEnabled = options.sendingEnabled ?? config.enabled;
  const effectiveConfig = {
    ...config,
    allowedOwnerIds: options.allowedOwnerIds ?? config.allowedOwnerIds,
  };
  try {
    const stripeOutcome = classifyStripePaymentEvent({
      stripeEventType: normalized?.eventType,
      paymentId: normalized?.paymentId,
    });
    if (!stripeOutcome) return { queued: false, reason: "not_notifiable" };
    if (!normalized?.paymentId) return { queued: false, reason: "missing_payment_id" };

    let paymentQuery = db
      .from("rental_payments")
      .select("owner_id, id, charge_id, lease_id, tenant_id, amount_cents, failure_code")
      .eq("id", normalized.paymentId);
    if (providerMode) paymentQuery = paymentQuery.eq("provider_mode", providerMode);
    const { data: payment, error: paymentError } = await paymentQuery.maybeSingle();
    if (paymentError) throw paymentError;
    if (!payment) return { queued: false, reason: "payment_not_found" };

    // Owner allow-list: fail closed. A payment belonging to an owner who is
    // not explicitly allow-listed is never queued — this keeps one landlord's
    // tenant/payment details from being emailed to the shared recipient.
    if (!isOwnerNotificationAllowed(effectiveConfig, payment.owner_id)) {
      return { queued: false, reason: "owner_not_allowlisted" };
    }

    const { data: attempt, error: attemptError } = await db
      .from("rental_autopay_attempts")
      .select("id")
      .eq("owner_id", payment.owner_id)
      .eq("payment_id", payment.id)
      .maybeSingle();
    if (attemptError) throw attemptError;

    const eventType = resolvePaymentNotificationEvent({
      stripeOutcome,
      hasAutopayAttempt: Boolean(attempt),
    });
    if (!eventType) return { queued: false, reason: "unresolved_event" };

    let tenantName = null;
    if (payment.tenant_id) {
      const { data: tenant, error: tenantError } = await db
        .from("rental_tenants")
        .select("display_name")
        .eq("owner_id", payment.owner_id)
        .eq("id", payment.tenant_id)
        .maybeSingle();
      if (tenantError) throw tenantError;
      tenantName = tenant?.display_name ?? null;
    }

    const row = buildTerminalPaymentNotificationRow({
      payment,
      tenantName,
      eventType,
      isAutopay: Boolean(attempt),
      stripeEventType: normalized.eventType,
      occurredAt: normalized.occurredAt,
      sendingEnabled,
    });

    const { data, error: insertError } = await db
      .from("rental_owner_notifications")
      .upsert(row, { onConflict: "owner_id,id", ignoreDuplicates: true })
      .select("id");
    if (insertError) throw insertError;

    if (!sendingEnabled && (data || []).length === 1) {
      // Newly detected while disabled: audit-log what WOULD have been sent.
      const email = buildOwnerNotificationEmail({
        eventType: row.event_type,
        facts: buildTerminalNotificationFacts(row.payload),
      });
      console.log("Owner payment notification (sending disabled) would send", {
        to: config.recipientEmail,
        subject: email.subject,
        bodyText: email.bodyText,
      });
    }

    if (!sendingEnabled) {
      return {
        queued: false,
        reason: "sending_disabled",
        notificationId: row.id,
        eventType,
        status: row.status,
      };
    }
    return { queued: true, notificationId: row.id, eventType, status: row.status };
  } catch (error) {
    // Swallow: the webhook pipeline must succeed even when the queue write
    // fails. The cron's terminal-payment reconciler heals the gap durably —
    // it does not depend on this path.
    console.error("Owner payment notification queue failed", {
      name: error?.name || "Error",
    });
    return { queued: false, reason: "error" };
  }
}
