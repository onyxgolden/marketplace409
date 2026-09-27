// Queues a Brandy owner notification for a rental Stripe payment webhook
// event. Called from the Stripe webhook route AFTER the payment projection
// succeeds. NEVER throws: notification queueing must not break webhook
// processing — a failure is logged and the webhook still returns 200.

import {
  buildNotificationId,
  classifyStripePaymentEvent,
  resolvePaymentNotificationEvent,
} from "@/domains/owner-notifications/ownerPaymentNotifications";

export async function queueOwnerPaymentNotificationForWebhookEvent(db, normalized, providerMode) {
  try {
    const stripeOutcome = classifyStripePaymentEvent({
      stripeEventType: normalized?.eventType,
      paymentId: normalized?.paymentId,
    });
    if (!stripeOutcome) return { queued: false, reason: "not_notifiable" };
    if (!normalized?.paymentId) return { queued: false, reason: "missing_payment_id" };

    let paymentQuery = db.from("rental_payments")
      .select("owner_id, id, charge_id, lease_id, tenant_id, amount_cents, failure_code")
      .eq("id", normalized.paymentId);
    if (providerMode) paymentQuery = paymentQuery.eq("provider_mode", providerMode);
    const { data: payment, error: paymentError } = await paymentQuery.maybeSingle();
    if (paymentError) throw paymentError;
    if (!payment) return { queued: false, reason: "payment_not_found" };

    const { data: attempt, error: attemptError } = await db.from("rental_autopay_attempts")
      .select("id").eq("owner_id", payment.owner_id).eq("payment_id", payment.id).maybeSingle();
    if (attemptError) throw attemptError;

    const eventType = resolvePaymentNotificationEvent({
      stripeOutcome,
      hasAutopayAttempt: Boolean(attempt),
    });
    if (!eventType) return { queued: false, reason: "unresolved_event" };

    let tenantName = null;
    if (payment.tenant_id) {
      const { data: tenant, error: tenantError } = await db.from("rental_tenants")
        .select("display_name").eq("owner_id", payment.owner_id).eq("id", payment.tenant_id).maybeSingle();
      if (tenantError) throw tenantError;
      tenantName = tenant?.display_name ?? null;
    }

    const notificationId = buildNotificationId({
      ownerId: payment.owner_id,
      eventType,
      subjectId: payment.id,
    });
    const { error: insertError } = await db.from("rental_owner_notifications").upsert({
      owner_id: payment.owner_id,
      id: notificationId,
      event_type: eventType,
      payment_id: payment.id,
      charge_id: payment.charge_id,
      lease_id: payment.lease_id,
      tenant_id: payment.tenant_id,
      payload: {
        tenant_name: tenantName,
        amount_cents: payment.amount_cents,
        stripe_event_type: normalized.eventType,
        is_autopay: Boolean(attempt),
        failure_code: payment.failure_code,
        occurred_at: normalized.occurredAt,
      },
      status: "queued",
    }, { onConflict: "owner_id,id", ignoreDuplicates: true });
    if (insertError) throw insertError;
    return { queued: true, notificationId, eventType };
  } catch (error) {
    console.error("Owner payment notification queue failed", { name: error?.name || "Error" });
    return { queued: false, reason: "error" };
  }
}
