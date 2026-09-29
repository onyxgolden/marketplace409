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
//
// options.dryRun: run the full eligibility decision and return the row that
// WOULD be written, without any database write. Used by the no-send
// acceptance harness.

import {
  buildNotificationId,
  buildOwnerNotificationEmail,
  classifyStripePaymentEvent,
  resolvePaymentNotificationEvent,
} from "@/domains/owner-notifications/ownerPaymentNotifications";
import { resolveOwnerNotificationConfig, isOwnerNotificationAllowed, resolveRentalNotificationConfig, isTenantNotificationAllowed } from "@/domains/owner-notifications/ownerNotificationConfig";

// Resolves a human property label for a lease: the unit label when the lease
// names a unit, otherwise the property slug humanized ("308-paula" ->
// "308 Paula"). Never throws — returns null when the lease or unit cannot be
// resolved. Used by the owner-notification payload and the tenant receipt.
export async function resolvePropertyLabel(db, { ownerId, leaseId }) {
  try {
    if (!leaseId) return null;
    let leaseQuery = db
      .from("rental_leases")
      .select("property_id, unit_id")
      .eq("id", leaseId);
    if (ownerId) leaseQuery = leaseQuery.eq("owner_id", ownerId);
    const { data: lease, error: leaseError } = await leaseQuery.maybeSingle();
    if (leaseError) throw leaseError;
    if (!lease) return null;
    if (lease.unit_id) {
      let unitQuery = db.from("rental_units").select("label").eq("id", lease.unit_id);
      if (ownerId) unitQuery = unitQuery.eq("owner_id", ownerId);
      const { data: unit, error: unitError } = await unitQuery.maybeSingle();
      if (unitError) throw unitError;
      if (unit?.label) return String(unit.label);
    }
    if (lease.property_id) {
      return String(lease.property_id)
        .replace(/[-_]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\b\w/g, (c) => c.toUpperCase()) || null;
    }
    return null;
  } catch (error) {
    console.error("Property label resolution failed", {
      leaseId,
      name: error?.name || "Error",
    });
    return null;
  }
}

// Pure row builder for terminal payment notifications (succeeded/failed),
// shared with the cron route's durable reconciler. The reconciler exists so
// a lost webhook queue write (caught and swallowed here to protect webhook
// processing) still heals within one cron run.
export function buildTerminalPaymentNotificationRow({
  payment,
  tenantName,
  propertyLabel,
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
      property_label: propertyLabel,
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
    propertyLabel: payload.property_label,
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
  const dryRun = options.dryRun === true;
  const tenantConfig = resolveRentalNotificationConfig();
  const effectiveConfig = {
    ...config,
    allowedOwnerIds: options.allowedOwnerIds ?? config.allowedOwnerIds,
    allowedTenantIds: options.allowedTenantIds ?? tenantConfig.allowedTenantIds,
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

    // Tenant allow-list (recipient-level rollout restriction, Jason's
    // 2026-09-29 instruction): fail closed. Only explicitly listed tenants
    // (initial rollout: Eric Carrillo, 308 Paula) generate notifications —
    // every other tenant's payments are ignored at detection time.
    if (!isTenantNotificationAllowed(effectiveConfig, payment.tenant_id)) {
      return { queued: false, reason: "tenant_not_allowlisted" };
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

    const propertyLabel = await resolvePropertyLabel(db, {
      ownerId: payment.owner_id,
      leaseId: payment.lease_id,
    });

    const row = buildTerminalPaymentNotificationRow({
      payment,
      tenantName,
      propertyLabel,
      eventType,
      isAutopay: Boolean(attempt),
      stripeEventType: normalized.eventType,
      occurredAt: normalized.occurredAt,
      sendingEnabled,
    });

    const { data, error: insertError } = dryRun
      ? { data: null }
      : await db
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
        dryRun,
        row,
      };
    }
    return { queued: true, notificationId: row.id, eventType, status: row.status, dryRun, row };
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
